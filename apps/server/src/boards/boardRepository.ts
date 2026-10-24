import type { QueryResultRow } from "pg"
import type { Database, SqlExecutor } from "../db/database.ts"

export type BoardRole = "owner" | "editor"

export interface BoardRecord {
  id: string
  title: string
  ownerId: string
  legacyDocument: unknown
  createdAt: string
  updatedAt: string
}

export interface BoardAccessRecord extends BoardRecord {
  role: BoardRole
}

export interface BoardMemberRecord {
  userId: string
  name: string
  email: string
  role: BoardRole
  joinedAt: string
}

interface BoardRow extends QueryResultRow {
  id: string
  title: string
  ownerId: string
  legacyDocument: unknown
  role?: BoardRole
  createdAt: Date | string
  updatedAt: Date | string
}

interface MemberRow extends QueryResultRow {
  userId: string
  name: string
  email: string
  role: BoardRole
  joinedAt: Date | string
}

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

const mapBoard = (row: BoardRow): BoardRecord => ({
  id: row.id,
  title: row.title,
  ownerId: row.ownerId,
  legacyDocument: row.legacyDocument,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
})

const mapAccess = (row: BoardRow): BoardAccessRecord => ({
  ...mapBoard(row),
  role: row.role ?? "editor",
})

const BOARD_COLUMNS = `
  b.id, b.title, b.owner_id AS "ownerId",
  b.legacy_document AS "legacyDocument",
  b.created_at AS "createdAt", b.updated_at AS "updatedAt"
`

export interface EnsureBoardInput {
  id: string
  title: string
  ownerId: string
  legacyDocument: unknown
}

export interface CreateBoardInput {
  id: string
  title: string
  ownerId: string
}

/**
 * Board metadata, membership and access checks. Ownership is always derived
 * from the authenticated user by the HTTP layer, never from a request body.
 */
export class BoardRepository {
  constructor(private readonly database: Database) {}

  private async selectBoard(
    executor: SqlExecutor,
    id: string,
  ): Promise<BoardRecord | null> {
    const result = await executor.query<BoardRow>(
      `
        SELECT ${BOARD_COLUMNS}
        FROM boards b
        WHERE b.id = $1
      `,
      [id],
    )
    const row = result.rows[0]
    return row ? mapBoard(row) : null
  }

  /**
   * Internal/legacy helper used by tests and one-time migrations. HTTP board
   * creation uses `create`, which rejects duplicate IDs instead of reusing them.
   */
  async ensure(input: EnsureBoardInput): Promise<BoardRecord> {
    return this.database.transaction(async (tx) => {
      await tx.query(
        `
          INSERT INTO boards (id, title, owner_id, legacy_document)
          VALUES ($1, $2, $3, $4::jsonb)
          ON CONFLICT (id) DO NOTHING
        `,
        [
          input.id,
          input.title,
          input.ownerId,
          input.legacyDocument === undefined
            ? null
            : JSON.stringify(input.legacyDocument),
        ],
      )
      const board = await this.selectBoard(tx, input.id)
      if (!board) {
        throw new Error(`Board "${input.id}" disappeared while registering it`)
      }
      await tx.query(
        `
          INSERT INTO board_memberships (board_id, user_id, role)
          VALUES ($1, $2, 'owner')
          ON CONFLICT (board_id, user_id) DO NOTHING
        `,
        [input.id, input.ownerId],
      )
      return board
    })
  }

  async create(input: CreateBoardInput): Promise<BoardRecord> {
    return this.database.transaction(async (tx) => {
      await tx.query(
        `
          INSERT INTO boards (id, title, owner_id)
          VALUES ($1, $2, $3)
        `,
        [input.id, input.title, input.ownerId],
      )
      await tx.query(
        `
          INSERT INTO board_memberships (board_id, user_id, role)
          VALUES ($1, $2, 'owner')
        `,
        [input.id, input.ownerId],
      )
      const board = await this.selectBoard(tx, input.id)
      if (!board) throw new Error("The board insert returned no row")
      return board
    })
  }

  async get(id: string): Promise<BoardRecord | null> {
    return this.selectBoard(this.database, id)
  }

  async getForUser(
    id: string,
    userId: string,
  ): Promise<BoardAccessRecord | null> {
    const result = await this.database.query<BoardRow>(
      `
        SELECT ${BOARD_COLUMNS}, m.role
        FROM boards b
        JOIN board_memberships m ON m.board_id = b.id
        WHERE b.id = $1 AND m.user_id = $2
      `,
      [id, userId],
    )
    const row = result.rows[0]
    return row ? mapAccess(row) : null
  }

