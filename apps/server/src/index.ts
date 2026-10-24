import { loadConfig } from "./config.ts"
import { startRuntime } from "./runtime.ts"

const runtime = await startRuntime({ config: loadConfig() })
let shuttingDown = false

const shutdown = async (signal: string) => {
  if (shuttingDown) return
  shuttingDown = true
  console.info(`[server] received ${signal}; flushing collaboration state`)
  try {
    await runtime.stop()
    process.exitCode = 0
  } catch (error) {
    console.error(
      `[server] shutdown failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exitCode = 1
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"))
process.on("SIGTERM", () => void shutdown("SIGTERM"))
