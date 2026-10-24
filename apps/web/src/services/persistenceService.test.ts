import { describe, expect, it } from "vitest"
import { uid } from "./persistenceService.ts"

describe("uid", () => {
  it("generates unique, prefixed element ids", () => {
    const ids = new Set(Array.from({ length: 500 }, () => uid("element")))
    expect(ids.size).toBe(500)
    for (const id of ids) expect(id.startsWith("element_")).toBe(true)
  })
})
