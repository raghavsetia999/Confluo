import { loadConfig } from "../config.ts"
import { createDatabase } from "../runtime.ts"
import { runMigrations } from "./migrations.ts"

const database = await createDatabase(loadConfig())
try {
  await runMigrations(database)
  console.info("[migrate] database schema is current")
} finally {
  await database.close()
}
