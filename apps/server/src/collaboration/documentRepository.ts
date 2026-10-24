import type { QueryResultRow } from "pg"
import type { Database, SqlExecutor } from "../db/database.ts"
import { isUniqueViolation } from "../db/database.ts"

export interface StoredUpdate {
  seq: number
  update: Uint8Array
}

export interface StoredDocumentState {
  snapshot: Uint8Array | null
  snapshotSeq: number
  updates: StoredUpdate[]
}

interface SnapshotRow extends QueryResultRow {
  snapshot: Uint8Array | Buffer
  snapshotSeq: string | number
}

interface UpdateRow extends QueryResultRow {
  seq: string | number
  update: Uint8Array | Buffer
}

const asBytes = (value: Uint8Array | Buffer): Uint8Array =>
  value instanceof Uint8Array ? value : new Uint8Array(value)

const asNumber = (value: string | number): number => {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid persisted sequence number "${String(value)}"`)
  }
  return parsed
}

/**
 * Binary, append-only Yjs storage. Repositories never inspect document
 * contents; callers receive bytes and call `Y.applyUpdate`.
 */
export class DocumentRepository {
  constructor(private readonly database: Database) {}

  async loadState(boardId: string): Promise<StoredDocumentState> {
    return this.database.transaction(async (tx: SqlExecutor) => {
      const snapshotResult = await tx.query<SnapshotRow>(
        `
          SELECT snapshot, snapshot_seq AS "snapshotSeq"
          FROM board_documents
          WHERE board_id = $1
        `,
        [boardId],
      )
      const snapshotRow = snapshotResult.rows[0]
      const snapshotSeq = snapshotRow ? asNumber(snapshotRow.snapshotSeq) : 0
      const updatesResult = await tx.query<UpdateRow>(
        `
          SELECT seq, update
          FROM board_updates
          WHERE board_id = $1 AND seq > $2
          ORDER BY seq ASC
        `,
        [boardId, snapshotSeq],
      )
      return {
        snapshot: snapshotRow ? asBytes(snapshotRow.snapshot) : null,
        snapshotSeq,
        updates: updatesResult.rows.map((row) => ({
          seq: asNumber(row.seq),
          update: asBytes(row.update),
        })),
      }
    })
  }

  async appendUpdate(boardId: string, update: Uint8Array): Promise<number> {
    // One in-process writer per board is already enforced above this repository.
    // The composite primary key remains the final guard; retry only a genuine
    // sequence collision.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const result = await this.database.query<{ seq: string | number }>(
          `
            INSERT INTO board_updates (board_id, seq, update)
            SELECT
              $1,
              GREATEST(
                COALESCE((SELECT MAX(seq) FROM board_updates WHERE board_id = $1), 0),
                COALESCE((SELECT snapshot_seq FROM board_documents WHERE board_id = $1), 0)
              ) + 1,
              $2
            RETURNING seq
          `,
          [boardId, Buffer.from(update)],
        )
        const row = result.rows[0]
        if (!row) throw new Error("The update insert returned no sequence")
        return asNumber(row.seq)
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === 4) throw error
      }
    }
    throw new Error("Unreachable update append retry state")
  }

  async maxSeq(boardId: string): Promise<number> {
    const result = await this.database.query<{ max: string | number | null }>(
      "SELECT MAX(seq) AS max FROM board_updates WHERE board_id = $1",
      [boardId],
    )
    const value = result.rows[0]?.max
    return value === null || value === undefined ? 0 : asNumber(value)
  }

  async initializeSnapshot(
    boardId: string,
    snapshot: Uint8Array,
  ): Promise<boolean> {
    const result = await this.database.query(
      `
        INSERT INTO board_documents (board_id, snapshot, snapshot_seq)
        VALUES ($1, $2, 0)
        ON CONFLICT (board_id) DO NOTHING
      `,
      [boardId, Buffer.from(snapshot)],
    )
    return (result.rowCount ?? 0) > 0
  }

  /**
   * Snapshot and watermark commit in one SQL transaction. Updates at or below
   * the watermark are pruned only after that commit. Rows above it (including
   * any update that raced in while the snapshot was being encoded) always
   * remain.
   */
  async saveSnapshot(
    boardId: string,
    snapshot: Uint8Array,
    watermark: number,
    prune: boolean,
  ): Promise<void> {
    await this.database.transaction(async (tx: SqlExecutor) => {
      await tx.query(
        `
          INSERT INTO board_documents (board_id, snapshot, snapshot_seq)
          VALUES ($1, $2, $3)
          ON CONFLICT (board_id) DO UPDATE
          SET snapshot = EXCLUDED.snapshot,
              snapshot_seq = GREATEST(board_documents.snapshot_seq, EXCLUDED.snapshot_seq),
              updated_at = now()
        `,
        [boardId, Buffer.from(snapshot), watermark],
      )
      if (prune) {
        await tx.query(
          "DELETE FROM board_updates WHERE board_id = $1 AND seq <= $2",
          [boardId, watermark],
        )
      }
    })
  }

  async countUpdates(boardId: string): Promise<number> {
    const result = await this.database.query<{ count: string | number }>(
      "SELECT COUNT(*) AS count FROM board_updates WHERE board_id = $1",
      [boardId],
    )
    return asNumber(result.rows[0]?.count ?? 0)
  }

  async getSnapshotSeq(boardId: string): Promise<number | null> {
    const result = await this.database.query<{ snapshotSeq: string | number }>(
      `
        SELECT snapshot_seq AS "snapshotSeq"
        FROM board_documents
        WHERE board_id = $1
      `,
      [boardId],
    )
    const row = result.rows[0]
    return row ? asNumber(row.snapshotSeq) : null
  }
}
