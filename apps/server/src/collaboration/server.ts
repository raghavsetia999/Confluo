import { Server } from "@hocuspocus/server"
import type { BoardRepository, BoardRole } from "../boards/boardRepository.ts"
import { parseBoardDocumentName } from "../../../web/src/collab/documentName.ts"
import type { AuthService } from "../auth/authService.ts"
import { sessionTokenFromCookieHeader } from "../auth/cookies.ts"
import type { DocumentPersistence } from "./documentPersistence.ts"

export interface CollaborationContext {
  boardId: string
  userId: string
  role: BoardRole
}

export interface CollaborationServerOptions {
  port: number
  boards: BoardRepository
  auth: AuthService
  allowedOrigin: string
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
    async onAuthenticate({ documentName, requestHeaders, connectionConfig }) {
      const origin = requestHeaders.get("origin")
      if (origin && origin !== options.allowedOrigin) {
        throw new Error("WebSocket origin is not allowed")
      }
      const boardId = parseBoardDocumentName(documentName)
      if (!boardId) {
        throw new Error("Invalid collaboration document name")
      }
      const token = sessionTokenFromCookieHeader(
        requestHeaders.get("cookie") ?? undefined,
      )
      const session = token
        ? await options.auth.authenticateToken(token)
        : null
      if (!session) {
        throw new Error("Authentication required")
      }
      const role = await options.boards.roleFor(boardId, session.user.id)
      if (!role) {
        throw new Error("Board access denied")
      }
      connectionConfig.readOnly = false
      return { boardId, userId: session.user.id, role }
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
