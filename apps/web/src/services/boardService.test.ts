import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { boardService } from "./boardService.ts"
import type { CanvasElement } from "../types/canvas.ts"

const BOARDS_KEY = "confluo:boards"

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() {
    return this.values.size
  }
  clear() {
    this.values.clear()
  }
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const element = (id: string, overrides: Partial<CanvasElement> = {}): CanvasElement => ({
  id,
  type: "rectangle",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  style: { fill: "#ffffff", stroke: "#20201f", strokeWidth: 1, opacity: 1 },
  createdBy: "owner",
  ...overrides,
})

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("boardService", () => {
  it("creates boards with a unique id and no elements", () => {
    const board = boardService.create("owner-1")
    expect(board.id).toBeTruthy()
    expect(board.elements).toEqual([])
    expect(board.title).toBe("Untitled whiteboard")

    const ids = new Set(Array.from({ length: 50 }, () => boardService.create("owner-1").id))
    expect(ids.size).toBe(50)
  })

  it("lists only the owner's boards and gives new owners a starter board", () => {
    boardService.create("owner-1", "Mine")
    boardService.create("owner-2", "Theirs")

    const mine = boardService.list("owner-1")
    expect(mine.map((board) => board.title)).toEqual(["Mine"])

    const fresh = boardService.list("owner-3")
    expect(fresh).toHaveLength(1)
    expect(fresh[0].elements.length).toBeGreaterThan(0)
  })

  it("keeps board documents isolated", () => {
    const boardA = boardService.create("owner-1", "Board A")
    const boardB = boardService.create("owner-1", "Board B")

    boardService.update(boardA.id, { elements: [element("a-1")] })
    boardService.update(boardB.id, { title: "Board B renamed" })

    expect(boardService.get(boardA.id)?.elements.map((item) => item.id)).toEqual([
      "a-1",
    ])
    expect(boardService.get(boardB.id)?.elements).toEqual([])
    expect(boardService.get(boardB.id)?.title).toBe("Board B renamed")
  })

  it("persists renames through the stored document", () => {
    const board = boardService.create("owner-1")
    boardService.update(board.id, { title: "Renamed" })
    expect(boardService.get(board.id)?.title).toBe("Renamed")
    expect(boardService.list("owner-1")[0].title).toBe("Renamed")
  })

  it("duplicates content under a new id without mutating the source", () => {
    const board = boardService.create("owner-1", "Source")
    boardService.update(board.id, { elements: [element("a-1")] })
    const copy = boardService.duplicate(board.id, "owner-2")

    expect(copy.id).not.toBe(board.id)
    expect(copy.ownerId).toBe("owner-2")
    expect(copy.title).toBe("Source copy")
    expect(copy.elements).toEqual([element("a-1")])
    expect(boardService.get(board.id)?.elements).toHaveLength(1)
  })

  it("removes only the requested board", () => {
    const boardA = boardService.create("owner-1")
    const boardB = boardService.create("owner-1")
    boardService.remove(boardA.id)
    expect(boardService.get(boardA.id)).toBeNull()
    expect(boardService.get(boardB.id)).not.toBeNull()
  })

  it("rejects updates and reads for unknown boards", () => {
    expect(boardService.get("missing")).toBeNull()
    expect(() => boardService.update("missing", { title: "x" })).toThrow(
      "Board not found",
    )
  })

  it("recovers from malformed stored elements", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const board = boardService.create("owner-1")
    const stored = JSON.parse(localStorage.getItem(BOARDS_KEY) ?? "[]")
    stored[0].elements = [
      element("valid"),
      { ...element("unknown"), type: "hologram" },
      { ...element("broken"), style: {} },
      element("valid", { type: "ellipse" }),
    ]
    localStorage.setItem(BOARDS_KEY, JSON.stringify(stored))

    const recovered = boardService.get(board.id)
    expect(recovered?.elements.map((item) => item.id)).toEqual(["valid"])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
