import { describe, expect, it, vi } from "vitest"
import { isCanvasElement, sanitizeElements } from "./elementSchema.ts"
import type { CanvasElement } from "../types/canvas.ts"

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

describe("isCanvasElement", () => {
  it("accepts every supported element type", () => {
    const types: CanvasElement["type"][] = [
      "rectangle",
      "ellipse",
      "diamond",
      "text",
      "sticky-note",
      "freehand",
      "connector",
    ]
    for (const type of types) {
      expect(isCanvasElement(element({ type })), type).toBe(true)
    }
  })

  it("accepts flat freehand geometry", () => {
    expect(isCanvasElement(element({ type: "freehand", width: 0, height: 40 }))).toBe(
      true,
    )
    expect(isCanvasElement(element({ type: "freehand", width: 40, height: 0 }))).toBe(
      true,
    )
  })

  it("rejects unknown types, missing styles and non-finite geometry", () => {
    expect(isCanvasElement({ ...element(), type: "hologram" })).toBe(false)
    expect(isCanvasElement({ ...element(), style: undefined })).toBe(false)
    expect(isCanvasElement({ ...element(), x: Number.NaN })).toBe(false)
    expect(isCanvasElement({ ...element(), width: -1 })).toBe(false)
    expect(isCanvasElement({ ...element(), text: 42 })).toBe(false)
    expect(isCanvasElement(null)).toBe(false)
  })
})

describe("sanitizeElements", () => {
  it("returns an empty list for non-array payloads", () => {
    expect(sanitizeElements(undefined)).toEqual([])
    expect(sanitizeElements({ elements: [] })).toEqual([])
  })

  it("drops malformed records instead of throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const valid = element({ id: "keep" })
    const result = sanitizeElements([
      valid,
      { ...element({ id: "bad-type" }), type: "hologram" },
      { ...element({ id: "bad-style" }), style: {} },
      "not-an-element",
    ])
    expect(result).toEqual([valid])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("keeps the first element when ids collide", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const first = element({ id: "dup", type: "rectangle" })
    const second = element({ id: "dup", type: "ellipse" })
    expect(sanitizeElements([first, second])).toEqual([first])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