  async exists(id: string): Promise<boolean> {
    const result = await this.database.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM boards WHERE id = $1) AS exists",
      [id],
    )
    return result.rows[0]?.exists === true
  }

  async roleFor(boardId: string, userId: string): Promise<BoardRole | null> {
    const result = await this.database.query<{ role: BoardRole }>(
      `
        SELECT role FROM board_memberships
        WHERE board_id = $1 AND user_id = $2
      `,
      [boardId, userId],
    )
    return result.rows[0]?.role ?? null
  }

  async list(ownerId: string): Promise<BoardRecord[]> {
    const result = await this.database.query<BoardRow>(
      `
        SELECT ${BOARD_COLUMNS}
        FROM boards b
        WHERE b.owner_id = $1
        ORDER BY b.updated_at DESC, b.id ASC
      `,
      [ownerId],
    )
    return result.rows.map(mapBoard)
  }

  /** Owned and joined boards, newest activity first. */
  async listForUser(userId: string): Promise<BoardAccessRecord[]> {
    const result = await this.database.query<BoardRow>(
      `
        SELECT ${BOARD_COLUMNS}, m.role
        FROM boards b
        JOIN board_memberships m ON m.board_id = b.id
        WHERE m.user_id = $1
        ORDER BY b.updated_at DESC, b.id ASC
      `,
      [userId],
    )
    return result.rows.map(mapAccess)
  }

  /**
   * Join by board ID in one transaction. The board row is locked long enough to
   * add the membership, so a concurrent delete cannot leave an orphaned join or
   * turn a missing board into a foreign-key error.
   */
  async join(
    boardId: string,
    userId: string,
  ): Promise<BoardAccessRecord | null> {
    return this.database.transaction(async (tx) => {
      const boards = await tx.query<BoardRow>(
        `
          SELECT ${BOARD_COLUMNS}
          FROM boards b
          WHERE b.id = $1
          FOR SHARE
        `,
        [boardId],
      )
      const row = boards.rows[0]
      if (!row) return null
      await tx.query(
        `
          INSERT INTO board_memberships (board_id, user_id, role)
          VALUES ($1, $2, 'editor')
          ON CONFLICT (board_id, user_id) DO NOTHING
        `,
        [boardId, userId],
      )
      const membership = await tx.query<{ role: BoardRole }>(
        `
          SELECT role FROM board_memberships
          WHERE board_id = $1 AND user_id = $2
        `,
        [boardId, userId],
      )
      const role = membership.rows[0]?.role
      if (!role) throw new Error("Membership insert did not persist")
      return { ...mapBoard(row), role }
    })
  }

  async members(boardId: string): Promise<BoardMemberRecord[]> {
    const result = await this.database.query<MemberRow>(
      `
        SELECT m.user_id AS "userId", u.name, u.email, m.role,
               m.created_at AS "joinedAt"
        FROM board_memberships m
        JOIN users u ON u.id = m.user_id
        WHERE m.board_id = $1
        ORDER BY CASE WHEN m.role = 'owner' THEN 0 ELSE 1 END,
                 m.created_at ASC
      `,
      [boardId],
    )
    return result.rows.map((row) => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
      role: row.role,
      joinedAt: toIso(row.joinedAt),
    }))
  }

  async rename(id: string, title: string): Promise<BoardRecord | null> {
    const result = await this.database.query<BoardRow>(
      `
        UPDATE boards b
        SET title = $2, updated_at = now()
        WHERE b.id = $1
        RETURNING ${BOARD_COLUMNS}
      `,
      [id, title],
    )
    const row = result.rows[0]
    return row ? mapBoard(row) : null
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.database.query(
      "DELETE FROM boards WHERE id = $1",
      [id],
    )
    return (result.rowCount ?? 0) > 0
  }

  /**
   * Copy metadata plus the persisted binary Yjs state into a board owned by
   * the requesting user. Board IDs and membership stay isolated.
   */
  async duplicateForUser(
    source: BoardRecord,
    userId: string,
    id: string,
    title: string,
  ): Promise<BoardRecord> {
    return this.database.transaction(async (tx) => {
      await tx.query(
        `
          INSERT INTO boards (id, title, owner_id, legacy_document)
          VALUES ($1, $2, $3, $4::jsonb)
        `,
        [
          id,
          title,
          userId,
          source.legacyDocument === undefined
            ? null
            : JSON.stringify(source.legacyDocument),
        ],
      )
      await tx.query(
        `
          INSERT INTO board_memberships (board_id, user_id, role)
          VALUES ($1, $2, 'owner')
        `,
        [id, userId],
      )
      await tx.query(
        `
          INSERT INTO board_documents
            (board_id, snapshot, snapshot_seq, schema_version)
          SELECT $1, snapshot, snapshot_seq, schema_version
          FROM board_documents
          WHERE board_id = $2
        `,
        [id, source.id],
      )
      await tx.query(
        `
          INSERT INTO board_updates (board_id, seq, update, created_at)
          SELECT $1, seq, update, created_at
          FROM board_updates
          WHERE board_id = $2
        `,
        [id, source.id],
      )
      const board = await this.selectBoard(tx, id)
      if (!board) throw new Error("The duplicated board insert returned no row")
      return board
    })
  }

  async touch(id: string): Promise<void> {
    await this.database.query(
      "UPDATE boards SET updated_at = now() WHERE id = $1",
      [id],
    )
  }
}
