import { describe, expect, it } from "vitest"
import {
  BOARD_DOCUMENT_PREFIX,
  documentNameForBoard,
  isValidBoardId,
  parseBoardDocumentName,
} from "./documentName.ts"

describe("collaboration document names", () => {
  it("derives one validated document name from a board id", () => {
    expect(documentNameForBoard("board-123_abc")).toBe(
      `${BOARD_DOCUMENT_PREFIX}board-123_abc`,
    )
    expect(parseBoardDocumentName("confluo.board.board-123_abc")).toBe(
      "board-123_abc",
    )
  })

  it("rejects malformed names instead of treating them as database keys", () => {
    for (const name of [
      "",
      "board-123",
      "confluo.board.",
      "confluo.board../escape",
      "confluo.board.board/child",
      "confluo.board.board.extra",
      "confluo.board. board",
      "confluo.board.é",
      `confluo.board.${"a".repeat(65)}`,
    ]) {
      expect(parseBoardDocumentName(name)).toBeNull()
    }
  })

  it("uses the same board id constraints as the schema", () => {
    expect(isValidBoardId("A")).toBe(true)
    expect(isValidBoardId(`a${"b".repeat(63)}`)).toBe(true)
    expect(isValidBoardId("")).toBe(false)
    expect(isValidBoardId("-leading")).toBe(false)
    expect(isValidBoardId("_leading")).toBe(false)
    expect(isValidBoardId("has space")).toBe(false)
    expect(isValidBoardId("has.dot")).toBe(false)
    expect(isValidBoardId(`a${"b".repeat(64)}`)).toBe(false)
    expect(() => documentNameForBoard("../escape")).toThrow("Invalid board id")
  })
})
