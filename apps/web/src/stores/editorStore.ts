import { create } from "zustand"
import { boardService } from "../services/boardService"
import { uid } from "../services/persistenceService"
import type { Whiteboard } from "../types/board.ts"
import type { CanvasElement, EditorTool, SyncStatus } from "../types/canvas.ts"
import type { Revision } from "../types/revision.ts"

interface EditorState {
  board: Whiteboard | null
  elements: CanvasElement[]
  /** Whether the latest element snapshot came from Yjs or a local gesture. */
  elementsSource: "local" | "remote"
  selectedIds: string[]
  tool: EditorTool
  undoStack: CanvasElement[][]
  redoStack: CanvasElement[][]
  syncStatus: SyncStatus
  collaborationActive: boolean
  collaborationReady: boolean
  loading: boolean
  error: string | null
  load(boardId: string): Promise<void>
  setTool(tool: EditorTool): void
  select(ids: string[]): void
  commit(elements: CanvasElement[], snapshot?: CanvasElement[]): void
  add(element: CanvasElement): void
  update(ids: string[], changes: Partial<CanvasElement>): void
  remove(ids?: string[]): void
  duplicate(): void
  undo(): void
  redo(): void
  rename(title: string): Promise<void>
  checkpoint(label: string): void
  restore(revision: Revision): void
  branch(revision: Revision, name: string): void
  switchBranch(branchId: string): void
  applyRemote(elements: CanvasElement[]): void
  setSyncStatus(status: SyncStatus): void
  setCollaboration(active: boolean, ready: boolean): void
}

const messageFor = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to load this board."

let loadGeneration = 0

export const useEditorStore = create<EditorState>((set, get) => ({
  board: null,
  elements: [],
  elementsSource: "local",
  selectedIds: [],
  tool: "select",
  undoStack: [],
  redoStack: [],
  syncStatus: "disconnected",
  collaborationActive: false,
  collaborationReady: false,
  loading: false,
  error: null,

  async load(boardId) {
    const generation = ++loadGeneration
    set({
      board: null,
      elements: [],
      elementsSource: "local",
      selectedIds: [],
      undoStack: [],
      redoStack: [],
      collaborationActive: false,
      collaborationReady: false,
      syncStatus: "connecting",
      loading: true,
      error: null,
    })
    try {
      const board = await boardService.get(boardId)
      if (generation !== loadGeneration) return
      set({
        board,
        elements: board.elements,
        elementsSource: "local",
        loading: false,
        error: null,
      })
    } catch (error) {
      if (generation !== loadGeneration) return
      set({
        board: null,
        elements: [],
        loading: false,
        error: messageFor(error),
        syncStatus: "error",
      })
    }
  },

  setTool: (tool) => set({ tool }),
  select: (selectedIds) => set({ selectedIds }),

  commit(elements, snapshot) {
    const state = get()
    const previous = snapshot ?? state.elements
    if (state.collaborationActive) {
      // Yjs is authoritative. This copy only feeds secondary UI such as the
      // minimap and must never be written to a local board blob.
      set({
        board: state.board
          ? { ...state.board, elements, updatedAt: new Date().toISOString() }
          : null,
        elements,
        elementsSource: "local",
        undoStack: [],
        redoStack: [],
      })
      return
    }
    set({
      board: state.board
        ? { ...state.board, elements, updatedAt: new Date().toISOString() }
        : null,
      elements,
      elementsSource: "local",
      undoStack: [...state.undoStack.slice(-49), structuredClone(previous)],
      redoStack: [],
    })
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
    if (state.collaborationActive) return
    const previous = state.undoStack.at(-1)
    if (!previous) return
    set({
      board: state.board
        ? { ...state.board, elements: previous, updatedAt: new Date().toISOString() }
        : null,
      elements: previous,
      elementsSource: "local",
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [structuredClone(state.elements), ...state.redoStack],
      selectedIds: [],
    })
  },

  redo() {
    const state = get()
    if (state.collaborationActive) return
    const next = state.redoStack[0]
    if (!next) return
    set({
      board: state.board
        ? { ...state.board, elements: next, updatedAt: new Date().toISOString() }
        : null,
      elements: next,
      elementsSource: "local",
      undoStack: [...state.undoStack, structuredClone(state.elements)],
      redoStack: state.redoStack.slice(1),
      selectedIds: [],
    })
  },

  async rename(title) {
    const state = get()
    if (!state.board) return
    const previous = state.board.title
    set({ board: { ...state.board, title }, error: null })
    try {
      const updated = await boardService.rename(state.board.id, title)
      if (get().board?.id !== state.board.id) return
      set((current) => ({
        board: current.board
          ? {
              ...current.board,
              title: updated.title,
              updatedAt: updated.updatedAt,
            }
          : null,
      }))
    } catch (error) {
      set((current) => ({
        board: current.board ? { ...current.board, title: previous } : null,
        error: messageFor(error),
      }))
    }
  },

  // Version history and branches belong to the earlier local-only slice. They
  // are deliberately not reimplemented in this accounts/board-milestone.
  checkpoint(_label: string) {},
  restore(_revision: Revision) {},
  branch(_revision: Revision, _name: string) {},
  switchBranch(_branchId: string) {},

  applyRemote(elements) {
    const state = get()
    const ids = new Set(elements.map((element) => element.id))
    set({
      board: state.board
        ? { ...state.board, elements, updatedAt: new Date().toISOString() }
        : null,
      elements,
      elementsSource: "remote",
      selectedIds: state.selectedIds.filter((id) => ids.has(id)),
    })
  },

  setSyncStatus: (syncStatus) => set({ syncStatus }),
  setCollaboration: (collaborationActive, collaborationReady) =>
    set({
      collaborationActive,
      collaborationReady,
      ...(collaborationActive ? { undoStack: [], redoStack: [] } : {}),
    }),
}))
