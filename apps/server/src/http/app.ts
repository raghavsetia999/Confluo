import { randomUUID } from "node:crypto"
import express from "express"
import type { NextFunction, Request, Response } from "express"
import { z } from "zod"
import type { BoardRecord, BoardRepository } from "../boards/boardRepository.ts"
import {
  EmailInUseError,
  InvalidCredentialsError,
  type AuthService,
} from "../auth/authService.ts"
import {
  clearSessionCookie,
  serializeSessionCookie,
  sessionTokenFromCookieHeader,
} from "../auth/cookies.ts"
import type { Database } from "../db/database.ts"
import {
  createRateLimiter,
  requireAuth,
  requireCsrf,
  sameOriginGuard,
} from "./middleware.ts"

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
})

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
})

const createBoardSchema = z.object({
  title: z.string().trim().min(1).max(200),
})

const renameBoardSchema = z.object({
  title: z.string().trim().min(1).max(200),
})

const joinBoardSchema = z.object({
  boardId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),
})

const duplicateBoardSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
})

const boardIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)

const publicBoard = (board: BoardRecord & { role?: string }) => ({
  id: board.id,
  title: board.title,
  ownerId: board.ownerId,
  role: board.role,
  createdAt: board.createdAt,
  updatedAt: board.updatedAt,
})

const firstIssue = (error: z.ZodError): string =>
  error.issues[0]?.message ?? "Invalid request"

export interface HttpAppOptions {
  auth: AuthService
  boards: BoardRepository
  database: Database
  corsOrigin: string
  cookieSecure: boolean
  logger?: Pick<Console, "error" | "info" | "warn">
}

