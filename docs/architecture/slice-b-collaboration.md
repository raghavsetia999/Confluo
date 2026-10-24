# Slice B: collaborative boards

- **Status:** Implemented; accounts and memberships added
- **Date:** 2026-10-24
- **Scope:** shared canvas, server persistence, accounts, board membership, migration of old boards
- **Not in scope:** presence, offline editing, password reset, email verification, MFA, user-visible revision history

> This is the reader-friendly version of the detailed B0–B4 design notes. The
> original audit and decision log remain in git history.

## 1. What changed

Before Slice B, a board lived entirely in one browser:

- the canvas was a `CanvasElement[]`
- the whole array was rewritten to `localStorage` on every change
- there was no backend, so two browsers could not see each other's edits

Slice B adds a shared document:

- each board is one Yjs document
- browsers connect over Hocuspocus WebSockets
- the backend keeps the live document and saves it to a database
- old `localStorage` boards are imported once
- the canvas still uses `CanvasElement[]`; Fabric.js did not change

The important shift is ownership: **the browser is no longer the shared source
of truth once a board is opened collaboratively.** The server holds the live
document, and Yjs state in the database is the durable copy.

Board titles, the dashboard list, ownership and membership are now server-owned
as well. The browser no longer stores the authoritative board list or auth
tokens. Board ID sharing replaces the earlier local-only board discovery.

## 2. Big picture

```text
Browser A ─┐
Browser B ─┼── WebSocket :4001 ── Hocuspocus server ── PostgreSQL / PGlite
Browser C ─┘   session cookie +      one Y.Doc per board   users, boards,
               membership check                            memberships, Yjs state

Browser ──── HTTP :4000 ─────────── auth, boards, memberships
```

| Part | Responsibility |
|---|---|
| Browser | Render the canvas, keep a temporary Y.Doc copy, show connection state |
| Backend | Validate the board, merge updates, broadcast changes, persist state |
| Database | Store the latest snapshot and the update log |
| `localStorage` | No authoritative board or auth data; only non-critical UI preferences |

All users must connect to the same backend and the same board ID. Browsers never
connect to the database directly.

## 3. How one edit travels

1. A user moves a shape, edits text, or deletes an element.
2. The canvas binding compares the new canvas state with the Yjs document.
3. It writes only the changed fields into the local Y.Doc.
4. The provider sends that binary update to the server.
5. The server applies it to the board's shared Y.Doc and appends it to the
   database update log.
6. The server broadcasts the update to every other browser on that board.
7. Other browsers apply it and update Fabric without writing to `localStorage`
   or adding an undo entry.
8. Every few seconds the server saves a full snapshot and can prune old log rows.

Local changes use a special Yjs transaction origin, so the browser ignores its
own echo. Remote changes update the canvas but never feed back into the document.

## 4. Shared document model

```text
Y.Doc
├─ "elements" : Y.Map<elementId, Y.Map>   one entry per canvas element
└─ "meta"     : Y.Map                     boardId, schemaVersion, migratedAt
```

Each element stores logical canvas fields, never Fabric.js objects or serialized
Fabric JSON.

| Field | Stored as | Notes |
|---|---|---|
| `id` | map key | Never rewritten |
| `type`, `createdBy` | values | Immutable after creation |
| `pos` | `{ x, y }` | Moved as one value |
| `size` | `{ w, h }` | Resized as one value |
| `rotation` | number | |
| `style` | `{ fill, stroke, strokeWidth, opacity }` | Changed as one value |
| `text` | string | Whole string, not character-level |
| `points` | number[] | Freehand data |
| `z` | number | Stacking order |
| `deleted` | boolean | Tombstone, never key removal |

Position and size are bundled so two users cannot accidentally create a state
with `x` from one drag and `y` from another. Style is bundled for the same
reason. `text` is also one value in Slice B; character-level collaborative text
is out of scope.

`z` reproduces the old array order. Migrated elements get `z = index`; new
elements get `max(z) + 1`. Ties are broken by element ID.

Deletion sets `deleted = true` instead of removing the map entry. Removing the
key would allow a concurrent field write to disappear without a clear winner.

## 5. Connecting to a board

The document name is derived, never accepted raw from the client:

```text
confluo.board.<boardId>
```

A board ID must match:

```text
^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$
```

Before loading anything, the server:

1. rejects an unexpected browser `Origin`,
2. parses the document name and rejects malformed names,
3. authenticates the HttpOnly session cookie,
4. checks that the authenticated user has a membership in the board,
5. loads the document only for the validated board ID.

