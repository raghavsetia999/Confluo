import type { Whiteboard } from "../types/board.ts"
import type { CanvasElement } from "../types/canvas.ts"
import type { Revision } from "../types/revision.ts"
import { sanitizeElements } from "../canvas/elementSchema.ts"
import { browserPersistence, uid } from "./persistenceService.ts"

const BOARDS_KEY = "confluo:boards"

const starterElements: CanvasElement[] = [
  {
    id: "starter-title",
    type: "text",
    x: 170,
    y: 130,
    width: 420,
    height: 70,
    rotation: 0,
    style: {
      fill: "#20201f",
      stroke: "transparent",
      strokeWidth: 0,
      opacity: 1,
    },
    text: "Make onboarding feel effortless",
    createdBy: "demo",
  },
  {
    id: "starter-note",
    type: "sticky-note",
    x: 680,
    y: 150,
    width: 190,
    height: 150,
    rotation: -2,
    style: { fill: "#fff0b8", stroke: "#e3cf87", strokeWidth: 1, opacity: 1 },
    text: "Give people a clear first win in under two minutes.",
    createdBy: "demo",
  },
  {
    id: "starter-rect",
    type: "rectangle",
    x: 300,
    y: 350,
    width: 210,
    height: 92,
    rotation: 0,
    style: { fill: "#eeedff", stroke: "#625df5", strokeWidth: 2, opacity: 1 },
    text: "Create together",
    createdBy: "demo",
  },
]

const defaultBoard = (
  ownerId: string,
  title = "Product discovery",
  id = uid("board"),
): Whiteboard => {
  const now = new Date().toISOString()
  const branchId = uid("branch")
  return {
    id,
    title,
    ownerId,
    createdAt: now,
    updatedAt: now,
    permission: "owner",
    elements: structuredClone(starterElements),
    members: [],
    invitations: [],
    revisions: [],
    branches: [
      {
        id: branchId,
        boardId: id,
        name: "Main",
        headRevisionId: "",
        createdAt: now,
      },
    ],
    activeBranchId: branchId,
  }
}

const readBoards = (): Whiteboard[] => {
  const stored = browserPersistence.read<unknown>(BOARDS_KEY, [])
  if (!Array.isArray(stored)) return []
  return stored
    .filter((board): board is Whiteboard =>
      Boolean(board && typeof board === "object" && typeof board.id === "string"),
    )
    .map((board) => ({ ...board, elements: sanitizeElements(board.elements) }))
}
const saveBoards = (boards: Whiteboard[]) =>
  browserPersistence.write(BOARDS_KEY, boards)

export const boardService = {
  list(ownerId: string): Whiteboard[] {
    let boards = readBoards()
    if (!boards.some((board) => board.ownerId === ownerId)) {
      boards = [defaultBoard(ownerId), ...boards]
      saveBoards(boards)
    }
    return boards
      .filter((board) => board.ownerId === ownerId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  },
  get(id: string): Whiteboard | null {
    if (id === "demo") {
      const boards = readBoards()
      const existing = boards.find((board) => board.id === "demo")
      if (existing) return existing
      const demo = defaultBoard("demo", "Confluo demo board", "demo")
      saveBoards([...boards, demo])
      return demo
    }
    return readBoards().find((board) => board.id === id) ?? null
  },
  create(ownerId: string, title = "Untitled whiteboard"): Whiteboard {
    const board = defaultBoard(ownerId, title)
    board.elements = []
    saveBoards([board, ...readBoards()])
    return board
  },
  update(id: string, changes: Partial<Whiteboard>): Whiteboard {
    let updated: Whiteboard | null = null
    const boards = readBoards().map((board) => {
      if (board.id !== id) return board
      updated = { ...board, ...changes, updatedAt: new Date().toISOString() }
      return updated
    })
    if (!updated) throw new Error("Board not found")
    saveBoards(boards)
    return updated
  },
  duplicate(id: string, ownerId: string): Whiteboard {
    const source = this.get(id)
    if (!source) throw new Error("Board not found")
    const copy = {
      ...structuredClone(source),
      id: uid("board"),
      ownerId,
      title: `${source.title} copy`,
    }
    copy.createdAt = copy.updatedAt = new Date().toISOString()
    saveBoards([copy, ...readBoards()])
    return copy
  },
  remove(id: string) {
    saveBoards(readBoards().filter((board) => board.id !== id))
  },
  checkpoint(id: string, label: string, elements: CanvasElement[]): Revision {
    const board = this.get(id)
    if (!board) throw new Error("Board not found")
    const revision: Revision = {
      id: uid("revision"),
      boardId: id,
      branchId: board.activeBranchId,
      authorId: board.ownerId,
      createdAt: new Date().toISOString(),
      label,
      parentRevisionIds: board.revisions[0] ? [board.revisions[0].id] : [],
      elements: structuredClone(elements),
    }
    this.update(id, { revisions: [revision, ...board.revisions] })
    return revision
  },
}
