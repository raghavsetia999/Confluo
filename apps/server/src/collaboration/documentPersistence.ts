import * as Y from "yjs"
import type { BoardRepository } from "../boards/boardRepository.ts"
import {
  createBoardDocument,
  migrateSliceADocument,
} from "../../../web/src/collab/document.ts"
import type { DocumentRepository } from "./documentRepository.ts"
import { SerialQueue } from "./serialQueue.ts"

export const STORAGE_ORIGIN = Symbol("confluo:storage")

export interface DocumentPersistenceOptions {
  pruneUpdateLog?: boolean
  logger?: Pick<Console, "info" | "error" | "warn">
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * Coordinates Yjs bytes and PostgreSQL. Every mutation for one board (append,
 * initial snapshot, checkpoint) passes through the same keyed queue, so a
 * snapshot watermark cannot overtake an update that is still being written.
 */
export class DocumentPersistence {
  private readonly queue = new SerialQueue()
  private readonly logger: Pick<Console, "info" | "error" | "warn">
  private readonly pruneUpdateLog: boolean

  constructor(
    private readonly boards: BoardRepository,
    private readonly documents: DocumentRepository,
    options: DocumentPersistenceOptions = {},
  ) {
    this.logger = options.logger ?? console
    this.pruneUpdateLog = options.pruneUpdateLog ?? true
  }

  /**
   * Called by `onLoadDocument` before Hocuspocus exposes the document to any
   * client. Existing bytes win; Slice A JSON is only read when no Yjs state
   * exists, and the migrated snapshot is committed before this returns.
   */
  async loadOrMigrate(boardId: string, doc: Y.Doc): Promise<void> {
    await this.queue.run(boardId, async () => {
      const board = await this.boards.get(boardId)
      if (!board) throw new Error(`Board "${boardId}" does not exist`)

      const state = await this.documents.loadState(boardId)
      const hasStoredState = state.snapshot !== null || state.updates.length > 0

      if (hasStoredState) {
        if (state.snapshot) {
          Y.applyUpdate(doc, state.snapshot, STORAGE_ORIGIN)
        }
        for (const entry of state.updates) {
          Y.applyUpdate(doc, entry.update, STORAGE_ORIGIN)
        }
        // Validates that the persisted document belongs to this board and uses
        // the schema version this code understands.
        createBoardDocument(boardId, doc)

        if (!state.snapshot) {
          // Defensive recovery for a log without a checkpoint. This should not
          // happen through the normal write path, but replaying the log is
          // still deterministic and idempotent.
          const snapshot = Y.encodeStateAsUpdate(doc)
          const watermark = await this.documents.maxSeq(boardId)
          await this.documents.saveSnapshot(
            boardId,
            snapshot,
            watermark,
            this.pruneUpdateLog,
          )
        }
        return
      }

      const boardDocument = createBoardDocument(boardId, doc)
      migrateSliceADocument(boardDocument, board.legacyDocument)
      const snapshot = Y.encodeStateAsUpdate(doc)
      const inserted = await this.documents.initializeSnapshot(boardId, snapshot)
      if (!inserted) {
        throw new Error(
          `Board "${boardId}" was initialized concurrently; retry the load`,
        )
      }
      this.logger.info(
        `[collaboration] migrated board ${boardId} (${boardDocument.elements.size} elements)`,
      )
    })
  }

  async appendUpdate(boardId: string, update: Uint8Array): Promise<void> {
    await this.queue.run(boardId, async () => {
      try {
        const seq = await this.documents.appendUpdate(boardId, update)
        this.logger.info(
          `[collaboration] persisted update board=${boardId} seq=${seq} bytes=${update.byteLength}`,
        )
      } catch (error) {
        this.logger.error(
          `[collaboration] update persistence failed board=${boardId} operation=append: ${errorMessage(error)}`,
        )
        throw new Error(
          `Could not persist a collaboration update for board "${boardId}"`,
          { cause: error },
        )
      }
    })
  }

  /**
   * Encodes the live document and commits it with the current update-log
   * watermark. Encoding happens after reading the watermark; an update that
   * lands while the read is in flight may already be inside the snapshot but is
   * still above the watermark, so it remains in the log and replay stays safe.
   */
  async checkpoint(boardId: string, doc: Y.Doc): Promise<void> {
    await this.queue.run(boardId, async () => {
      try {
        const watermark = await this.documents.maxSeq(boardId)
        const snapshot = Y.encodeStateAsUpdate(doc)
        await this.documents.saveSnapshot(
          boardId,
          snapshot,
          watermark,
          this.pruneUpdateLog,
        )
        await this.boards.touch(boardId)
        this.logger.info(
          `[collaboration] checkpoint board=${boardId} watermark=${watermark} bytes=${snapshot.byteLength}`,
        )
      } catch (error) {
        this.logger.error(
          `[collaboration] snapshot persistence failed board=${boardId} operation=checkpoint: ${errorMessage(error)}`,
        )
        throw new Error(
          `Could not checkpoint the collaboration document for board "${boardId}"`,
          { cause: error },
        )
      }
    })
  }

  async flush(): Promise<void> {
    await this.queue.flush()
  }
}
