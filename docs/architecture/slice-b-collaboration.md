# ADR: Slice B collaboration contract

- **Status:** Accepted; B0 contract with B1–B4 implemented
- **Date:** 2026-10-24
- **Scope:** Slice B
- **Supersedes:** none

## Decision

Slice B adds a **convergent shared document over a Hocuspocus connection**. The
DOM document model stays `CanvasElement[]`; the canvas keeps rendering from that
model. Yjs becomes the transport and merge layer beneath the existing
`CanvasManager` seam (`setElements` / `onChange`). No presence, auth, offline or
history feature is added in this slice; B4 only adds connection status and a
read-only lock until initial sync.

This note defines the contract that every B chunk implements and records the
B4 runtime/persistence decisions. The original B0 audit below is retained as
historical context.

---

## 1. Audit baseline

Repository state at the start of B0: `main` at `911ee49`, working tree clean and
in sync with `origin/main`.

| Check / fact | Actual result |
|---|---|
| Node / npm | `v24.11.0` / `11.6.1` (no `.nvmrc`, no `engines` field) |
| Workspaces | single app: `apps/web`; **no root `package.json`** |
| Lockfile | `apps/web/package-lock.json`, `lockfileVersion: 3`, 207 packages |
| `AGENTS.md` | **absent** |
| Backend / Express / REST API | **absent** (no `apps/server`, no `fetch`/`axios` in `src`) |
| PostgreSQL / driver / migrations / repository layer | **absent** (no `pg`, no SQL, no env files) |
| Yjs / Hocuspocus / IndexedDB | **absent** (not installed, not imported) |
| Playwright / React Testing Library | **absent** (Vitest only) |
| `npm test` | **PASS** — 2 files, 14/14 tests |
| `npm run lint` (`oxlint`) | **PASS** — no findings |
| `npm run build` (`tsc -b && vite build`) | **PASS** — JS 672.24 kB / 209.37 kB gzip; CSS 41.86 kB / 9.19 kB gzip |
| Browser-level checks | Not re-run in B0 (Slice A audit evidence stands; no runtime changed) |

**B0 historical note:** at the time of the audit every DB/API/persistence claim
below was a proposed boundary rather than an implementation. B4 now implements
the server, schema, repositories, HTTP API, Hocuspocus transport and persistence
queue. PGlite is used for local development and integration tests; the `pg`
adapter has not yet been exercised against a real PostgreSQL server in this
environment.

**Conclusion of the audit:** no foundation defect blocks B0. One foundation
risk blocks the first *shared-write* chunk and is recorded in §10.

---

## 2. Current Slice A document model

`apps/web/src/types/canvas.ts`:

```ts
interface CanvasElement {
  id: string; type: ElementType
  x: number; y: number; width: number; height: number; rotation: number
  style: { fill: string; stroke: string; strokeWidth: number; opacity: number }
  text?: string; points?: number[]
  createdBy: string
}
```

Authoritative data is the `CanvasElement[]` in `useEditorStore`. Fabric objects
are a projection created by `canvas/elementObjects.ts` and owned by
`canvas/CanvasManager.ts`; `readElement()` writes Fabric state back into the
domain shape. Board persistence is `localStorage["confluo:boards"]` — a full
array rewrite on every commit (`editorStore.commit` → `boardService.update`).

### Stable element IDs

- IDs are generated in `persistenceService.uid()`:
  `element_<base36(Date.now())>_<6 random chars>`.
- They are written once at creation (`CanvasManager`, `duplicate()`), carried in
  an out-of-band `WeakMap` (`elementObjects.registry`), and survive
  `readElement()` and serialization.
- `isCanvasElement()` rejects empty IDs; `sanitizeElements()` keeps the first
  occurrence of a duplicated ID and warns.
- **Implication:** IDs are opaque strings and can be used directly as Y.Map keys.
  Migration must not rewrite them.

### Ordering

