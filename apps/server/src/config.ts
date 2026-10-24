import "dotenv/config"

export interface ServerConfig {
  port: number
  hocuspocusPort: number
  databaseUrl: string | null
  pgliteDataDir: string | null
  corsOrigin: string
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

const readDriver = (): { databaseUrl: string | null; pgliteDataDir: string | null } => {
  const driver = (process.env.DATABASE_DRIVER ?? "postgres").toLowerCase()
  if (driver === "pglite") {
    return {
      databaseUrl: null,
      pgliteDataDir: process.env.PGLITE_DATA_DIR ?? ".pglite",
    }
  }
  if (driver !== "postgres") {
    throw new Error('DATABASE_DRIVER must be either "postgres" or "pglite"')
  }
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required for DATABASE_DRIVER=postgres. " +
        "Use DATABASE_DRIVER=pglite only for local development.",
    )
  }
  return { databaseUrl, pgliteDataDir: null }
}

export const loadConfig = (): ServerConfig => {
  const database = readDriver()
  return {
    port: readPositiveInt("PORT", 4000),
    hocuspocusPort: readPositiveInt("HOCUSPOCUS_PORT", 4001),
    databaseUrl: database.databaseUrl,
    pgliteDataDir: database.pgliteDataDir,
    corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
    hocuspocusDebounceMs: readPositiveInt("HOCUSPOCUS_DEBOUNCE_MS", 2000),
    hocuspocusMaxDebounceMs: readPositiveInt("HOCUSPOCUS_MAX_DEBOUNCE_MS", 10000),
    // Keeping rows is always safe. The default prunes only after an atomic
    // snapshot/watermark commit; set to false to retain the full log.
    pruneUpdateLog: process.env.PRUNE_UPDATE_LOG !== "false",
  }
}
