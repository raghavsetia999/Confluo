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
  {
    id: "002_users_sessions_and_memberships",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id            text PRIMARY KEY,
        name          text NOT NULL,
        email         text NOT NULL,
        password_hash text NOT NULL,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT users_email_normalized CHECK (email = lower(email)),
        CONSTRAINT users_email_length CHECK (char_length(email) BETWEEN 3 AND 254),
        CONSTRAINT users_name_length CHECK (char_length(name) BETWEEN 1 AND 120)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx
        ON users (lower(email));

      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash text PRIMARY KEY,
        user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS auth_sessions_user_idx
        ON auth_sessions (user_id);
      CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx
        ON auth_sessions (expires_at);

      CREATE TABLE IF NOT EXISTS board_memberships (
        board_id   text NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role       text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (board_id, user_id),
        CONSTRAINT board_memberships_role CHECK (role IN ('owner', 'editor'))
      );

      CREATE INDEX IF NOT EXISTS board_memberships_user_idx
        ON board_memberships (user_id, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS board_memberships_one_owner_idx
        ON board_memberships (board_id) WHERE role = 'owner';

      INSERT INTO users (id, name, email, password_hash)
      SELECT b.owner_id, 'Legacy owner',
             'legacy-' || substr(md5(b.owner_id), 1, 24) || '@legacy.invalid',
             '!disabled'
      FROM boards b
      WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = b.owner_id)
      GROUP BY b.owner_id;

      ALTER TABLE boards
        ADD CONSTRAINT boards_owner_fk
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT;

      INSERT INTO board_memberships (board_id, user_id, role)
      SELECT id, owner_id, 'owner' FROM boards
      ON CONFLICT (board_id, user_id) DO NOTHING;
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
