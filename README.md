# Confluo

A collaborative infinite canvas built with React, Fabric.js, Yjs and Hocuspocus.

## Current status: Slice B (B0–B4) implemented

- Fabric.js canvas with create, move, resize, rotate, text, sticky notes and delete
- Real-time canvas collaboration over Hocuspocus WebSockets
- One Yjs document per board in the form `confluo.board.<boardId>`
- Server-owned PostgreSQL persistence:
  - append-only binary Yjs update log
  - binary snapshots with an explicit update watermark
  - serialized per-board writes and checkpoint compaction
- One-time migration from the existing Slice A board JSON
- Honest connection status and read-only canvas while unsynced
- Local Slice A JSON remains a read-only fallback for canvas contents

The canvas document is authoritative in Yjs once a board has been opened
collaboratively. Board title/list metadata is still read from the web app's
local board storage; the server keeps a matching board record for validation and
persistence ownership.

## Requirements

- Node.js **22 or newer** (Hocuspocus v4)
- npm
- PostgreSQL for production, or PGlite for local development

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
```

Edit `apps/server/.env` with your `DATABASE_URL`, then run migrations and start
the servers:

```bash
npm run migrate
npm run dev:server
npm run dev:web
```

Open `http://localhost:5173`.

The HTTP API listens on `http://localhost:4000` and collaboration listens on
`ws://localhost:4001` by default. The web app needs a matching
`apps/web/.env`:

```bash
cp apps/web/.env.example apps/web/.env
```

## Run locally with PGlite

PGlite runs the same PostgreSQL schema in-process. It is intended for local
development and tests, not production.

```bash
DATABASE_DRIVER=pglite PGLITE_DATA_DIR=.pglite npm run dev:server
npm run dev:web
```

The PGlite data directory is relative to `apps/server` when started through the
workspace command. Migrations run automatically at server startup; `npm run
migrate` is also available with the same environment variables.

## Environment variables

### Server (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_DRIVER` | `postgres` | `postgres` or local-only `pglite` |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `PGLITE_DATA_DIR` | `.pglite` | PGlite data directory |
| `PORT` | `4000` | HTTP API port |
| `HOCUSPOCUS_PORT` | `4001` | WebSocket collaboration port |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed HTTP API browser origin |
| `HOCUSPOCUS_DEBOUNCE_MS` | `2000` | Checkpoint debounce |
| `HOCUSPOCUS_MAX_DEBOUNCE_MS` | `10000` | Maximum checkpoint delay |
| `PRUNE_UPDATE_LOG` | `true` | Prune log rows covered by an atomic snapshot/watermark commit |

### Web (`apps/web/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `http://<hostname>:4000` | HTTP API base URL |
| `VITE_COLLAB_WS_URL` | `ws://<hostname>:4001` | Hocuspocus WebSocket URL |

## Persistence and durability

- Each Yjs update received by the server is appended to `board_updates` as
  `BYTEA`.
- Hocuspocus checkpoints are debounced and write a full
  `Y.encodeStateAsUpdate(document)` snapshot plus a watermark.
- Snapshot and watermark commit atomically. Log rows are pruned only when
  `seq <= watermark`, through the same per-board serial queue.
- On load, the server restores the newest snapshot and replays updates above its
  watermark in sequence order.
- Graceful shutdown flushes pending writes and checkpoints.
- Snapshots are internal durability checkpoints, not user-visible revisions.

**Durability signaling is intentionally limited.** A status of
`Live · server sync` means the client is connected and has synchronized with the
server document. It does **not** mean a database checkpoint has completed, and
there is no durable-save acknowledgement in the UI. A disconnected status means
in-memory changes may be lost if the process fails.

There is no offline queue and no offline editing promise. The canvas is locked
until the initial shared document sync completes, and editing is paused if the
connection is lost.

## Legacy Slice A migration

When a board is opened:

1. The web app idempotently registers it with `PUT /api/boards/:id`.
2. The server loads existing Yjs snapshot/log state if present. Existing Yjs
   state always wins.
3. If no Yjs state exists, the server validates the board and legacy Slice A
   document, converts it with the shared B1 migration helper, and durably writes
   the initial Yjs snapshot before allowing edits.
4. Later legacy JSON edits are ignored. The migration cannot overwrite existing
   Yjs state.

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

The smoke test opens two independent browser contexts and verifies create, move,
text, delete and refresh convergence. It requires:

- PostgreSQL or PGlite server running on port `4001` WebSocket / `4000` HTTP
- Vite on `http://localhost:5173`
- Chrome with remote debugging on port `9222`
- the demo board route to work

```bash
# macOS example
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/confluo-chrome

npm run test:browser --workspace @confluo/server
```

The smoke test mutates the `demo` board by adding and moving rectangles. It is a
manual integration check, not part of `npm test`.

## Security warning

**This milestone is not safe for a private or public deployment.**

- There is no authentication, authorization, or membership model.
- Board-ID validation establishes that a board exists; it does **not** establish
  that the caller is allowed to access it.
- The HTTP API accepts caller-supplied owner IDs and board metadata.
- The WebSocket server does not authenticate tokens or verify origin ownership.
- Anyone who can reach the collaboration port and knows or guesses a valid board
  ID can open that board.

Use this only on localhost or an otherwise trusted development machine until
authentication and permissions are implemented.

## Explicitly deferred

- Authentication, teams and permissions
- Presence, cursors, avatars and viewport synchronization
- Offline-first editing, `y-indexeddb` and offline queues
- Collaborative undo/redo
- User-visible revision branches
- Spatial audio
- Multi-node Hocuspocus, Redis and production scaling
