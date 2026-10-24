import { PGlite } from "@electric-sql/pglite"
import type { QueryResultRow } from "pg"
import type { Database, QueryResult, SqlExecutor } from "./database.ts"

/**
 * Local-development/test adapter. It is PostgreSQL compiled to WebAssembly,
 * so the repository and migration SQL are exercised rather than mocked.
 * Production uses `PostgresDatabase` with a normal PostgreSQL connection.
 */
export class PGliteDatabase implements Database {
  private readonly db: PGlite

  constructor(dataDir?: string) {
    this.db = dataDir ? new PGlite(dataDir) : new PGlite()
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    const result = await this.db.query<T>(text, values as unknown[])
    return {
      rows: result.rows,
      rowCount: result.affectedRows ?? result.rows.length,
    }
  }

  async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) =>
      work({
        query: async <R extends QueryResultRow = QueryResultRow>(
          text: string,
          values: readonly unknown[] = [],
        ) => {
          const result = await tx.query<R>(text, values as unknown[])
          return {
            rows: result.rows,
            rowCount: result.affectedRows ?? result.rows.length,
          }
        },
      }),
    )
  }

  async close(): Promise<void> {
    await this.db.close()
  }
}

export const createPGliteDatabase = async (dataDir: string): Promise<Database> => {
  const database = new PGliteDatabase(dataDir)
  await database.query("SELECT 1")
  return database
}
