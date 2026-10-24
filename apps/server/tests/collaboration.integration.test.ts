import { afterEach, describe, expect, it } from "vitest"
import * as Y from "yjs"
import { BoardRepository } from "../src/boards/boardRepository.ts"
import { CanvasBinding, type CanvasChangeSource } from "../../web/src/collab/CanvasBinding.ts"
import type { CanvasElement } from "../../web/src/types/canvas.ts"
import {
  createBoardDocument,
  deleteElement,
  projectElements,
  readElement,
  writeElement,
} from "../../web/src/collab/document.ts"
import { DocumentPersistence } from "../src/collaboration/documentPersistence.ts"
import { DocumentRepository } from "../src/collaboration/documentRepository.ts"
import type { Database } from "../src/db/database.ts"
import {
  connectClient,
  createTestDatabase,
  seedBoard,
  startTestCollaboration,
  waitFor,
  waitForSynced,
  type TestCollaboration,
} from "./helpers.ts"

const element = (overrides: Partial<CanvasElement> = {}): CanvasElement => ({
  id: "shape-one",
  type: "rectangle",
  x: 10,
  y: 20,
  width: 120,
  height: 80,
  rotation: 0,
  style: {
    fill: "#ffffff",
    stroke: "#20201f",
    strokeWidth: 1,
    opacity: 1,
  },
  createdBy: "test",
  ...overrides,
})

class RecordingSource implements CanvasChangeSource {
  readonly projected = new Map<string, CanvasElement>()
  readonly applyCalls: string[] = []
  readonly removeCalls: string[] = []

  subscribeChanges(): () => void {
    return () => undefined
  }

  applyRemoteElement(element: CanvasElement): void {
    this.projected.set(element.id, element)
    this.applyCalls.push(element.id)
  }

  removeRemoteElement(id: string): void {
    this.projected.delete(id)
    this.removeCalls.push(id)
  }

  isElementBusy(): boolean {
    return false
  }

  markRemoteDeferred(): void {}
}

const cleanups: Array<() => Promise<void> | void> = []
const databases: Database[] = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
  while (databases.length > 0) await databases.pop()?.close()
})

const database = async (): Promise<Database> => {
  const db = await createTestDatabase()
  databases.push(db)
  return db
}

const collaboration = async (db: Database): Promise<TestCollaboration> => {
  const server = await startTestCollaboration(db)
  cleanups.push(() => server.stop())
  return server
}

describe("B4 legacy migration and binary persistence", () => {
  it("migrates Slice A JSON once and never overwrites existing Yjs state", async () => {
    const db = await database()
    const boardId = "board-migrate"
    await seedBoard(db, { id: boardId, elements: [element()] })

    const boards = new BoardRepository(db)
    const documents = new DocumentRepository(db)
    const persistence = new DocumentPersistence(boards, documents, {
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    })

    const first = new Y.Doc()
    await persistence.loadOrMigrate(boardId, first)
    expect(projectElements(createBoardDocument(boardId, first))).toStrictEqual([
      element(),
    ])

    const state = await documents.loadState(boardId)
    expect(state.snapshot).not.toBeNull()
    expect(state.snapshotSeq).toBe(0)
    expect(state.updates).toHaveLength(0)

    // A later legacy edit must be ignored because Yjs is authoritative.
    await db.query(
      "UPDATE boards SET legacy_document = $2::jsonb WHERE id = $1",
      [boardId, JSON.stringify({ elements: [element({ x: 999 })] })],
    )

    const second = new Y.Doc()
    await persistence.loadOrMigrate(boardId, second)
    expect(readElement(createBoardDocument(boardId, second), "shape-one")?.x).toBe(
      10,
    )
  })

  it("restores a snapshot then replays updates above its watermark", async () => {
    const db = await database()
    const boardId = "board-watermark"
    await seedBoard(db, { id: boardId, elements: [element()] })

    const boards = new BoardRepository(db)
    const documents = new DocumentRepository(db)
    const persistence = new DocumentPersistence(boards, documents, {
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    })

    const live = new Y.Doc()
    await persistence.loadOrMigrate(boardId, live)
    const document = createBoardDocument(boardId, live)

    let vector = Y.encodeStateVector(live)
    writeElement(document, { ...element(), x: 40 })
    const firstUpdate = Y.encodeStateAsUpdate(live, vector)
    await persistence.appendUpdate(boardId, firstUpdate)
    await persistence.checkpoint(boardId, live)

    expect(await documents.getSnapshotSeq(boardId)).toBe(1)
    expect(await documents.countUpdates(boardId)).toBe(0)

    vector = Y.encodeStateVector(live)
    writeElement(document, { ...element(), x: 80 })
    const secondUpdate = Y.encodeStateAsUpdate(live, vector)
    await persistence.appendUpdate(boardId, secondUpdate)

    const stored = await documents.loadState(boardId)
    expect(stored.snapshot).not.toBeNull()
    expect(stored.snapshotSeq).toBe(1)
    expect(stored.updates.map((entry) => entry.seq)).toEqual([2])

    const restored = new Y.Doc()
    if (stored.snapshot) Y.applyUpdate(restored, stored.snapshot)
    for (const entry of stored.updates) Y.applyUpdate(restored, entry.update)
    expect(readElement(createBoardDocument(boardId, restored), "shape-one")?.x).toBe(
      80,
    )

    // Duplicate delivery is safe because Yjs updates are idempotent.
    await documents.appendUpdate(boardId, secondUpdate)
    const duplicate = await documents.loadState(boardId)
    const duplicateDoc = new Y.Doc()
    if (duplicate.snapshot) Y.applyUpdate(duplicateDoc, duplicate.snapshot)
    for (const entry of duplicate.updates) Y.applyUpdate(duplicateDoc, entry.update)
    expect(
      readElement(createBoardDocument(boardId, duplicateDoc), "shape-one")?.x,
    ).toBe(80)
  })
})

