import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as Y from "yjs"
import type { CanvasElement, ElementType } from "../types/canvas.ts"
import {
  MIGRATION_ORIGIN,
  SCHEMA_VERSION,
  createBoardDocument,
  deleteElement,
  hasElement,
  isElementDeleted,
  migrateSliceADocument,
  projectElements,
  readElement,
  writeElement,
} from "./document.ts"

const element = (overrides: Partial<CanvasElement> = {}): CanvasElement => ({
  id: "element-1",
  type: "rectangle",
  x: 10,
  y: 20,
  width: 120,
  height: 80,
  rotation: 0,
  style: { fill: "#ffffff", stroke: "#20201f", strokeWidth: 1, opacity: 1 },
  createdBy: "user-1",
  ...overrides,
})

const board = () => createBoardDocument("board-test")

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("createBoardDocument", () => {
  it("creates empty roots and records the board id", () => {
    const document = board()
    expect(document.elements.size).toBe(0)
    expect(projectElements(document)).toEqual([])
    expect(document.meta.get("boardId")).toBe("board-test")
    expect(document.meta.get("schemaVersion")).toBeUndefined()
  })

  it("requires a board id", () => {
    expect(() => createBoardDocument("")).toThrow(/boardId/)
    expect(() => createBoardDocument("   ")).toThrow(/boardId/)
  })

  it("reuses the same roots when opening the same doc", () => {
    const document = board()
    const reopened = createBoardDocument("board-test", document.doc)
    expect(reopened.elements).toBe(document.elements)
    expect(reopened.meta).toBe(document.meta)
  })

  it("refuses to hold two boards in one Y.Doc", () => {
    const document = board()
    expect(() => createBoardDocument("other-board", document.doc)).toThrow(
      /already belongs to board/,
    )
  })

  it("accepts a document at the supported schema version", () => {
    const document = board()
    document.meta.set("schemaVersion", SCHEMA_VERSION)
    expect(() => createBoardDocument("board-test", document.doc)).not.toThrow()
  })

  it("rejects a document written with an unsupported schema version", () => {
    const doc = new Y.Doc()
    doc.getMap("meta").set("schemaVersion", SCHEMA_VERSION + 1)
    expect(() => createBoardDocument("board-test", doc)).toThrow(
      /Unsupported document schema version 2/,
    )
  })
})

describe("element round-trip", () => {
  const cases: Array<{ type: ElementType; extra: Partial<CanvasElement> }> = [
    { type: "rectangle", extra: {} },
    { type: "ellipse", extra: {} },
    { type: "diamond", extra: { rotation: 45 } },
    { type: "text", extra: { text: "Hello Confluo" } },
    { type: "sticky-note", extra: { text: "note body" } },
    { type: "freehand", extra: { points: [0, 0, 10, 20, 30, 5] } },
    { type: "connector", extra: { points: [0, 0, 80, 40] } },
  ]

  for (const { type, extra } of cases) {
    it(`preserves a ${type}`, () => {
      const document = board()
      const input = element({ type, ...extra })
      expect(writeElement(document, input)).toBe(true)
      expect(readElement(document, input.id)).toStrictEqual(input)
      expect(projectElements(document)).toStrictEqual([input])
    })
  }

  it("keeps the element id out of the map body (key is the identity)", () => {
    const document = board()
    writeElement(document, element({ id: "by-key" }))
    const stored = document.elements.get("by-key")
    expect(stored).toBeDefined()
    expect(stored?.get("id")).toBeUndefined()
  })

  it("replaces fields without duplicating the element or changing z", () => {
    const document = board()
    writeElement(document, element({ id: "a" }))
    writeElement(document, element({ id: "b" }))
    writeElement(document, element({ id: "a", x: 99, text: "updated", rotation: 30 }))

    expect(document.elements.size).toBe(2)
    expect(readElement(document, "a")).toMatchObject({
      id: "a",
      x: 99,
      text: "updated",
      rotation: 30,
    })
    expect(projectElements(document).map((item) => item.id)).toEqual(["a", "b"])
  })

  it("rejects invalid elements", () => {
    const document = board()
    expect(() => writeElement(document, element({ width: -1 }))).toThrow(
      /Invalid canvas element/,
    )
    expect(document.elements.size).toBe(0)
  })

  it("rejects changing the immutable type", () => {
    const document = board()
    writeElement(document, element({ id: "a", type: "rectangle" }))
    expect(() =>
      writeElement(document, element({ id: "a", type: "ellipse" })),
    ).toThrow(/Cannot change element/)
  })

  it("does not read or write through the caller's objects", () => {
    const document = board()
    const input = element({
      id: "free",
      type: "freehand",
      points: [0, 0, 10, 10],
    })
    writeElement(document, input)

    input.style.fill = "#000000"
    input.points?.push(99, 99)

    const projected = readElement(document, "free")
    expect(projected?.style.fill).toBe("#ffffff")
    expect(projected?.points).toEqual([0, 0, 10, 10])

    projected!.style.fill = "#ff00ff"
    projected!.points!.push(42, 42)

    expect(readElement(document, "free")?.style.fill).toBe("#ffffff")
    expect(readElement(document, "free")?.points).toEqual([0, 0, 10, 10])
  })

  it("orders the projection by z then id", () => {
    const document = board()
    writeElement(document, element({ id: "b" }))
    writeElement(document, element({ id: "a" }))
    expect(projectElements(document).map((item) => item.id)).toEqual(["b", "a"])

    writeElement(document, element({ id: "c" }), { z: -1 })
    writeElement(document, element({ id: "d" }), { z: -1 })
    expect(projectElements(document).map((item) => item.id)).toEqual([
      "c",
      "d",
      "b",
      "a",
    ])
  })

  it("ignores malformed nested maps when projecting", () => {
    const document = board()
    const broken = new Y.Map<unknown>()
    broken.set("type", "rectangle")
    document.elements.set("broken", broken)

    expect(projectElements(document)).toEqual([])
    expect(readElement(document, "broken")).toBeNull()
  })

  it("preserves empty text and zero-size geometry", () => {
    const document = board()
    const input = element({
      id: "empty",
      type: "text",
      text: "",
      width: 0,
      height: 0,
    })
    writeElement(document, input)
    expect(readElement(document, "empty")).toStrictEqual(input)
  })
})

