import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"
import type { QueryResultRow } from "pg"
import { isUniqueViolation } from "../db/database.ts"
import type { Database } from "../db/database.ts"
import { hashPassword, verifyPassword } from "./password.ts"
import {
  SESSION_TTL_SECONDS,
  sessionTokenFromCookieHeader,
} from "./cookies.ts"

export interface AuthUser {
  id: string
  name: string
  email: string
  createdAt: string
}

export interface AuthSession {
  user: AuthUser
  token: string
  csrfToken: string
  expiresAt: string
}

export interface AuthContext {
  user: AuthUser
  tokenHash: string
  csrfToken: string
  expiresAt: string
}

interface UserRow extends QueryResultRow {
  id: string
  name: string
  email: string
  passwordHash?: string
  createdAt: Date | string
}

interface SessionRow extends UserRow {
  tokenHash: string
  expiresAt: Date | string
}

export class EmailInUseError extends Error {
  constructor() {
    super("An account with this email already exists.")
    this.name = "EmailInUseError"
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Email or password is incorrect.")
    this.name = "InvalidCredentialsError"
  }
}

export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase()

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

const toUser = (row: UserRow): AuthUser => ({
  id: row.id,
  name: row.name,
  email: row.email,
  createdAt: toIso(row.createdAt),
})

const hashSessionToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex")

/**
 * A session-bound CSRF token. It is deterministic from the (unhashed) session
 * token's database hash, so it can be re-derived after a refresh without
 * storing or exposing a second secret.
 */
export const csrfTokenForSessionHash = (tokenHash: string): string =>
  createHmac("sha256", tokenHash)
    .update("confluo:csrf:v1")
    .digest("base64url")

export const csrfTokenMatches = (
  tokenHash: string,
  candidate: string,
): boolean => {
  if (!candidate) return false
  const expected = Buffer.from(csrfTokenForSessionHash(tokenHash))
  const actual = Buffer.from(candidate)
  return (
    expected.length === actual.length && timingSafeEqual(expected, actual)
  )
}

export class AuthService {
  constructor(private readonly database: Database) {}

  async register(input: {
    name: string
    email: string
    password: string
  }): Promise<AuthSession> {
    const email = normalizeEmail(input.email)
    const passwordHash = await hashPassword(input.password)
    const id = randomUUID()
    try {
      await this.database.query(
        `
          INSERT INTO users (id, name, email, password_hash)
          VALUES ($1, $2, $3, $4)
        `,
        [id, input.name.trim(), email, passwordHash],
      )
    } catch (error) {
      if (isUniqueViolation(error)) throw new EmailInUseError()
      throw error
    }
    return this.createSessionForUser(id)
  }

  async login(emailInput: string, password: string): Promise<AuthSession> {
    const email = normalizeEmail(emailInput)
    const result = await this.database.query<UserRow>(
      `
        SELECT id, name, email, password_hash AS "passwordHash",
               created_at AS "createdAt"
        FROM users
        WHERE email = $1
      `,
      [email],
    )
    const row = result.rows[0]
    if (!row?.passwordHash) throw new InvalidCredentialsError()
    const valid = await verifyPassword(password, row.passwordHash)
    if (!valid) throw new InvalidCredentialsError()
    return this.createSessionForUser(row.id)
  }

  async createSessionForUser(userId: string): Promise<AuthSession> {
    const users = await this.database.query<UserRow>(
      `
        SELECT id, name, email, created_at AS "createdAt"
        FROM users
        WHERE id = $1
      `,
      [userId],
    )
    const user = users.rows[0]
    if (!user) throw new Error("Cannot create a session for an unknown user")

    await this.database.query(
      "DELETE FROM auth_sessions WHERE expires_at <= now()",
    )

    const token = randomBytes(32).toString("base64url")
    const tokenHash = hashSessionToken(token)
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000)
    await this.database.query(
      `
        INSERT INTO auth_sessions (token_hash, user_id, expires_at)
        VALUES ($1, $2, $3)
      `,
      [tokenHash, userId, expiresAt],
    )

    return {
      user: toUser(user),
      token,
      csrfToken: csrfTokenForSessionHash(tokenHash),
      expiresAt: expiresAt.toISOString(),
    }
  }

  async authenticateToken(token: string): Promise<AuthContext | null> {
    if (!token) return null
    const tokenHash = hashSessionToken(token)
    const result = await this.database.query<SessionRow>(
      `
        SELECT s.token_hash AS "tokenHash", s.expires_at AS "expiresAt",
               u.id, u.name, u.email, u.created_at AS "createdAt"
        FROM auth_sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()
      `,
      [tokenHash],
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      user: toUser(row),
      tokenHash,
      csrfToken: csrfTokenForSessionHash(tokenHash),
      expiresAt: toIso(row.expiresAt),
    }
  }

  async authenticateCookieHeader(
    header: string | undefined,
  ): Promise<AuthContext | null> {
    const token = sessionTokenFromCookieHeader(header)
    if (!token) return null
    return this.authenticateToken(token)
  }

  async revokeToken(token: string): Promise<void> {
    if (!token) return
    await this.database.query(
      "DELETE FROM auth_sessions WHERE token_hash = $1",
      [hashSessionToken(token)],
    )
  }
}