The raw document name is never used as a database key. A malformed name, unknown
board, missing session, or non-member is rejected before any document state is
loaded. The WebSocket connection does not rely on board IDs as authorization.

Each opened board gets one Y.Doc, one provider and one canvas binding. The
session is cleaned up when the board changes, the user navigates away, the
component unmounts, or React Strict Mode remounts it.

## 6. Connection states

| State | Meaning |
|---|---|
| `connecting` | Opening the WebSocket or loading the document |
| `connected` | Transport is connected; initial document sync may still be running |
| `synced` | The browser and server documents are synchronized |
| `disconnected` | The connection was lost; editing is paused |
| `error` | Setup or connection failed; editing remains paused |

The canvas is read-only until the first sync completes. This prevents edits from
being made against an empty or stale document.

`synced` does **not** mean a database checkpoint finished. The UI therefore says
“No save receipt” rather than claiming the board is permanently saved.

There is no offline queue and no offline editing promise. When the connection
drops, the user must wait for reconnection.

## 7. How saving works

The database has three relevant tables:

| Table | Purpose |
|---|---|
| `users` | Account identity, normalized email, scrypt password hash |
| `auth_sessions` | Hashed session tokens and expiry |
| `boards` | Board ID, title, owner, legacy Slice A JSON |
| `board_memberships` | Owner/editor membership and access checks |
| `board_documents` | One full Yjs snapshot per board plus a watermark |
| `board_updates` | Append-only binary Yjs updates received since the snapshot |

The snapshot is like a fresh full copy. The update log is the short list of
changes made after that copy. The watermark is the highest log sequence number
already included in the snapshot.

### Loading a board

1. Read the stored snapshot.
2. Apply every update with `seq > watermark`, in sequence order.
3. Validate that the resulting document belongs to the requested board and uses
   the supported schema version.

### Checkpointing a board

1. Read the current highest update sequence (`N`).
2. Encode the live Y.Doc as a full binary snapshot.
3. In one database transaction, save the snapshot with watermark `N` and delete
   log rows with `seq <= N`.
4. Pruning is optional through `PRUNE_UPDATE_LOG`; keeping the log is always
   safe.

Every write for a board goes through one in-process serial queue. That means a
checkpoint cannot overtake an update that is still being written.

Crash safety rule: **never delete updates before the snapshot that covers them
has committed.** If the process crashes before the snapshot commits, the old
snapshot and all updates are still available. Replaying an update twice is
harmless because Yjs updates are idempotent.

Graceful shutdown flushes pending writes and checkpoints. Snapshots are internal
recovery points, not user-visible version history.

Local development and the automated test suite use PGlite, which runs PostgreSQL
in-process. Production uses the normal PostgreSQL adapter and the same schema
and SQL. The PostgreSQL adapter was exercised against a real PostgreSQL 18.6
server, including the two-browser authenticated smoke test.

## 8. Multiple users and conflicts

Yjs merges changes deterministically by client clock. The server does not choose
a winner by wall-clock time.

| Situation | Result |
|---|---|
| Two users move the same element | One whole `pos` value wins |
| Two users resize the same element | One whole `size` value wins |
| Two users restyle the same element | One whole `style` value wins |
| One moves while another resizes | Both changes survive |
| Two users edit the same text | One whole string wins; the other edit may be lost |
| Delete and update arrive together | The element stays deleted |
| A user writes the same value twice | No visible change |

While a user is dragging, resizing or editing an element, remote changes for
that element are deferred so it does not jump under the cursor. The local gesture
wins when it ends, then the board converges.

Local undo/redo is disabled while collaboration is active. The existing undo is a
whole-board snapshot; applying it could erase another user's work. Collaborative
undo/redo is not part of Slice B.

## 9. Migrating old boards

Migration is performed by the server, never by a browser, because two clients
could otherwise race.

When a board is opened:

1. If any Yjs snapshot or update exists, use it. **Existing Yjs state always
   wins.**
2. Otherwise, read the board's legacy Slice A JSON.
3. Validate and sanitize the legacy elements.
4. Convert them with the shared migration helper.
5. Save the initial Yjs snapshot at watermark 0 before allowing edits.
6. Later loads use the saved Yjs state.

The migration is idempotent. A partial migration is not applied on top of an
existing document. Invalid legacy elements are skipped. Element IDs are
preserved. Empty boards still receive a snapshot, so migration is not retried on
every open.

