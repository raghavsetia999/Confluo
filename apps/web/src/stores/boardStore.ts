import { create } from "zustand"
import { boardService } from "../services/boardService"
import type { Whiteboard } from "../types/board.ts"

interface BoardState {
  boards: Whiteboard[]
  loading: boolean
  error: string | null
  load(): Promise<void>
  create(title: string): Promise<Whiteboard>
  rename(id: string, title: string): Promise<void>
  duplicate(id: string): Promise<Whiteboard>
  remove(id: string): Promise<void>
  join(boardId: string): Promise<Whiteboard>
}

const messageFor = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong."

export const useBoardStore = create<BoardState>((set) => ({
  boards: [],
  loading: false,
  error: null,
  async load() {
    set({ loading: true, error: null })
    try {
      set({ boards: await boardService.list(), loading: false })
    } catch (error) {
      set({ loading: false, error: messageFor(error) })
    }
  },
  async create(title) {
    const board = await boardService.create(title)
    set((state) => ({ boards: [board, ...state.boards] }))
    return board
  },
  async rename(id, title) {
    const board = await boardService.rename(id, title)
    set((state) => ({
      boards: state.boards.map((item) => (item.id === id ? board : item)),
    }))
  },
  async duplicate(id) {
    const board = await boardService.duplicate(id)
    set((state) => ({ boards: [board, ...state.boards] }))
    return board
  },
  async remove(id) {
    await boardService.remove(id)
    set((state) => ({
      boards: state.boards.filter((board) => board.id !== id),
    }))
  },
  async join(boardId) {
    const board = await boardService.join(boardId)
    set((state) => ({
      boards: state.boards.some((item) => item.id === board.id)
        ? state.boards.map((item) => (item.id === board.id ? board : item))
        : [board, ...state.boards],
    }))
    return board
  },
}))
