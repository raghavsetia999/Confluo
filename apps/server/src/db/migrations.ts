import type { Database, SqlExecutor } from "./database.ts"

interface Migration {
  id: string
  sql: string
}

const migrations: Migration[] = [
  {
    id: "001_boards_and_yjs_state",
    sql: `
      CREATE TABLE IF NOT EXISTS boards (
        id              text PRIMARY KEY,
        title           text NOT NULL,
        owner_id        text NOT NULL,
        legacy_document jsonb,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT boards_id_format
          CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
        CONSTRAINT boards_title_length
          CHECK (char_length(title) BETWEEN 1 AND 200),
        CONSTRAINT boards_owner_length
          CHECK (char_length(owner_id) BETWEEN 1 AND 200)
      );

      CREATE INDEX IF NOT EXISTS boards_owner_updated_idx
        ON boards (owner_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS board_documents (
        board_id       text PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
        snapshot       bytea NOT NULL,
        snapshot_seq   bigint NOT NULL DEFAULT 0,
        schema_version integer NOT NULL DEFAULT 1,
        updated_at     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT board_documents_snapshot_seq_nonnegative
          CHECK (snapshot_seq >= 0)
      );

      CREATE TABLE IF NOT EXISTS board_updates (
        board_id   text NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        seq        bigint NOT NULL,
        update     bytea NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (board_id, seq),
        CONSTRAINT board_updates_seq_positive CHECK (seq > 0)
      );
    `,
  },
]

export const runMigrations = async (database: Database): Promise<void> => {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  for (const migration of migrations) {
    const existing = await database.query<{ id: string }>(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [migration.id],
    )
    if (existing.rows.length > 0) continue

    await database.transaction(async (tx: SqlExecutor) => {
      // PGlite uses the extended query protocol in transactions, which rejects
      // multi-statement strings. Split the (semicolon-delimited) migration so
      // the same SQL runs on both PostgreSQL drivers.
      for (const statement of migration.sql.split(";")) {
        const trimmed = statement.trim()
        if (trimmed) await tx.query(trimmed)
      }
      await tx.query("INSERT INTO schema_migrations (id) VALUES ($1)", [
        migration.id,
      ])
    })
  }
}
