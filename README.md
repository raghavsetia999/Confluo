# Confluo

A multi-user collaborative infinite canvas built with React, Fabric.js, Yjs,
Hocuspocus and PostgreSQL.

## Current status

Implemented:

- Email/password accounts with case-insensitive unique emails
- Server-side sessions stored in PostgreSQL
- `HttpOnly`, `SameSite=Lax` session cookies (`Secure` in production)
- Session-bound CSRF tokens and same-origin checks for browser mutations
- Scrypt password hashing with per-password salts; plaintext passwords are never
  stored
- Board creation, listing, renaming, duplication and deletion
- Stable UUID board IDs and explicit owner/editor memberships
- Joining a board by ID from the dashboard
- Server-side authorization for every HTTP board operation
- Cookie + membership + origin authorization for Hocuspocus WebSocket
  connections
- PostgreSQL-backed users, sessions, boards, memberships and Yjs
  snapshots/update logs
- Fabric.js canvas with create, move, resize, rotate, text, sticky notes,
  delete and real-time Yjs collaboration
- Honest connection status; the canvas is read-only until initial Yjs sync
- One-time migration of legacy Slice A board JSON into Yjs

PostgreSQL (or PGlite locally) is authoritative for users, board metadata,
memberships and collaborative document state. The browser does not store auth
tokens or the authoritative board list in local storage.

## Requirements

- Node.js **22 or newer**
- npm
- PostgreSQL for production, or PGlite for local development
- Chrome only for the optional two-browser smoke test

## Install

Run from the repository root. The repository is an npm workspace with one root
lockfile.

```bash
npm install
```

## Run with PostgreSQL

Create a database and copy the server environment:

```bash
createdb confluo
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
```

Edit `apps/server/.env` with your real `DATABASE_URL`. Run the versioned
migrations, then start the API and web app:

```bash
npm run migrate
npm run dev:server
npm run dev:web
```

Open `http://localhost:5173`. The HTTP API listens on
`http://localhost:4000`; collaboration listens on `ws://localhost:4001` by
default. The browser must use the same hostname for the web app, API and
WebSocket so the session cookie is shared.

## Run locally with PGlite

PGlite runs the same PostgreSQL schema and migration SQL in-process. It is for
local development and tests, not production.

```bash
DATABASE_DRIVER=pglite PGLITE_DATA_DIR=.pglite npm run dev:server
npm run dev:web
```

The PGlite data directory is relative to `apps/server` when started through the
workspace command. Migrations also run automatically at server startup;
`npm run migrate` is available with the same environment variables.

## Environment variables

### Server (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_DRIVER` | `postgres` | `postgres` or local-only `pglite` |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `PGLITE_DATA_DIR` | `.pglite` | PGlite data directory |
| `PORT` | `4000` | HTTP API port |
| `HOCUSPOCUS_PORT` | `4001` | WebSocket collaboration port |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed HTTP and WebSocket browser origin |
| `COOKIE_SECURE` | `NODE_ENV === "production"` | Force the session cookie `Secure` flag |
| `HOCUSPOCUS_DEBOUNCE_MS` | `2000` | Checkpoint debounce |
| `HOCUSPOCUS_MAX_DEBOUNCE_MS` | `10000` | Maximum checkpoint delay |
| `PRUNE_UPDATE_LOG` | `true` | Prune log rows covered by an atomic snapshot/watermark commit |

### Web (`apps/web/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `http://<hostname>:4000` | HTTP API base URL |
| `VITE_COLLAB_WS_URL` | `ws://<hostname>:4001` | Hocuspocus WebSocket URL |

For production HTTPS, serve the web app and API over HTTPS (or a same-site
reverse proxy) so the `Secure` session cookie is sent.

## Accounts and sessions

- `POST /api/auth/register` creates a user and session.
- `POST /api/auth/login` verifies the password and rotates in a new session.
- `GET /api/auth/session` restores the user and returns a CSRF token.
- `POST /api/auth/logout` revokes the current session.

The password hash is scrypt with a random salt and stored parameters. Session
tokens are random 256-bit values; only a SHA-256 hash is stored in
`auth_sessions`. The raw token exists only in the HttpOnly cookie. The CSRF
token is derived from the session hash, kept in browser memory, and required in
`X-CSRF-Token` for authenticated mutations.

## Boards and access

