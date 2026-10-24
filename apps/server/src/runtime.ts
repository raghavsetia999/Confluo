import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { BoardRepository } from "./boards/boardRepository.ts"
import { DocumentPersistence } from "./collaboration/documentPersistence.ts"
import { DocumentRepository } from "./collaboration/documentRepository.ts"
import {
  createCollaborationServer,
  type CollaborationServer,
} from "./collaboration/server.ts"
import type { ServerConfig } from "./config.ts"
import type { Database } from "./db/database.ts"
import { PostgresDatabase } from "./db/database.ts"
import { runMigrations } from "./db/migrations.ts"
import { createHttpApp } from "./http/app.ts"

export interface RuntimeOptions {
  config: ServerConfig
  database?: Database
  logger?: Pick<Console, "info" | "error" | "warn">
}

export interface RunningRuntime {
  httpPort: number
  hocuspocusPort: number
  database: Database
  stop(): Promise<void>
}

const listen = (
  server: ReturnType<typeof createServer>,
  port: number,
): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, () => {
      server.off("error", reject)
      const address = server.address() as AddressInfo | null
      resolve(address?.port ?? port)
    })
  })

const closeHttp = (server: ReturnType<typeof createServer>): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })

export const createDatabase = async (config: ServerConfig): Promise<Database> => {
  if (config.pgliteDataDir) {
    const { createPGliteDatabase } = await import("./db/pglite-database.ts")
    return createPGliteDatabase(config.pgliteDataDir)
  }
  if (!config.databaseUrl) {
    throw new Error("No database configuration was provided")
  }
  return new PostgresDatabase(config.databaseUrl)
}

export const startRuntime = async (
  options: RuntimeOptions,
): Promise<RunningRuntime> => {
  const logger = options.logger ?? console
  const database = options.database ?? (await createDatabase(options.config))
  let collaboration: CollaborationServer | null = null
  let httpServer: ReturnType<typeof createServer> | null = null
  let stopped = false

  try {
    await runMigrations(database)
    const boards = new BoardRepository(database)
    const documents = new DocumentRepository(database)
    const persistence = new DocumentPersistence(boards, documents, {
      pruneUpdateLog: options.config.pruneUpdateLog,
      logger,
    })

    const app = createHttpApp({
      boards,
      database,
      corsOrigin: options.config.corsOrigin,
      logger,
    })
    httpServer = createServer(app)
    const httpPort = await listen(httpServer, options.config.port)

    collaboration = createCollaborationServer({
      port: options.config.hocuspocusPort,
      boards,
      persistence,
      debounceMs: options.config.hocuspocusDebounceMs,
      maxDebounceMs: options.config.hocuspocusMaxDebounceMs,
      quiet: true,
    })
    await collaboration.start()
    const collaborationAddress = collaboration.server.address
    const hocuspocusPort =
      typeof collaborationAddress === "object" && collaborationAddress
        ? collaborationAddress.port
        : options.config.hocuspocusPort

    logger.info(
      `[server] HTTP http://localhost:${httpPort} · collaboration ws://localhost:${hocuspocusPort}`,
    )

    const stop = async () => {
      if (stopped) return
      stopped = true
      try {
        if (collaboration) await collaboration.stop()
      } finally {
        if (httpServer) {
          await new Promise<void>((resolve) => {
            httpServer?.close(() => resolve())
          })
        }
        await database.close()
      }
    }

    return {
      httpPort,
      hocuspocusPort,
      database,
      stop,
    }
  } catch (error) {
    if (collaboration) {
      await collaboration.stop().catch(() => undefined)
    }
    if (httpServer) {
      await closeHttp(httpServer).catch(() => undefined)
    }
    await database.close().catch(() => undefined)
    throw error
  }
}