Array order is the only z-order information; Fabric renders in insertion order.
There are **no** layer/reorder controls in the UI (`PropertiesToolbar` exposes
fill, stroke, rotate, duplicate, delete). Order therefore equals creation order.

Order is the stored array order: creation order, except after applying a
revision/branch, which replaces the array wholesale. This is the one piece of
Slice A semantics a plain `Y.Map` cannot represent; §3 adds an explicit `z`
field.

---

## 3. Planned Yjs document shape

```
Y.Doc
├─ "elements" : Y.Map<elementId, Y.Map<unknown>>   // one entry per element
└─ "meta"     : Y.Map<unknown>                     // schemaVersion, migratedAt
```

Each element map holds **logical fields only** — never Fabric data, never
serialised Fabric JSON.

| `CanvasElement` | Y.Map field | Value | Atomic unit | Mutable |
|---|---|---|---|---|
| `id` | *map key* | string | — | no |
| `type` | `type` | string | — | **no** (change = delete + create) |
| `x`, `y` | `pos` | `{ x, y }` | **`pos`** | yes |
| `width`, `height` | `size` | `{ w, h }` | **`size`** | yes |
| `rotation` | `rotation` | number | `rotation` | yes |
| `style` | `style` | `{ fill, stroke, strokeWidth, opacity }` | **`style`** | yes |
| `text` | `text` | string | **`text`** | yes |
| `points` | `points` | number[] | **`points`** | yes |
| `createdBy` | `createdBy` | string | — | no |
| *(array index)* | `z` | number | `z` | creation / migration |
| — | `deleted` | boolean | `deleted` | one-way |

### Why these atomic units

- **`pos`** and **`size`** are each one value. Storing `x`/`y` as separate fields
  would allow a torn position (x from one drag, y from another) with no way to
  recover. The geometry bundle wins wholesale, per the milestone rule.
- **`style`** is one value for the same reason: a style change is a single user
  action, and blending `fill` from A with `stroke` from B produces a state
  neither user chose.
- **`text`** is the whole string. Character-level `Y.Text` is tempting but
  changes the domain model and is deferred; see §8.
- **`points`** is one array (freehand already exists in Slice A; Slice B does
  not extend it).
- **`deleted`** is a field, not a key deletion. A removed key would make a
  concurrent field write vanish; a tombstone keeps the winner observable. See §8.

`type` and `createdBy` are immutable after creation. The binding ignores writes
that attempt to change them.

`z` exists only to reproduce Slice A ordering: migration assigns `z = index` in
the stored array; new elements get `max(z) + 1`. Sort ascending, tie-break by
id. Bring-to-front/send-to-back is not implemented in Slice B and would be a
field write on `z`.

The canvas adapter (`createElementObject`) is unchanged: the binding converts a
document snapshot into `CanvasElement[]` and calls `manager.setElements()`.

---

## 4. Document name

Derived, never accepted raw:

```
confluo.board.<boardId>
```

`boardId` must match `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` and describe an existing
board. Anything else (empty, `/`, `:`, `.`, `..`, whitespace, >64 chars) is
rejected before a connection is attempted. Existing IDs (`board_<base36>_<rand>`,
`demo`) satisfy this rule.

The name is a logical key, not a security boundary: without auth (deferred), the
server must still verify that the board exists before allowing a connection.
A helper `documentName(boardId)` / `parseDocumentName(name)` belongs in the
binding module so the rule exists in exactly one place.

---

## 5. Transaction origins and feedback loops

Three origins, all non-serialisable symbols owned by the binding:

| Origin | Used for | Observer action |
|---|---|---|
| `LOCAL_ORIGIN` | writes produced by `CanvasManager.onChange` | **ignore** (canvas already shows it) |
| `MIGRATION_ORIGIN` | one-time Slice A import | ignore (same as local) |
| `STORAGE_ORIGIN` | `Y.applyUpdate` during load | ignore |
| *anything else* (Hocuspocus/provider) | remote peers | **reconcile canvas** |

Rules that break the loop:

