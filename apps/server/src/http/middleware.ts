import type { NextFunction, Request, Response } from "express"
import type { AuthContext, AuthService } from "../auth/authService.ts"
import { csrfTokenMatches } from "../auth/authService.ts"
import { sessionTokenFromCookieHeader } from "../auth/cookies.ts"

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext
    }
  }
}

export const requireAuth =
  (auth: AuthService) =>
  async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    const token = sessionTokenFromCookieHeader(request.headers.cookie)
    if (!token) {
      response.status(401).json({ error: "Authentication required" })
      return
    }
    const context = await auth.authenticateToken(token)
    if (!context) {
      response.status(401).json({ error: "Authentication required" })
      return
    }
    request.auth = context
    next()
  }

export const requireCsrf = (
  request: Request,
  response: Response,
  next: NextFunction,
): void => {
  if (!request.auth) {
    response.status(401).json({ error: "Authentication required" })
    return
  }
  const candidate = request.get("x-csrf-token") ?? ""
  if (!csrfTokenMatches(request.auth.tokenHash, candidate)) {
    response.status(403).json({ error: "Invalid CSRF token" })
    return
  }
  next()
}

export const sameOriginGuard =
  (corsOrigin: string) =>
  (request: Request, response: Response, next: NextFunction): void => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      next()
      return
    }
    const origin = request.get("origin")
    if (origin && origin !== corsOrigin) {
      response.status(403).json({ error: "Cross-origin request rejected" })
      return
    }
    next()
  }

interface RateBucket {
  count: number
  resetAt: number
}

/**
 * Small in-process limiter for the credential endpoints. A shared deployment
 * can replace it with a gateway or Redis-backed limiter later.
 */
export const createRateLimiter = (limit: number, windowMs: number) => {
  const buckets = new Map<string, RateBucket>()
  return (request: Request, response: Response, next: NextFunction): void => {
    const now = Date.now()
    const key = `${request.ip ?? "unknown"}:${request.path}`
    let bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs }
      buckets.set(key, bucket)
    }
    bucket.count += 1
    if (bucket.count > limit) {
      response
        .status(429)
        .json({ error: "Too many attempts. Try again in a few minutes." })
      return
    }
    if (buckets.size > 10_000) {
      for (const [candidate, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(candidate)
      }
    }
    next()
  }
}
