import { Server } from "@hocuspocus/server"
import type { BoardRepository } from "../boards/boardRepository.ts"
import { parseBoardDocumentName } from "../../../web/src/collab/documentName.ts"
import type { DocumentPersistence } from "./documentPersistence.ts"

export interface CollaborationContext {
  boardId: string
}

export interface CollaborationServerOptions {
  port: number
  boards: BoardRepository
  persistence: DocumentPersistence
  debounceMs: number
  maxDebounceMs: number
  quiet?: boolean
}

export interface CollaborationServer {
  server: Server<CollaborationContext>
  start(): Promise<void>
  stop(): Promise<void>
}

const boardIdFrom = (
  documentName: string,
  context?: CollaborationContext,
): string => {
  const parsed = parseBoardDocumentName(documentName)
  if (!parsed) {
    throw new Error(`Rejected malformed collaboration document "${documentName}"`)
  }
  if (context?.boardId && context.boardId !== parsed) {
    throw new Error("Collaboration document/context mismatch")
  }
  return parsed
}

export const createCollaborationServer = (
  options: CollaborationServerOptions,
): CollaborationServer => {
  const server = new Server<CollaborationContext>({
    name: "confluo-collaboration",
    port: options.port,
    debounce: options.debounceMs,
    maxDebounce: options.maxDebounceMs,
    quiet: options.quiet ?? true,
    websocketOptions: {
      maxPayload: 5 * 1024 * 1024,
    },
    async onAuthenticate({ documentName, connectionConfig }) {
      const boardId = parseBoardDocumentName(documentName)
      if (!boardId) {
        throw new Error("Invalid collaboration document name")
      }
      if (!(await options.boards.exists(boardId))) {
        throw new Error("Board not found")
      }
      // Slice A has no authentication. This establishes existence, not
      // authorization; see docs/architecture/slice-b-collaboration.md.
      connectionConfig.readOnly = false
      return { boardId }
    },
    async onLoadDocument({ documentName, document, context }) {
      const boardId = boardIdFrom(documentName, context)
      await options.persistence.loadOrMigrate(boardId, document)
      return document
    },
    async onChange({ documentName, update, context }) {
      const boardId = boardIdFrom(documentName, context)
      await options.persistence.appendUpdate(boardId, update)
    },
    async onStoreDocument({ documentName, document, lastContext }) {
      const boardId = boardIdFrom(documentName, lastContext)
      await options.persistence.checkpoint(boardId, document)
    },
    async onDestroy() {
      await options.persistence.flush()
    },
  })

  return {
    server,
    async start() {
      await server.listen()
    },
    async stop() {
      await server.destroy()
      await options.persistence.flush()
    },
  }
}
