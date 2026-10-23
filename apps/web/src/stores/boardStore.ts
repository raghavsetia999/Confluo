import { create } from "zustand"
import { boardService } from "../services/boardService"
import type { Whiteboard } from "../types/board.ts"

interface BoardState {
  boards: Whiteboard[]
  load(ownerId: string): void
  create(ownerId: string): Whiteboard
  rename(id: string, title: string): void
  duplicate(id: string, ownerId: string): void
  remove(id: string): void
}

export const useBoardStore = create<BoardState>((set) => ({
  boards: [],
  load: (ownerId) => set({ boards: boardService.list(ownerId) }),
  create(ownerId) {
    const board = boardService.create(ownerId)
    set((state) => ({ boards: [board, ...state.boards] }))
    return board
  },
  rename(id, title) {
    const board = boardService.update(id, { title })
    set((state) => ({
      boards: state.boards.map((item) => (item.id === id ? board : item)),
    }))
  },
  duplicate(id, ownerId) {
    const board = boardService.duplicate(id, ownerId)
    set((state) => ({ boards: [board, ...state.boards] }))
  },
  remove(id) {
    boardService.remove(id)
    set((state) => ({
      boards: state.boards.filter((board) => board.id !== id),
    }))
  },
}))
