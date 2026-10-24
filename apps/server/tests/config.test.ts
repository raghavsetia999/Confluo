import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { loadConfig } from "../src/config.ts"

const MANAGED_KEYS = [
  "DATABASE_DRIVER",
  "DATABASE_URL",
  "PGLITE_DATA_DIR",
] as const

const originalEnv = Object.fromEntries(
  MANAGED_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof MANAGED_KEYS)[number], string | undefined>

beforeEach(() => {
  for (const key of MANAGED_KEYS) delete process.env[key]
})

afterEach(() => {
  for (const key of MANAGED_KEYS) {
    const value = originalEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe("database configuration", () => {
  it("defaults to PostgreSQL and reads DATABASE_URL", () => {
    process.env.DATABASE_URL = "  postgresql://localhost:5432/confluo  "

    const config = loadConfig()

    expect(config.databaseUrl).toBe("postgresql://localhost:5432/confluo")
    expect(config.pgliteDataDir).toBeNull()
  })

  it("accepts the postgres:// scheme and driver casing", () => {
    process.env.DATABASE_DRIVER = " POSTGRES "
    process.env.DATABASE_URL = "postgres://localhost:5432/confluo"

    const config = loadConfig()

    expect(config.databaseUrl).toBe("postgres://localhost:5432/confluo")
    expect(config.pgliteDataDir).toBeNull()
  })

  it("keeps PGlite as an explicit local-only driver", () => {
    process.env.DATABASE_DRIVER = "pglite"
    process.env.DATABASE_URL = "postgresql://localhost:5432/unused"
    process.env.PGLITE_DATA_DIR = " .pglite-test "

    const config = loadConfig()

    expect(config.databaseUrl).toBeNull()
    expect(config.pgliteDataDir).toBe(".pglite-test")
  })

  it("defaults the PGlite data directory", () => {
    process.env.DATABASE_DRIVER = "pglite"

    const config = loadConfig()

    expect(config.databaseUrl).toBeNull()
    expect(config.pgliteDataDir).toBe(".pglite")
  })

  it("rejects an unsupported driver", () => {
    process.env.DATABASE_DRIVER = "sqlite"

    expect(() => loadConfig()).toThrow(
      'DATABASE_DRIVER must be either "postgres" or "pglite"',
    )
  })

  it("requires DATABASE_URL for PostgreSQL", () => {
    process.env.DATABASE_DRIVER = "postgres"

    expect(() => loadConfig()).toThrow("DATABASE_URL is required")
  })

  it("rejects blank DATABASE_URL values", () => {
    process.env.DATABASE_URL = "   "

    expect(() => loadConfig()).toThrow("DATABASE_URL is required")
  })

  it("rejects malformed and non-PostgreSQL URLs", () => {
    process.env.DATABASE_URL = "not a connection string"
    expect(() => loadConfig()).toThrow(
      "DATABASE_URL must be a valid PostgreSQL connection string",
    )

    process.env.DATABASE_URL = "mysql://localhost:3306/confluo"
    expect(() => loadConfig()).toThrow(
      "DATABASE_URL must use the postgres:// or postgresql:// scheme",
    )
  })
})