describe("malformed shared values", () => {
  it("does not crash on non-map element entries", () => {
    const document = board()
    document.elements.set("junk", "not-an-element" as unknown as Y.Map<unknown>)
    document.elements.set("nul", null as unknown as Y.Map<unknown>)

    expect(projectElements(document)).toEqual([])
    expect(readElement(document, "junk")).toBeNull()
    expect(readElement(document, "nul")).toBeNull()
    expect(isElementDeleted(document, "junk")).toBe(false)

    expect(deleteElement(document, "junk")).toBe(true)
    expect(document.elements.has("junk")).toBe(false)
  })

  it("replaces non-map junk on write instead of throwing", () => {
    const document = board()
    document.elements.set("junk", 42 as unknown as Y.Map<unknown>)

    expect(writeElement(document, element({ id: "junk" }))).toBe(true)
    expect(projectElements(document).map((item) => item.id)).toEqual(["junk"])
  })
})

describe("deletion", () => {
  it("tombstones instead of removing the key", () => {
    const document = board()
    writeElement(document, element({ id: "a" }))

    expect(deleteElement(document, "a")).toBe(true)
    expect(document.elements.has("a")).toBe(true)
    expect(hasElement(document, "a")).toBe(true)
    expect(isElementDeleted(document, "a")).toBe(true)
    expect(readElement(document, "a")).toBeNull()
    expect(projectElements(document)).toEqual([])

    expect(deleteElement(document, "a")).toBe(false)
  })

  it("does not resurrect a deleted element", () => {
    const document = board()
    writeElement(document, element({ id: "a" }))
    deleteElement(document, "a")

    expect(writeElement(document, element({ id: "a", x: 500 }))).toBe(false)
    expect(readElement(document, "a")).toBeNull()
    expect(isElementDeleted(document, "a")).toBe(true)
  })

  it("returns false for a missing element", () => {
    expect(deleteElement(board(), "missing")).toBe(false)
  })
})

describe("transaction origins", () => {
  it("forwards the supplied origin", () => {
    const document = board()
    const origins: unknown[] = []
    document.doc.on("afterTransaction", (transaction) =>
      origins.push(transaction.origin),
    )

    writeElement(document, element({ id: "a" }), { origin: "local" })
    deleteElement(document, "a", "local")

    expect(origins).toEqual(["local", "local"])
  })

  it("uses the migration origin once for the whole import", () => {
    const document = board()
    const origins: unknown[] = []
    document.doc.on("afterTransaction", (transaction) =>
      origins.push(transaction.origin),
    )

    const result = migrateSliceADocument(document, {
      elements: [element({ id: "a" }), element({ id: "b" })],
    })

    expect(result.migrated).toBe(true)
    expect(origins).toEqual([MIGRATION_ORIGIN])
  })

  it("accepts an explicit migration origin", () => {
    const document = board()
    const origins: unknown[] = []
    document.doc.on("afterTransaction", (transaction) =>
      origins.push(transaction.origin),
    )

    migrateSliceADocument(document, { elements: [] }, { origin: "custom" })
    expect(origins).toEqual(["custom"])
  })
})

