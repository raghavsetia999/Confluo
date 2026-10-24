import pg from "pg"
import type { QueryResultRow } from "pg"

export interface QueryResult<T extends QueryResultRow = QueryResultRow> {
  rows: T[]
  rowCount: number | null
}

export interface SqlExecutor {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>
}

export interface Database extends SqlExecutor {
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>
  close(): Promise<void>
}

const asRowCount = (count: number | null | undefined, rows: number): number =>
  typeof count === "number" ? count : rows

/** Thin production adapter over `pg.Pool`. */
export class PostgresDatabase implements Database {
  private readonly pool: pg.Pool

  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    const result = await this.pool.query<T>(text, values as unknown[])
    return {
      rows: result.rows,
      rowCount: asRowCount(result.rowCount, result.rows.length),
    }
  }

  async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")
      const result = await work({
        query: async <R extends QueryResultRow = QueryResultRow>(
          text: string,
          values: readonly unknown[] = [],
        ) => {
          const queryResult = await client.query<R>(text, values as unknown[])
          return {
            rows: queryResult.rows,
            rowCount: asRowCount(queryResult.rowCount, queryResult.rows.length),
          }
        },
      })
      await client.query("COMMIT")
      return result
    } catch (error) {
      try {
        await client.query("ROLLBACK")
      } catch {
        // Preserve the original failure; rollback errors are not actionable.
      }
      throw error
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

export const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "23505"