1. **Rendering never writes.** `manager.setElements()` is a read-only projection;
   it never emits `onChange`. Only Fabric pointer/text events emit.
2. **Local writes are one transaction of diffs.** `binding.applyLocal(next)`
   compares `next` with the current document and writes only changed
   fields, inside `doc.transact(fn, LOCAL_ORIGIN)`. No per-frame writes: a drag
   is committed once, on `manager.flush()`.
3. **Remote writes never persist or create undo.** The observer calls
   `store.applyRemote(elements)` (implemented in B4), which updates `elements`
   **without** `boardService.update`, **without** pushing `undoStack`, and
   **without** `commit()`. `store.commit()` remains local-gesture only.
4. **One-way subscription direction.** `store.elements` → `manager.setElements`
   is allowed; `store.elements` → document is **not**. The only document writer
   is the binding's `applyLocal`, driven by `onChange`. Toolbar commands (style,
   rotate, duplicate, delete) are dispatched to the manager, which emits through
   the same committed-change feed; they are not `store.elements` → document
   writes.

Text is the one re-entrancy hazard: a remote update must not touch the object
currently being edited. `setElements()` skips a plain `Textbox` because
`isEditing(existing)` is true, but for a sticky note `existing` is the `Group`,
which carries no `isEditing` flag — so that guard does **not** cover an editing
group label. The binding must not rely on `isEditing()` alone. `CanvasManager`
already tracks the object that received `text:editing:entered`, so B1 exposes
that as `isEditingElement(id)` (or the interaction element set) and uses it both
to skip reconciliation and to buffer remote fields for the active gesture.

Echo suppression is handled before rendering, not inside Fabric: a local
transaction reaches the observer with `LOCAL_ORIGIN` and is dropped, so no
reconciliation and no cursor jump occur.

**B3 inbound implementation.** `CanvasBinding` registers `observeDeep` on the
root `elements` map, so a nested element-map mutation arrives at
`path = [elementId]`; a root add/remove arrives on the root map with the changed
id in `keys`. Each transaction is reduced to a set of affected ids and only
those ids are read and projected. `LOCAL_ORIGIN` transactions are dropped
before projection. A remote change for an element that is currently being
text-edited or transformed is deferred; the local commit at gesture end is
written afterwards and wins (LWW). A remote deletion is likewise deferred until
the gesture ends and then removes the Fabric object. Root-key deletions and
tombstones are remembered as suppressed ids so a stale Fabric snapshot cannot
resurrect them.

The observer calls the manager's incremental `applyRemoteElement` /
`removeRemoteElement` methods, never `setElements(projectElements(doc))`, so an
observer call does not scan or rebuild the canvas. Those projection methods do
not emit `onChange`, which keeps remote projection from looping back into
another Yjs transaction. Logical reads use object/group scaling rather than
Fabric's total scaling (which includes canvas zoom), so both local commits and
remote projections stay in world coordinates at any viewport zoom. When a remote
change was deferred for a text editor, the exit commit is forced even if the
local text is unchanged, so the deferred remote value cannot remain in the
document while the canvas shows the local one. B3 uses an in-memory `Y.Doc`; the
store/localStorage path remains authoritative until the B4 cutover.

---

## 6. One-time migration from Slice A JSON

**Authority:** the server, inside the document load path
(`onLoadDocument` / first `afterLoadDocument`), never the browser. Two clients
could otherwise race.

**Guard:** migration runs only when **both** are true:
1. no stored Y.Doc state exists for the board, and
2. `meta.get("schemaVersion")` is absent.

**Procedure — a single transaction:**

```
transact(MIGRATION_ORIGIN):
  for each element of sanitizeElements(board.elements):   // stored order
    require isCanvasElement(element)
    elements.set(element.id, {
      type, pos:{x,y}, size:{w,h}, rotation,
      style:{...}, text?, points?, createdBy,
      z: index,
      deleted: false
    })
  meta.set("schemaVersion", 1)
  meta.set("migratedAt", new Date().toISOString())
```