describe("migrateSliceADocument", () => {
  it("imports every supported type with ids and fields intact", () => {
    const document = board()
    const legacy = [
      element({ id: "rect", type: "rectangle", x: 1, y: 2, rotation: 3 }),
      element({ id: "ell", type: "ellipse" }),
      element({ id: "dia", type: "diamond", rotation: 45 }),
      element({ id: "txt", type: "text", text: "Question?" }),
      element({ id: "note", type: "sticky-note", text: "sticky" }),
      element({ id: "ink", type: "freehand", points: [0, 0, 4, 4] }),
      element({ id: "wire", type: "connector", points: [0, 0, 60, 0] }),
    ]

    const result = migrateSliceADocument(document, { elements: legacy })

    expect(result).toEqual({
      migrated: true,
      inserted: legacy.map((item) => item.id),
      skipped: 0,
    })
    expect(projectElements(document)).toStrictEqual(legacy)
    expect(document.meta.get("schemaVersion")).toBe(SCHEMA_VERSION)
    expect(typeof document.meta.get("migratedAt")).toBe("string")
  })

  it("preserves the stored array order through z", () => {
    const document = board()
    migrateSliceADocument(document, {
      elements: [
        element({ id: "last", x: 0 }),
        element({ id: "first", x: 0 }),
        element({ id: "middle", x: 0 }),
      ],
    })
    expect(projectElements(document).map((item) => item.id)).toEqual([
      "last",
      "first",
      "middle",
    ])
  })

  it("accepts either a board document or a bare element array", () => {
    const fromBoard = board()
    migrateSliceADocument(fromBoard, { elements: [element({ id: "a" })] })
    expect(projectElements(fromBoard).map((item) => item.id)).toEqual(["a"])

    const fromArray = board()
    migrateSliceADocument(fromArray, [element({ id: "b" })])
    expect(projectElements(fromArray).map((item) => item.id)).toEqual(["b"])
  })

  it("is a no-op after the first migration", () => {
    const document = board()
    migrateSliceADocument(document, { elements: [element({ id: "a" })] })
    const before = projectElements(document)

    const second = migrateSliceADocument(document, {
      elements: [element({ id: "b" })],
    })

    expect(second).toEqual({ migrated: false, inserted: [], skipped: 0 })
    expect(projectElements(document)).toStrictEqual(before)
    expect(document.elements.size).toBe(1)
  })

  it("refuses to seed a document that already has content", () => {
    const document = board()
    writeElement(document, element({ id: "local" }))

    const result = migrateSliceADocument(document, {
      elements: [element({ id: "legacy" })],
    })

    expect(result.migrated).toBe(false)
    expect(projectElements(document).map((item) => item.id)).toEqual(["local"])
    expect(document.meta.get("schemaVersion")).toBeUndefined()
  })

  it("marks an empty board as migrated so it is not retried forever", () => {
    const document = board()
    const result = migrateSliceADocument(document, { elements: [] })

    expect(result).toEqual({ migrated: true, inserted: [], skipped: 0 })
    expect(document.elements.size).toBe(0)
    expect(document.meta.get("schemaVersion")).toBe(SCHEMA_VERSION)
  })

  it("skips unknown, malformed and duplicated legacy data", () => {
    const document = board()
    const legacy = [
      element({ id: "keep" }),
      { ...element({ id: "unknown" }), type: "hologram" } as unknown as CanvasElement,
      { ...element({ id: "broken" }), style: {} } as unknown as CanvasElement,
      { ...element({ id: "negative" }), width: -5 },
      element({ id: "keep", type: "ellipse" }),
    ]

    const result = migrateSliceADocument(document, { elements: legacy })

    expect(result.migrated).toBe(true)
    expect(result.inserted).toEqual(["keep"])
    expect(result.skipped).toBe(4)
    expect(projectElements(document).map((item) => item.id)).toEqual(["keep"])
    expect(projectElements(document)[0].type).toBe("rectangle")
    expect(console.warn).toHaveBeenCalled()
  })

  it("does not invent optional fields the legacy element did not have", () => {
    const document = board()
    migrateSliceADocument(document, {
      elements: [element({ id: "plain", type: "rectangle" })],
    })
    const map = document.elements.get("plain")
    expect(map?.has("text")).toBe(false)
    expect(map?.has("points")).toBe(false)
  })

  it("tolerates a completely malformed payload as an empty board", () => {
    const document = board()
    const result = migrateSliceADocument(document, null)
    expect(result).toEqual({ migrated: true, inserted: [], skipped: 0 })
    expect(document.meta.get("schemaVersion")).toBe(SCHEMA_VERSION)
  })
})
