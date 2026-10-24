/**
 * The Hocuspocus room name is derived from a board id, never accepted raw from
 * a caller. The same rule is used by the browser and the server.
 */
export const BOARD_DOCUMENT_PREFIX = "confluo.board."

const BOARD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

export const isValidBoardId = (boardId: string): boolean =>
  BOARD_ID_PATTERN.test(boardId)

export const documentNameForBoard = (boardId: string): string => {
  if (!isValidBoardId(boardId)) {
    throw new Error(`Invalid board id "${boardId}"`)
  }
  return `${BOARD_DOCUMENT_PREFIX}${boardId}`
}

/** Returns null for malformed names, including a valid id with extra text. */
export const parseBoardDocumentName = (documentName: string): string | null => {
  if (!documentName.startsWith(BOARD_DOCUMENT_PREFIX)) return null
  const boardId = documentName.slice(BOARD_DOCUMENT_PREFIX.length)
  if (!isValidBoardId(boardId)) return null
  if (`${BOARD_DOCUMENT_PREFIX}${boardId}` !== documentName) return null
  return boardId
}
