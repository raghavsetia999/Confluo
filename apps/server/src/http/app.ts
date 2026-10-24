import express from "express"
import type { NextFunction, Request, Response } from "express"
import { z } from "zod"
import type { BoardRecord, BoardRepository } from "../boards/boardRepository.ts"
import type { Database } from "../db/database.ts"
import { isValidBoardId } from "../../../web/src/collab/documentName.ts"

const ensureBoardSchema = z.object({
  title: z.string().trim().min(1).max(200),
  ownerId: z.string().trim().min(1).max(200),
  document: z.unknown().optional(),
})

const renameBoardSchema = z.object({
  title: z.string().trim().min(1).max(200),
})

const boardIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)

const publicBoard = (board: BoardRecord) => ({
  id: board.id,
  title: board.title,
  ownerId: board.ownerId,
  createdAt: board.createdAt,
  updatedAt: board.updatedAt,
})

export interface HttpAppOptions {
  boards: BoardRepository
  database: Database
  corsOrigin: string
  logger?: Pick<Console, "error" | "info">
}

export const createHttpApp = (options: HttpAppOptions) => {
  const app = express()
  const logger = options.logger ?? console
  app.disable("x-powered-by")
  app.use(express.json({ limit: "8mb" }))

  app.use((request: Request, response: Response, next: NextFunction) => {
    const origin = request.headers.origin
    if (origin && origin === options.corsOrigin) {
      response.setHeader("Access-Control-Allow-Origin", origin)
      response.setHeader("Vary", "Origin")
    }
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    )
    response.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    )
    if (request.method === "OPTIONS") {
      response.sendStatus(204)
      return
    }
    next()
  })

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" })
  })

  app.get("/api/ready", async (_request, response) => {
    await options.database.query("SELECT 1")
    response.json({ status: "ready" })
  })

  app.get("/api/boards", async (request, response) => {
    const ownerId =
      typeof request.query.ownerId === "string" ? request.query.ownerId : ""
    if (!ownerId) {
      response.status(400).json({ error: "ownerId is required" })
      return
    }
    const boards = await options.boards.list(ownerId)
    response.json({ boards: boards.map(publicBoard) })
  })

  app.get("/api/boards/:id", async (request, response) => {
    const id = boardIdSchema.safeParse(request.params.id)
    if (!id.success) {
      response.status(400).json({ error: "Invalid board id" })
      return
    }
    const board = await options.boards.get(id.data)
    if (!board) {
      response.status(404).json({ error: "Board not found" })
      return
    }
    response.json({ board: publicBoard(board) })
  })

  /**
   * Idempotently registers a Slice A board before its first collaboration
   * connection. The first call stores the legacy document fallback; subsequent
   * calls never overwrite it or the Yjs state.
   */
  app.put("/api/boards/:id", async (request, response) => {
    const id = boardIdSchema.safeParse(request.params.id)
    if (!id.success) {
      response.status(400).json({ error: "Invalid board id" })
      return
    }
    const body = ensureBoardSchema.safeParse(request.body)
    if (!body.success) {
      response.status(400).json({
        error: "Invalid board registration",
        issues: body.error.issues.map((issue) => issue.message),
      })
      return
    }
    const board = await options.boards.ensure({
      id: id.data,
      title: body.data.title,
      ownerId: body.data.ownerId,
      legacyDocument: body.data.document,
    })
    response.status(200).json({ board: publicBoard(board) })
  })

  app.patch("/api/boards/:id", async (request, response) => {
    const id = boardIdSchema.safeParse(request.params.id)
    if (!id.success) {
      response.status(400).json({ error: "Invalid board id" })
      return
    }
    const body = renameBoardSchema.safeParse(request.body)
    if (!body.success) {
      response.status(400).json({ error: "Invalid board title" })
      return
    }
    const board = await options.boards.rename(id.data, body.data.title)
    if (!board) {
      response.status(404).json({ error: "Board not found" })
      return
    }
    response.json({ board: publicBoard(board) })
  })

  app.delete("/api/boards/:id", async (request, response) => {
    const id = boardIdSchema.safeParse(request.params.id)
    if (!id.success) {
      response.status(400).json({ error: "Invalid board id" })
      return
    }
    const removed = await options.boards.remove(id.data)
    response.status(removed ? 204 : 404).end()
  })

  app.use(
    (error: unknown, request: Request, response: Response, _next: NextFunction) => {
      logger.error(
        `[http] ${request.method} ${request.path} failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      )
      if (response.headersSent) return
      response.status(500).json({ error: "Internal server error" })
    },
  )

  return app
}

export const isValidBoardIdInput = isValidBoardId
