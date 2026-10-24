import type { AddressInfo } from "node:net"
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider"
import WebSocket from "ws"
import * as Y from "yjs"
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
import { documentNameForBoard } from "../../web/src/collab/documentName.ts"

export const createTestDatabase = async (): Promise<Database> => {
  const database = new PGliteDatabase()
  await runMigrations(database)
  return database
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
  const boards = new BoardRepository(database)
  return boards.ensure({
    id: input.id,
    title: input.title ?? "Test board",
    ownerId: input.ownerId ?? "test-owner",
    legacyDocument: { elements: input.elements ?? [] },
  })
}

export interface TestCollaboration {
  server: CollaborationServer
  port: number
  boards: BoardRepository
  documents: DocumentRepository
  persistence: DocumentPersistence
  stop(): Promise<void>
}

export const startTestCollaboration = async (
  database: Database,
): Promise<TestCollaboration> => {
  const boards = new BoardRepository(database)
  const documents = new DocumentRepository(database)
  const persistence = new DocumentPersistence(boards, documents, {
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  })
  const server = createCollaborationServer({
    port: 0,
    boards,
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
    documents,
    persistence,
    stop: () => server.stop(),
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
  options: { rawDocumentName?: string } = {},
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

  const websocketProvider = new HocuspocusProviderWebsocket({
    url: `ws://127.0.0.1:${port}`,
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
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
