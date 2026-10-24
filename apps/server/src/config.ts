import "dotenv/config"

export type DatabaseDriver = "postgres" | "pglite"

interface DatabaseSelection {
  databaseUrl: string | null
  pgliteDataDir: string | null
}

export interface ServerConfig {
  port: number
  hocuspocusPort: number
  databaseUrl: string | null
  pgliteDataDir: string | null
  corsOrigin: string
  cookieSecure: boolean
  hocuspocusDebounceMs: number
  hocuspocusMaxDebounceMs: number
  pruneUpdateLog: boolean
}

const readPositiveInt = (name: string, fallback: number): number => {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

const readPostgresUrl = (): string => {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required for DATABASE_DRIVER=postgres. " +
        "Use DATABASE_DRIVER=pglite only for local development.",
    )
  }

  let parsed: URL
  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new Error(
      "DATABASE_URL must be a valid PostgreSQL connection string, for example " +
        "postgresql://localhost:5432/confluo",
    )
  }

  // Accept both libpq schemes; never echo the URL because it may contain a
  // password. A missing host is valid for local Unix-socket connections.
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(
      "DATABASE_URL must use the postgres:// or postgresql:// scheme",
    )
  }
  if (!parsed.hostname && !parsed.pathname.replace(/^\/+/, "")) {
    throw new Error("DATABASE_URL must include a database name")
  }

  return databaseUrl
}

const readDriver = (): DatabaseSelection => {
  const driver = (process.env.DATABASE_DRIVER ?? "postgres")
    .trim()
    .toLowerCase()
  if (driver === "pglite") {
    return {
      databaseUrl: null,
      pgliteDataDir: process.env.PGLITE_DATA_DIR?.trim() || ".pglite",
    }
  }
  if (driver !== "postgres") {
    throw new Error('DATABASE_DRIVER must be either "postgres" or "pglite"')
  }
  return { databaseUrl: readPostgresUrl(), pgliteDataDir: null }
}

export const loadConfig = (): ServerConfig => {
  const database = readDriver()
  return {
    port: readPositiveInt("PORT", 4000),
    hocuspocusPort: readPositiveInt("HOCUSPOCUS_PORT", 4001),
    databaseUrl: database.databaseUrl,
    pgliteDataDir: database.pgliteDataDir,
    corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
    cookieSecure:
      process.env.COOKIE_SECURE === "true" ||
      (process.env.COOKIE_SECURE !== "false" &&
        process.env.NODE_ENV === "production"),
    hocuspocusDebounceMs: readPositiveInt("HOCUSPOCUS_DEBOUNCE_MS", 2000),
    hocuspocusMaxDebounceMs: readPositiveInt("HOCUSPOCUS_MAX_DEBOUNCE_MS", 10000),
    // Keeping rows is always safe. The default prunes only after an atomic
    // snapshot/watermark commit; set to false to retain the full log.
    pruneUpdateLog: process.env.PRUNE_UPDATE_LOG !== "false",
  }
}