- The marker is written **atomically with the data**. A crash either leaves no
  document (retry) or a fully migrated document (marker present) — never a
  partial seed that would be re-applied on top.
- Empty boards still get the marker, so migration is not retried forever.
- Invalid records are skipped by `sanitizeElements()` (existing behaviour:
  warn + drop), so malformed Slice A data cannot poison the document.
- IDs are preserved exactly. No re-keying to UUIDs.
- `elements` are inserted in array order with `z = index`, reproducing Slice A
  stacking.
- The migration helper is a pure function `seedDocument(doc, elements)` so it can
  be tested with fixtures without a server.
- Until PostgreSQL exists, the same helper **can** be exercised in B1 against
  the localStorage board payload; the source interface is `elements: unknown`
  validated by the existing schema guard.

---

## 7. PostgreSQL persistence boundary

B0 design below, implemented by B4. The checked-in schema also includes the
`boards` table with board-ID/title/owner constraints and an owner/update index.
See §12 for the implementation summary.

```sql
CREATE TABLE board_documents (
  board_id       text PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  snapshot       bytea NOT NULL,        -- Y.encodeStateAsUpdate(doc)
  snapshot_seq   bigint NOT NULL DEFAULT 0,
  schema_version int    NOT NULL DEFAULT 1,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE board_updates (
  board_id   text   NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  seq        bigint NOT NULL,
  update     bytea  NOT NULL,           -- incremental Yjs update
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, seq)
);
```

**Load:** select the snapshot, then apply `board_updates` for that board ordered
by `seq` with `Y.applyUpdate(doc, update, STORAGE_ORIGIN)`. If no snapshot row
exists, that is the migration trigger (§6).

**Write path (implemented):**
- Hocuspocus `onChange` appends each incremental update to `board_updates`.
- Hocuspocus `onStoreDocument` is debounced and writes a full snapshot plus the
  current log watermark. `onDestroy` flushes pending queue work.
- All writes for one board go through a **per-document serial queue** (one
  in-flight writer). The insert allocates
  `GREATEST(MAX(board_updates.seq), board_documents.snapshot_seq) + 1`, so a
  checkpoint prune cannot reset sequence allocation; the composite primary key
  remains the second guard (retry on conflict).
- Only the server writes. Clients never touch PostgreSQL, and the board ID is
  validated server-side before a write.

**Snapshot / compaction ordering** (one SQL transaction):
1. Read `N = MAX(seq)` for the board and encode the live in-memory document.
2. Upsert `board_documents` with the snapshot and watermark. The stored
   `snapshot_seq` advances monotonically with `GREATEST(...)`.
3. `DELETE FROM board_updates WHERE board_id = $2 AND seq <= N`.
4. Set `PRUNE_UPDATE_LOG=false` to skip step 3 and retain the full log.

Ordering rules:
- **Never delete updates before the covering snapshot commits.** A crash between
  2 and 3 leaves redundant updates; replay is idempotent because Yjs updates are
  commutative and idempotent, so the duplicate application is harmless.
- A crash before 2 leaves the old snapshot and all updates — still correct.
- Compaction runs through the same queue, so it cannot interleave with a write.
- Trigger: Hocuspocus checkpoints after the configured debounce/max debounce.
  If a log exists without a snapshot, load defensively writes one after replay.
- Graceful shutdown awaits the Hocuspocus store path and then drains the queue.

**Why not one "latest state" row only:** losing the incremental log makes
concurrent writers and crash recovery indistinguishable; the snapshot+log pair
gives a deterministic replay point without unbounded growth.

**Not in scope:** partitioning, replication, Redis, multi-node Hocuspocus. One
process, one database.

---

## 8. Conflict semantics

### Same property (LWW)

Yjs resolves two writes to the same field deterministically by client clock, not
by wall time. There is no server arbitration.