Once collaboration is active, canvas commits no longer write to the old JSON.
Legacy JSON remains a read-only fallback.

Board discovery is now server-backed. Owners and joined editors see their boards
in the dashboard. A signed-in user can join by entering the board ID; the server
creates an editor membership transactionally. The ID is an identifier, not a
password, and the current policy intentionally allows any signed-in holder to
join.

## 10. Security

Accounts and board authorization are now implemented:

- Passwords are hashed with scrypt and a random salt.
- Sessions are random tokens stored only as SHA-256 hashes; the raw token is in
  an HttpOnly, SameSite=Lax cookie (Secure in production).
- Authenticated mutations require a session-bound CSRF token and a same-origin
  browser request.
- Every HTTP board read/write checks the authenticated user's membership.
- Every WebSocket connection checks origin, session cookie and board membership
  before loading Yjs state.
- Unknown or malformed board IDs return safe errors.

Remaining constraints:

- A board ID is an identifier, not a password. Any signed-in user who has a
  valid ID can join as an editor in this milestone.
- Login rate limiting is in-process and intended for one server process.
- There is no email verification, password reset, MFA or invite approval.
- PGlite is a local-development fallback, not a production database server.

## 11. Known limitations

- No teams, invite approval or viewer-only membership
- No email verification, password reset or MFA
- No presence, cursors or avatar awareness
- No offline queue, `y-indexeddb` or disconnected editing
- No collaborative undo/redo
- No user-visible revisions, checkpoints or branches
- Text conflicts are last-writer-wins
- Deleted-element tombstones are retained for the life of the document
- One backend process only; no Redis or multi-node Hocuspocus
- PGlite is for local development; the full automated suite runs against it.
  The browser smoke flow was also verified against a real PostgreSQL 18.6
  server, including migrations, accounts, memberships and Yjs persistence.

## 12. Code map

| Concern | Location |
|---|---|
| Yjs schema, origins, migration helper | `apps/web/src/collab/document.ts` |
| Document-name parsing and validation | `apps/web/src/collab/documentName.ts` |
| Fabric ↔ Yjs binding | `apps/web/src/collab/CanvasBinding.ts` |
| Provider and session lifecycle | `apps/web/src/collab/session.ts`, `useBoardCollaboration.ts` |
| Remote projection into the existing store | `apps/web/src/stores/editorStore.ts` |
| Canvas integration and connection UI | `apps/web/src/components/whiteboard/CanvasEditor.tsx` |
| Hocuspocus hooks and validation | `apps/server/src/collaboration/server.ts` |
| Serial queue, load, append, checkpoint | `apps/server/src/collaboration/documentPersistence.ts` |
| Snapshot/update SQL | `apps/server/src/collaboration/documentRepository.ts` |
| Schema migrations | `apps/server/src/db/migrations.ts` |
| Authentication and session service | `apps/server/src/auth/` |
| HTTP auth, board and membership API | `apps/server/src/http/app.ts` |
| Password hashing | `apps/server/src/auth/password.ts` |
| Board membership repository | `apps/server/src/boards/boardRepository.ts` |
| Two-browser authenticated smoke test | `apps/server/scripts/collaboration-browser-smoke.ts` |

## 13. Checks

```bash
npm test
npm run build
npm run lint --workspace web
npm run typecheck --workspace @confluo/server
npm run test:browser --workspace @confluo/server
```

The browser smoke test needs the web/server stack and Chrome remote debugging on
port 9222. The other commands run without a browser.

The server tests cover account creation, password hashing, email normalization,
login/logout, session restoration, CSRF rejection, board creation, join by ID,
owner-only rename/delete, membership isolation, persistence across an app
restart, legacy migration, reload after restart, board isolation, and anonymous
or non-member WebSocket rejection. The browser smoke test covers two
authenticated contexts, board sharing by ID, two-client create/move/text/delete
(including a move from each browser), and refresh recovery.

## Glossary

| Term | Meaning |
|---|---|
| Yjs | A conflict-free shared document library |
| Hocuspocus | WebSocket server/provider that synchronizes Yjs documents |
| Update | An incremental binary change to a Yjs document |
| Snapshot | A full binary copy of the current Yjs document |
| Watermark | The highest update sequence already included in the snapshot |
| PGlite | PostgreSQL compiled to WebAssembly, used locally |
| LWW | “Last write wins” for one field when edits conflict |
