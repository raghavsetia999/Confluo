import type { QueryResultRow } from "pg"
import type { Database } from "../db/database.ts"

export interface BoardRecord {
  id: string
  title: string
  ownerId: string
  legacyDocument: unknown
  createdAt: string
  updatedAt: string
}

interface BoardRow extends QueryResultRow {
  id: string
  title: string
  ownerId: string
  legacyDocument: unknown
  createdAt: Date | string
  updatedAt: Date | string
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

const SELECT_BOARD = `
  SELECT id, title, owner_id AS "ownerId", legacy_document AS "legacyDocument",
         created_at AS "createdAt", updated_at AS "updatedAt"
  FROM boards
`

export interface EnsureBoardInput {
  id: string
  title: string
  ownerId: string
  legacyDocument: unknown
}

/**
 * Board metadata is application-owned. The first registration supplies the
 * Slice A JSON fallback; later registrations never overwrite it or the Yjs
 * state.
 */
export class BoardRepository {
  constructor(private readonly database: Database) {}

  async ensure(input: EnsureBoardInput): Promise<BoardRecord> {
    const inserted = await this.database.query<BoardRow>(
      `
        INSERT INTO boards (id, title, owner_id, legacy_document)
        VALUES ($1, $2, $3, $4::jsonb)
        ON CONFLICT (id) DO NOTHING
        RETURNING id, title, owner_id AS "ownerId",
                  legacy_document AS "legacyDocument",
                  created_at AS "createdAt", updated_at AS "updatedAt"
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
    if (inserted.rows[0]) return mapBoard(inserted.rows[0])

    const existing = await this.get(input.id)
    if (!existing) {
      throw new Error(`Board "${input.id}" disappeared while registering it`)
    }
    return existing
  }

  async get(id: string): Promise<BoardRecord | null> {
    const result = await this.database.query<BoardRow>(
      `${SELECT_BOARD} WHERE id = $1`,
      [id],
    )
    const row = result.rows[0]
    return row ? mapBoard(row) : null
  }

  async exists(id: string): Promise<boolean> {
    const result = await this.database.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM boards WHERE id = $1) AS exists",
      [id],
    )
    return result.rows[0]?.exists === true
  }

  async list(ownerId: string): Promise<BoardRecord[]> {
    const result = await this.database.query<BoardRow>(
      `${SELECT_BOARD} WHERE owner_id = $1 ORDER BY updated_at DESC, id ASC`,
      [ownerId],
    )
    return result.rows.map(mapBoard)
  }

  async rename(id: string, title: string): Promise<BoardRecord | null> {
    const result = await this.database.query<BoardRow>(
      `
        UPDATE boards
        SET title = $2, updated_at = now()
        WHERE id = $1
        RETURNING id, title, owner_id AS "ownerId",
                  legacy_document AS "legacyDocument",
                  created_at AS "createdAt", updated_at AS "updatedAt"
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

  async touch(id: string): Promise<void> {
    await this.database.query(
      "UPDATE boards SET updated_at = now() WHERE id = $1",
      [id],
    )
  }
}