| Scenario | Result |
|---|---|
| Two clients move the same element | The winning `pos` write replaces the whole bundle; no x/y blending |
| Two clients resize | Same, on `size` |
| Two clients restyle | Same, on `style` |
| Two clients edit text | Whole-string LWW; the earlier edit is lost (accepted, §9) |
| One client moves, another resizes | Both survive (`pos` and `size` are distinct fields) |
| Same value written twice | No-op; the binding diffs before writing |

### Local ownership during a gesture

While a local Fabric gesture is active for an element, the binding does **not**
apply remote fields for that element. Remote updates are buffered and discarded
at gesture end, when the local field write (now later in the clock) is committed.
The element therefore does not jump under the user's cursor; it converges after
the gesture. This is deliberate temporary divergence, not a merge rule.

### Delete versus update

- Delete writes `deleted = true`. The key is **never** removed.
- A concurrent `pos` write and delete both land; the element is **deleted**
  (hidden), because deletion is a separate field and wins visually.
- An update that arrives after a delete is **ignored** by the binding; there is
  no resurrection in Slice B.
- Two deletes are idempotent.
- Tombstones are retained for the life of the document (no GC in Slice B). GC is
  unsafe without a guarantee that all peers have observed the tombstone; that is
  deferred with offline support.

### Local undo

The existing `editorStore` undo is a **whole-document snapshot**. Applying it in
a shared document would overwrite other users' edits — i.e. collaborative undo,
which is out of scope. Contract: while a document is connected, `undo`/`redo`
are disabled (no-op) unless and until a local inverse-operation history exists.
The UI entry points stay, but must not restore snapshots over remote state.

---

## 9. Explicitly deferred

Not designed, not implemented, not stubbed in Slice B:

- offline-first editing, `y-indexeddb`, offline queue, reconnection merging
- user cursors, presence, viewport synchronisation, avatar presence UI
  (the existing hardcoded collaborator avatars remain static mock markup and are
  **not** wired to Awareness)
- authentication, teams, permissions, document access control
- spatial audio / WebRTC
- collaborative undo/redo (local-only undo is the maximum allowed)
- revision branches and checkpoint history
- minimap, grid snapping, alignment guides
- connectors and freehand drawing (existing support is untouched, not extended)
- production infrastructure: Redis, clustering, CDN, multi-region

---

## 10. Preconditions for the first B1 chunk

These were implemented by B1–B4 and remain part of the contract:

1. **Globally unique element IDs.** `uid()` uses
   `Date.now() + 6 random base36 chars`; `Math.random` is not collision-safe.
   Two clients could mint the same key, and `Y.Map.set` would silently merge two
   elements. Replace element-id generation with `crypto.randomUUID()` (IDs are
   opaque strings, so the document format is unaffected).
   *Why not fixed now:* B0 is explicitly a no-runtime-change milestone; this is
   a one-line change that belongs with the chunk that enables shared creation.
2. **`store.applyRemote(elements)`** — update `elements`/`board` without
   persisting, pushing undo, or setting a false "saved" state.
3. **`z` field** in the element map and ordering on read.
4. **Document-name validation** at the board route/service boundary (§4).
5. **Undo guard** while connected (§8).
6. **Interaction guard for reconciliation.** Expose the tracked editing object
   and the set of elements under an active local gesture
   (`isEditingElement(id)` / `interactionIds()`), so remote updates skip group
   children being edited and are buffered during drags (§5, §8).

---

## 11. Open risks

- **Production PostgreSQL validation:** schema, ordering and compaction are
  exercised through PGlite, but the `pg` adapter has not yet been run against a
  real PostgreSQL server in this environment.
- **Text is LWW**: two users typing in the same note lose one edit. Acceptable
  for B, must be stated in the UI or fixed before calling collaboration "done".
- **Tombstones grow without bound** until GC is designed with offline support.
- **No auth**: anyone who can reach the server and guess a valid board ID can
  join. Board-ID validation proves existence, not authorization. Acceptable only
  for localhost development, never for a deployed build.
