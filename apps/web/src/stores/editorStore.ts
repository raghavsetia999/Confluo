import { create } from "zustand"
import { boardService } from "../services/boardService"
import { uid } from "../services/persistenceService"
import type { Whiteboard } from "../types/board.ts"
import type { CanvasElement, EditorTool, SyncStatus } from "../types/canvas.ts"
import type { Revision } from "../types/revision.ts"

interface EditorState {
  board: Whiteboard | null
  elements: CanvasElement[]
  selectedIds: string[]
  tool: EditorTool
  undoStack: CanvasElement[][]
  redoStack: CanvasElement[][]
  syncStatus: SyncStatus
  load(boardId: string): void
  setTool(tool: EditorTool): void
  select(ids: string[]): void
  commit(elements: CanvasElement[], snapshot?: CanvasElement[]): void
  add(element: CanvasElement): void
  update(ids: string[], changes: Partial<CanvasElement>): void
  remove(ids?: string[]): void
  duplicate(): void
  undo(): void
  redo(): void
  rename(title: string): void
  checkpoint(label: string): void
  restore(revision: Revision): void
  branch(revision: Revision, name: string): void
  switchBranch(branchId: string): void
  setSyncStatus(status: SyncStatus): void
}

const persist = (board: Whiteboard | null, elements: CanvasElement[]) => {
  if (board) return boardService.update(board.id, { elements })
  return null
}

export const useEditorStore = create<EditorState>((set, get) => ({
  board: null,
  elements: [],
  selectedIds: [],
  tool: "select",
  undoStack: [],
  redoStack: [],
  syncStatus: navigator.onLine ? "saved" : "offline",
  load(boardId) {
    const board = boardService.get(boardId)
    set({
      board,
      elements: board?.elements ?? [],
      selectedIds: [],
      undoStack: [],
      redoStack: [],
    })
  },
  setTool: (tool) => set({ tool }),
  select: (selectedIds) => set({ selectedIds }),
  commit(elements, snapshot) {
    const state = get()
    const previous = snapshot ?? state.elements
    set({ syncStatus: navigator.onLine ? "syncing" : "offline" })
    try {
      const board = persist(state.board, elements)
      set({
        board: board ?? state.board,
        elements,
        undoStack: [...state.undoStack.slice(-49), structuredClone(previous)],
        redoStack: [],
        syncStatus: navigator.onLine ? "saved" : "offline",
      })
    } catch {
      set({ syncStatus: "error" })
    }
  },
  add(element) {
    get().commit([...get().elements, element])
    set({ selectedIds: [element.id], tool: "select" })
  },
  update(ids, changes) {
    get().commit(
      get().elements.map((element) =>
        ids.includes(element.id)
          ? {
              ...element,
              ...changes,
              style: changes.style
                ? { ...element.style, ...changes.style }
                : element.style,
            }
          : element,
      ),
    )
  },
  remove(ids = get().selectedIds) {
    if (!ids.length) return
    get().commit(get().elements.filter((element) => !ids.includes(element.id)))
    set({ selectedIds: [] })
  },
  duplicate() {
    const state = get()
    const copies = state.elements
      .filter((element) => state.selectedIds.includes(element.id))
      .map((element) => ({
        ...structuredClone(element),
        id: uid("element"),
        x: element.x + 24,
        y: element.y + 24,
      }))
    if (!copies.length) return
    state.commit([...state.elements, ...copies])
    set({ selectedIds: copies.map((copy) => copy.id) })
  },
  undo() {
    const state = get()
    const previous = state.undoStack.at(-1)
    if (!previous) return
    const board = persist(state.board, previous)
    set({
      board: board ?? state.board,
      elements: previous,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [structuredClone(state.elements), ...state.redoStack],
      selectedIds: [],
      syncStatus: navigator.onLine ? "saved" : "offline",
    })
  },
  redo() {
    const state = get()
    const next = state.redoStack[0]
    if (!next) return
    const board = persist(state.board, next)
    set({
      board: board ?? state.board,
      elements: next,
      undoStack: [...state.undoStack, structuredClone(state.elements)],
      redoStack: state.redoStack.slice(1),
      selectedIds: [],
      syncStatus: navigator.onLine ? "saved" : "offline",
    })
  },
  rename(title) {
    const state = get()
    if (!state.board) return
    set({ board: boardService.update(state.board.id, { title }) })
  },
  checkpoint(label) {
    const state = get()
    if (!state.board) return
    boardService.checkpoint(state.board.id, label, state.elements)
    set({ board: boardService.get(state.board.id) })
  },
  restore(revision) {
    get().commit(structuredClone(revision.elements))
    get().checkpoint(`Restored: ${revision.label ?? "revision"}`)
  },
  branch(revision, name) {
    const state = get()
    if (!state.board) return
    const branch = {
      id: uid("branch"),
      boardId: state.board.id,
      name,
      headRevisionId: revision.id,
      createdAt: new Date().toISOString(),
    }
    const board = boardService.update(state.board.id, {
      branches: [...state.board.branches, branch],
      activeBranchId: branch.id,
      elements: structuredClone(revision.elements),
    })
    set({
      board,
      elements: structuredClone(revision.elements),
      selectedIds: [],
    })
  },
  switchBranch(branchId) {
    const state = get()
    if (!state.board) return
    const branch = state.board.branches.find((item) => item.id === branchId)
    if (!branch) return
    const revision = state.board.revisions.find(
      (item) => item.id === branch.headRevisionId,
    )
    const elements = revision
      ? structuredClone(revision.elements)
      : state.elements
    const board = boardService.update(state.board.id, {
      activeBranchId: branchId,
      elements,
    })
    set({
      board,
      elements,
      selectedIds: [],
      undoStack: [...state.undoStack, structuredClone(state.elements)],
      redoStack: [],
    })
  },
  setSyncStatus: (syncStatus) => set({ syncStatus }),
}))