describe("B4 Hocuspocus transport", () => {
  it("projects a create, move, text edit and delete into a second client", async () => {
    const db = await database()
    const boardId = "board-live"
    await seedBoard(db, { id: boardId, elements: [element()] })
    const server = await collaboration(db)

    const first = connectClient(server.port, boardId)
    const second = connectClient(server.port, boardId)
    cleanups.push(() => first.destroy(), () => second.destroy())
    await Promise.all([waitForSynced(first), waitForSynced(second)])

    const secondDocument = createBoardDocument(boardId, second.doc)
    const source = new RecordingSource()
    const binding = new CanvasBinding(source, secondDocument)
    cleanups.push(() => binding.dispose())
    expect(source.projected.has("shape-one")).toBe(true)
    source.projected.clear()

    const firstDocument = createBoardDocument(boardId, first.doc)
    const created = element({
      id: "live-element",
      type: "sticky-note",
      x: 50,
      y: 60,
      text: "hello",
    })
    writeElement(firstDocument, created)
    await waitFor(
      () => source.projected.get("live-element")?.text === "hello",
      "remote create projection",
    )

    writeElement(firstDocument, {
      ...created,
      x: 150,
      y: 170,
      text: "edited remotely",
    })
    await waitFor(
      () =>
        source.projected.get("live-element")?.x === 150 &&
        source.projected.get("live-element")?.text === "edited remotely",
      "remote update projection",
    )

    deleteElement(firstDocument, "live-element")
    await waitFor(
      () => !source.projected.has("live-element"),
      "remote delete projection",
    )
    expect(source.removeCalls).toContain("live-element")
  })

  it("keeps separate boards isolated", async () => {
    const db = await database()
    await seedBoard(db, { id: "board-a", elements: [element({ id: "only-a" })] })
    await seedBoard(db, { id: "board-b", elements: [element({ id: "only-b" })] })
    const server = await collaboration(db)

    const first = connectClient(server.port, "board-a")
    const second = connectClient(server.port, "board-b")
    cleanups.push(() => first.destroy(), () => second.destroy())
    await Promise.all([waitForSynced(first), waitForSynced(second)])

    const firstDocument = createBoardDocument("board-a", first.doc)
    writeElement(firstDocument, element({ id: "new-a", x: 123 }))
    await waitFor(
      () => readElement(createBoardDocument("board-a", first.doc), "new-a") !== null,
      "first board update",
    )

    const secondDocument = createBoardDocument("board-b", second.doc)
    expect(readElement(secondDocument, "new-a")).toBeNull()
    expect(readElement(secondDocument, "only-a")).toBeNull()
    expect(readElement(secondDocument, "only-b")).not.toBeNull()
  })

  it("rejects malformed names and unknown boards before loading", async () => {
    const db = await database()
    const server = await collaboration(db)

    const missing = connectClient(server.port, "board-does-not-exist")
    cleanups.push(() => missing.destroy())
    await expect(missing.authenticationError).resolves.toBe("permission-denied")

    const malformed = connectClient(server.port, "irrelevant", {
      rawDocumentName: "confluo.board../escape",
    })
    cleanups.push(() => malformed.destroy())
    await expect(malformed.authenticationError).resolves.toBe(
      "permission-denied",
    )
  })

  it("restores state after the persistence queue and checkpoint flush", async () => {
    const db = await database()
    const boardId = "board-restart"
    await seedBoard(db, { id: boardId, elements: [element()] })
    const firstServer = await startTestCollaboration(db)

    const first = connectClient(firstServer.port, boardId)
    await waitForSynced(first)
    const firstDocument = createBoardDocument(boardId, first.doc)
    writeElement(firstDocument, {
      id: "survives-restart",
      type: "rectangle",
      x: 77,
      y: 88,
      width: 120,
      height: 80,
      rotation: 0,
      style: element().style,
      createdBy: "test",
    })

    await waitFor(
      async () => (await firstServer.documents.countUpdates(boardId)) > 0,
      "persisted update",
    )
    first.destroy()
    await firstServer.stop()

    const secondServer = await startTestCollaboration(db)
    cleanups.push(() => secondServer.stop())
    const second = connectClient(secondServer.port, boardId)
    cleanups.push(() => second.destroy())
    await waitForSynced(second)

    expect(
      readElement(createBoardDocument(boardId, second.doc), "survives-restart")?.x,
    ).toBe(77)
  })
})