- **Persistence failures propagate through Hocuspocus hooks** (`onChange` /
  `onStoreDocument` throw and are logged with board/operation context), but the
  browser receives no durable-save acknowledgement. `Live · server sync` means
  transport/document sync, not a committed checkpoint.
- **z tie-breaks** are deterministic but arbitrary for elements created in the
  same millisecond with colliding `z`; ID ordering resolves them, not user
  intent.
- Hocuspocus persistence hook signatures were validated against the installed
  `@hocuspocus/server@4.7.1` and `@hocuspocus/provider@4.7.1`.

---

## 12. B4 implementation notes

### Backend

`apps/server` is a modular Hocuspocus/Express service inside the repository:

- `src/collaboration/server.ts` validates `confluo.board.<boardId>`, rejects
  unknown boards in `onAuthenticate`, loads/migrates in `onLoadDocument`, appends
  in `onChange`, checkpoints in `onStoreDocument`, and flushes in `onDestroy`.
- `src/collaboration/documentPersistence.ts` owns one serial queue per board.
- `src/collaboration/documentRepository.ts` contains all snapshot/update SQL.
- `src/db/migrations.ts` creates `boards`, `board_documents` and
  `board_updates` with foreign keys, format constraints and an owner/update
  index.
- `src/http/app.ts` provides health/readiness and idempotent board registration
  endpoints. Board metadata is not yet the web app's list source.
- `src/runtime.ts` starts/stops HTTP, collaboration and the database together.

### Browser session

`apps/web/src/collab/session.ts` owns one `Y.Doc`, one
`HocuspocusProvider` and one `CanvasBinding` per opened board. The
`useBoardCollaboration` hook creates/destroys it on board changes and StrictMode
remounts. `CanvasEditor` remains the canvas UI; the binding projects remote
changes directly into Fabric. A derived `store.applyRemote` copy feeds secondary
UI (minimap/inspector) without becoming a document writer, and the editor ignores
that derived copy when reconciling the canvas.

### Migration and durability rules

- The server registers a board idempotently before the first connection.
- Existing Yjs snapshot/log state always wins over legacy JSON.
- With no Yjs state, the server validates the legacy Slice A document, runs the
  B1 helper, writes the initial snapshot at watermark 0, and only then allows
  edits.
- Repeated loads/restarts are idempotent; legacy JSON never overwrites Yjs.
- Update rows are pruned only inside the snapshot transaction and only through
  the watermark. `PRUNE_UPDATE_LOG=false` retains them.
- Snapshots are internal checkpoints, not revision history.

### Honest status and limitations

- Client states are `connecting`, `connected`, `synced`, `disconnected` and
  `error`; the canvas is locked until the initial sync completes.
- `synced` means the provider and document are synchronized, **not** that a
  durable database checkpoint completed.
- There is no offline queue, presence/cursor sync, collaborative undo/redo or
  revision branch feature.
- There is no authentication or authorization. Do not deploy this milestone
  publicly or with private boards until those exist.
- The two-browser smoke test is at
  `apps/server/scripts/collaboration-browser-smoke.ts`; it is manual and requires
  Chrome CDP plus running web/server processes.

## Appendix: files touched by B1–B4

| Concern | File |
|---|---|
| Document schema, origins, migration helper | `apps/web/src/collab/document.ts` (new) |
| Fabric ↔ Yjs diffing | `apps/web/src/collab/CanvasBinding.ts` (new) |
| Store seam for remote updates | `apps/web/src/stores/editorStore.ts` |
| Connection lifecycle | `apps/web/src/components/whiteboard/CanvasEditor.tsx` |
| Browser collaboration session/hook | `apps/web/src/collab/session.ts`, `useBoardCollaboration.ts` |
| Server + persistence | `apps/server/` (new) |
| Schema validation (reused) | `apps/web/src/canvas/elementSchema.ts` |
| Domain type | `apps/web/src/types/canvas.ts` |

