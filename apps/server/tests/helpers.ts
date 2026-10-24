import type { AddressInfo } from "node:net"
import { createServer } from "node:http"
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider"
import WebSocket from "ws"
import * as Y from "yjs"
import { AuthService } from "../src/auth/authService.ts"
import { hashPassword } from "../src/auth/password.ts"
import { BoardRepository } from "../src/boards/boardRepository.ts"
import { DocumentPersistence } from "../src/collaboration/documentPersistence.ts"
import { DocumentRepository } from "../src/collaboration/documentRepository.ts"
import {
  createCollaborationServer,
  type CollaborationServer,
} from "../src/collaboration/server.ts"
import { PGliteDatabase } from "../src/db/pglite-database.ts"
import { runMigrations } from "../src/db/migrations.ts"
import type { Database } from "../src/db/database.ts"
import { createHttpApp } from "../src/http/app.ts"
import { documentNameForBoard } from "../../web/src/collab/documentName.ts"

export const TEST_PASSWORD = "correct-horse-battery"

export const createTestDatabase = async (): Promise<Database> => {
  const database = new PGliteDatabase()
  await runMigrations(database)
  return database
}

export const seedUser = async (
  database: Database,
  input: { id?: string; email?: string; name?: string } = {},
) => {
  const id = input.id ?? "test-user"
  const email =
    input.email ??
    `${id.replace(/[^a-z0-9_-]/gi, ".").toLowerCase()}@example.test`
  await database.query(
    `
      INSERT INTO users (id, name, email, password_hash)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO NOTHING
    `,
    [id, input.name ?? "Test user", email, await hashPassword(TEST_PASSWORD)],
  )
  return { id, email, password: TEST_PASSWORD }
}

export const seedBoard = async (
  database: Database,
  input: {
    id: string
    title?: string
    ownerId?: string
    elements?: unknown[]
  },
) => {
  const owner = await seedUser(database, { id: input.ownerId ?? "test-user" })
  const boards = new BoardRepository(database)
  return boards.ensure({
    id: input.id,
    title: input.title ?? "Test board",
    ownerId: owner.id,
    legacyDocument: { elements: input.elements ?? [] },
  })
}

export interface TestCollaboration {
  server: CollaborationServer
  port: number
  boards: BoardRepository
  auth: AuthService
  documents: DocumentRepository
  persistence: DocumentPersistence
  cookieFor(userId: string): Promise<string>
  stop(): Promise<void>
}

export const startTestCollaboration = async (
  database: Database,
): Promise<TestCollaboration> => {
  const boards = new BoardRepository(database)
  const auth = new AuthService(database)
  const documents = new DocumentRepository(database)
  const persistence = new DocumentPersistence(boards, documents, {
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  })
  const server = createCollaborationServer({
    port: 0,
    boards,
    auth,
    allowedOrigin: "http://localhost:5173",
    persistence,
    debounceMs: 30,
    maxDebounceMs: 100,
    quiet: true,
  })
  await server.start()
  const address = server.server.address as AddressInfo
  return {
    server,
    port: address.port,
    boards,
    auth,
    documents,
    persistence,
    cookieFor: async (userId: string) => {
      const session = await auth.createSessionForUser(userId)
      return `confluo_session=${encodeURIComponent(session.token)}`
    },
    stop: () => server.stop(),
  }
}

export interface TestHttp {
  baseUrl: string
  auth: AuthService
  boards: BoardRepository
  close(): Promise<void>
}

export const startTestHttp = async (database: Database): Promise<TestHttp> => {
  const auth = new AuthService(database)
  const boards = new BoardRepository(database)
  const app = createHttpApp({
    auth,
    boards,
    database,
    corsOrigin: "http://localhost:5173",
    cookieSecure: false,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  })
  const server = createServer(app)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    auth,
    boards,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

export interface TestClient {
  doc: Y.Doc
  provider: HocuspocusProvider
  synced: Promise<void>
  authenticationError: Promise<string>
  destroy(): void
}

export const connectClient = (
  port: number,
  boardId: string,
  options: {
    rawDocumentName?: string
    cookie?: string
    origin?: string
  } = {},
): TestClient => {
  const doc = new Y.Doc()
  let resolveSynced: () => void = () => undefined
  const synced = new Promise<void>((resolve) => {
    resolveSynced = resolve
  })
  let resolveAuthentication: (reason: string) => void = () => undefined
  const authenticationError = new Promise<string>((resolve) => {
    resolveAuthentication = resolve
  })

  const headers: Record<string, string> = {}
  if (options.cookie) headers.Cookie = options.cookie
  if (options.origin) headers.Origin = options.origin
  class CookieWebSocket extends WebSocket {
    constructor(address: string, protocols?: string | string[]) {
      super(
        address,
        protocols,
        Object.keys(headers).length > 0 ? { headers } : undefined,
      )
    }
  }

  const websocketProvider = new HocuspocusProviderWebsocket({
    url: `ws://127.0.0.1:${port}`,
    WebSocketPolyfill: CookieWebSocket as unknown as typeof globalThis.WebSocket,
  })
  const provider = new HocuspocusProvider({
    websocketProvider,
    name: options.rawDocumentName ?? documentNameForBoard(boardId),
    document: doc,
    onSynced: ({ state }) => {
      if (state) resolveSynced()
    },
    onAuthenticationFailed: ({ reason }) => {
      // Hocuspocus deliberately sends a generic reason to clients. The server
      // log keeps the specific malformed-name/board-not-found diagnostics.
      resolveAuthentication(reason)
    },
  })
  // Reusing a socket provider requires an explicit attach; passing a URL
  // directly makes the provider manage its own socket and attach itself.
  provider.attach()

  return {
    doc,
    provider,
    synced,
    authenticationError,
    destroy: () => {
      provider.destroy()
      websocketProvider.destroy()
      doc.destroy()
    },
  }
}

export const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = 5_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for ${message}`)
}

export const waitForSynced = (client: TestClient): Promise<void> =>
  Promise.race([
    client.synced,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timed out waiting for provider sync")), 5_000),
    ),
  ])