export const createHttpApp = (options: HttpAppOptions) => {
  const app = express()
  const logger = options.logger ?? console
  const authLimit = createRateLimiter(30, 15 * 60 * 1000)
  const setSessionCookie = (response: Response, token: string) => {
    response.setHeader(
      "Set-Cookie",
      serializeSessionCookie(token, { secure: options.cookieSecure }),
    )
  }

  app.disable("x-powered-by")
  app.use(express.json({ limit: "1mb" }))

  app.use((request: Request, response: Response, next: NextFunction) => {
    const origin = request.headers.origin
    if (origin && origin === options.corsOrigin) {
      response.setHeader("Access-Control-Allow-Origin", origin)
      response.setHeader("Access-Control-Allow-Credentials", "true")
      response.setHeader("Vary", "Origin")
    }
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, X-CSRF-Token",
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

  app.use(sameOriginGuard(options.corsOrigin))

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" })
  })

  app.get("/api/ready", async (_request, response) => {
    await options.database.query("SELECT 1")
    response.json({ status: "ready" })
  })

  app.post("/api/auth/register", authLimit, async (request, response) => {
    const body = registerSchema.safeParse(request.body)
    if (!body.success) {
      response.status(400).json({ error: firstIssue(body.error) })
      return
    }
    try {
      const session = await options.auth.register(body.data)
      setSessionCookie(response, session.token)
      response.status(201).json({
        user: session.user,
        csrfToken: session.csrfToken,
      })
    } catch (error) {
      if (error instanceof EmailInUseError) {
        response.status(409).json({ error: error.message })
        return
      }
      throw error
    }
  })

  app.post("/api/auth/login", authLimit, async (request, response) => {
    const body = loginSchema.safeParse(request.body)
    if (!body.success) {
      response.status(400).json({ error: firstIssue(body.error) })
      return
    }
    try {
      const session = await options.auth.login(
        body.data.email,
        body.data.password,
      )
      setSessionCookie(response, session.token)
      response.json({
        user: session.user,
        csrfToken: session.csrfToken,
      })
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        response.status(401).json({ error: error.message })
        return
      }
      throw error
    }
  })

  app.get("/api/auth/session", async (request, response) => {
    const token = sessionTokenFromCookieHeader(request.headers.cookie)
    const context = token
      ? await options.auth.authenticateToken(token)
      : null
    if (!context) {
      if (token) {
        response.setHeader("Set-Cookie", clearSessionCookie(options.cookieSecure))
      }
      response.json({ user: null })
      return
    }
    response.json({
      user: context.user,
      csrfToken: context.csrfToken,
    })
  })

  app.post(
    "/api/auth/logout",
    requireAuth(options.auth),
    requireCsrf,
    async (request, response) => {
      const token = sessionTokenFromCookieHeader(request.headers.cookie)
      if (token) await options.auth.revokeToken(token)
      response.setHeader("Set-Cookie", clearSessionCookie(options.cookieSecure))
      response.status(204).end()
    },
  )

  app.get(
    "/api/boards",
    requireAuth(options.auth),
    async (request, response) => {
      const boards = await options.boards.listForUser(request.auth!.user.id)
      response.json({ boards: boards.map(publicBoard) })
    },
  )

  app.post(
    "/api/boards",
    requireAuth(options.auth),
    requireCsrf,
    async (request, response) => {
      const body = createBoardSchema.safeParse(request.body)
      if (!body.success) {
        response.status(400).json({ error: firstIssue(body.error) })
        return
      }
      const board = await options.boards.create({
        id: randomUUID(),
        title: body.data.title,
        ownerId: request.auth!.user.id,
      })
      response.status(201).json({
        board: publicBoard({ ...board, role: "owner" }),
      })
    },
  )

  app.post(
    "/api/boards/join",
    requireAuth(options.auth),
    requireCsrf,
    async (request, response) => {
      const body = joinBoardSchema.safeParse(request.body)
      if (!body.success) {
        response.status(400).json({ error: "Invalid board id" })
        return
      }
      const board = await options.boards.join(
        body.data.boardId,
        request.auth!.user.id,
      )
      if (!board) {
        response.status(404).json({ error: "Board not found" })
        return
      }
      response.json({ board: publicBoard(board) })
    },
  )

  app.get(
    "/api/boards/:id/members",
    requireAuth(options.auth),
    async (request, response) => {
      const id = boardIdSchema.safeParse(request.params.id)
      if (!id.success) {
        response.status(400).json({ error: "Invalid board id" })
        return
      }
      const board = await options.boards.getForUser(
        id.data,
        request.auth!.user.id,
      )
      if (!board) {
        response.status(404).json({ error: "Board not found" })
        return
      }
      const members = await options.boards.members(board.id)
      response.json({ members })
    },
  )

  app.get(
    "/api/boards/:id",
    requireAuth(options.auth),
    async (request, response) => {
      const id = boardIdSchema.safeParse(request.params.id)
      if (!id.success) {
        response.status(400).json({ error: "Invalid board id" })
        return
      }
      const board = await options.boards.getForUser(
        id.data,
        request.auth!.user.id,
      )
      if (!board) {
        response.status(404).json({ error: "Board not found" })
        return
      }
      const members = await options.boards.members(board.id)
      response.json({ board: publicBoard(board), members })
    },
  )

  app.patch(
    "/api/boards/:id",
    requireAuth(options.auth),
    requireCsrf,
    async (request, response) => {
      const id = boardIdSchema.safeParse(request.params.id)
      if (!id.success) {
        response.status(400).json({ error: "Invalid board id" })
        return
      }
      const body = renameBoardSchema.safeParse(request.body)
      if (!body.success) {
        response.status(400).json({ error: firstIssue(body.error) })
        return
      }
      const access = await options.boards.getForUser(
        id.data,
        request.auth!.user.id,
      )
      if (!access) {
        response.status(404).json({ error: "Board not found" })
        return
      }
      if (access.role !== "owner") {
        response
          .status(403)
          .json({ error: "Only the board owner can rename this board" })
        return
      }
      const board = await options.boards.rename(id.data, body.data.title)
      if (!board) {
        response.status(404).json({ error: "Board not found" })
        return
      }
      response.json({ board: publicBoard({ ...board, role: access.role }) })
    },
  )

  app.post(
    "/api/boards/:id/duplicate",
    requireAuth(options.auth),
    requireCsrf,
    async (request, response) => {
      const id = boardIdSchema.safeParse(request.params.id)
      if (!id.success) {
        response.status(400).json({ error: "Invalid board id" })
        return
      }
      const body = duplicateBoardSchema.safeParse(request.body ?? {})
      if (!body.success) {
        response.status(400).json({ error: firstIssue(body.error) })
        return
      }
      const access = await options.boards.getForUser(
        id.data,
        request.auth!.user.id,
      )
      if (!access) {
        response.status(404).json({ error: "Board not found" })
        return
      }
      const board = await options.boards.duplicateForUser(
        access,
        request.auth!.user.id,
        randomUUID(),
        body.data.title ?? `${access.title} copy`,
      )
      response.status(201).json({
        board: publicBoard({ ...board, role: "owner" }),
      })
    },
  )

  app.delete(
    "/api/boards/:id",
    requireAuth(options.auth),
    requireCsrf,
    async (request, response) => {
      const id = boardIdSchema.safeParse(request.params.id)
      if (!id.success) {
        response.status(400).json({ error: "Invalid board id" })
        return
      }
      const access = await options.boards.getForUser(
        id.data,
        request.auth!.user.id,
      )
      if (!access) {
        response.status(404).json({ error: "Board not found" })
        return
      }
      if (access.role !== "owner") {
        response
          .status(403)
          .json({ error: "Only the board owner can delete this board" })
        return
      }
      await options.boards.remove(id.data)
      response.status(204).end()
    },
  )

  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "Not found" })
  })

  app.use(
    (
      error: unknown,
      request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      logger.error(
        `[http] ${request.method} ${request.path} failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      )
      if (response.headersSent) return
      if (error instanceof SyntaxError) {
        response.status(400).json({ error: "Invalid JSON body" })
        return
      }
      response.status(500).json({ error: "Internal server error" })
    },
  )

  return app
}
