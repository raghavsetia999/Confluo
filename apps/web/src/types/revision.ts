import type { CanvasElement } from "./canvas"

export interface Revision {
  id: string
  boardId: string
  branchId: string
  authorId: string
  createdAt: string
  label?: string
  parentRevisionIds: string[]
  elements: CanvasElement[]
}

export interface RevisionBranch {
  id: string
  boardId: string
  name: string
  headRevisionId: string
  createdAt: string
}