| Endpoint | Behavior |
|---|---|
| `GET /api/boards` | Boards the current user owns or has joined |
| `POST /api/boards` | Create a board; owner comes from the session |
| `GET /api/boards/:id` | Board metadata and members, if the caller is a member |
| `PATCH /api/boards/:id` | Rename; owner only |
| `DELETE /api/boards/:id` | Delete; owner only |
| `POST /api/boards/join` | Add the caller as an editor using a board ID |
| `POST /api/boards/:id/duplicate` | Copy a board the caller can access |
| `GET /api/boards/:id/members` | Members, if the caller is a member |

New board IDs are server-generated UUIDs. They are stable, but they are
identifiers rather than passwords. This milestone deliberately allows any
signed-in user who has a valid board ID to join as an editor. Do not post board
IDs publicly if the board contains private content. Unknown or malformed IDs
return safe `404`/`400` responses.

Board reads, writes, renames, deletes and duplicate operations re-check
membership on the server. The WebSocket server separately authenticates the
session cookie, checks the board membership, and verifies the browser origin
before loading any Yjs state.

## Persistence and durability

Database migrations are versioned in `apps/server/src/db/migrations.ts`:

- `001_boards_and_yjs_state`: boards, Yjs snapshots, append-only updates
- `002_users_sessions_and_memberships`: users, sessions, memberships, legacy
  owner backfill and foreign keys

Each Yjs update received by the server is appended to `board_updates` as
`BYTEA`. Hocuspocus checkpoints are debounced and write a full
`Y.encodeStateAsUpdate(document)` snapshot plus a watermark in one transaction.
Log rows are pruned only when `seq <= watermark`. On load, the server restores
the newest snapshot and replays updates above its watermark in order. Graceful
shutdown flushes pending writes and checkpoints.

A status of `Live · server sync` means the browser synchronized with the server
document. It does **not** mean a database checkpoint has completed. There is no
offline queue or offline editing promise: the canvas is locked until initial
sync and editing is paused if the connection is lost.

## Legacy Slice A migration

When a board is opened:

1. The server loads existing Yjs snapshot/log state if present. Existing Yjs
   state always wins.
2. If no Yjs state exists, the server validates the board and legacy Slice A
   document, converts it with the shared migration helper, and durably writes
   the initial snapshot before allowing edits.
3. Later legacy JSON edits are ignored. Migration cannot overwrite existing Yjs
   state.

Legacy boards created before accounts existed receive a disabled legacy user
and an owner membership during migration so their data remains intact. New
boards do not use the legacy JSON path.

## Commands

From the repository root:

```bash
npm run dev:web
npm run dev:server
npm run migrate
npm test
npm run build
npm run lint --workspace web
npm run typecheck --workspace @confluo/server
```

## Browser collaboration smoke test

The smoke test opens two independent authenticated Chrome contexts. It registers
two accounts, creates a board in browser A, joins it from browser B using the
board ID, then verifies create, move in both directions, sticky-note text,
delete and refresh recovery.

It requires:

- server running on HTTP `4000` and WebSocket `4001`
- Vite on `http://localhost:5173`
- Chrome with remote debugging on port `9222`

```bash
# macOS example
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/confluo-chrome

npm run test:browser --workspace @confluo/server
```

The smoke test creates real accounts and a board in the configured database. It
is a manual integration check, not part of `npm test`.

## Security scope and limitations

- Board IDs are identifiers, not authorization secrets. Anyone with a valid ID
  and an account can join as an editor. Sharing an ID is therefore an access
  decision.
- There is no invite approval, email invitation, email verification, password
  reset or MFA in this milestone.
- The in-process login rate limiter is suitable for a single process, not a
  distributed deployment.
- CSRF protection is token + same-origin based; `SameSite=Lax` is a second
  layer, not a substitute.
- No social login.
- No presence, cursors, collaborative undo/redo or user-visible revision
  history yet.
- No multi-node Hocuspocus, Redis or horizontal scaling.
- PGlite is for local development and the automated test suite. The PostgreSQL
  adapter, migrations and end-to-end browser flow were also verified against
  PostgreSQL 18.6. Validate again against your deployment's PostgreSQL version
  before production.

See [`docs/architecture/slice-b-collaboration.md`](docs/architecture/slice-b-collaboration.md)
for the canvas and persistence design.
