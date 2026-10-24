import { useEffect, type RefObject } from "react"
import type { CanvasManager } from "../canvas/CanvasManager.ts"
import { useEditorStore } from "../stores/editorStore.ts"
import { BoardCollaborationSession } from "./session.ts"

/**
 * One collaboration session per mounted board. The session owns the provider,
 * Y.Doc and binding; React only starts and stops it. Callers must pass the
 * canvas manager that the binding should project into.
 */
export const useBoardCollaboration = (
  boardId: string | null,
  managerRef: RefObject<CanvasManager | null>,
): void => {
  useEffect(() => {
    if (!boardId || !managerRef.current) return
    const board = useEditorStore.getState().board
    if (!board || board.id !== boardId) return
    const manager = managerRef.current
    if (!manager) return

    const store = useEditorStore.getState()
    store.setCollaboration(true, false)
    store.setSyncStatus("connecting")

    const session = new BoardCollaborationSession({
      board,
      source: manager,
      onStatus: (status, ready) => {
        const current = useEditorStore.getState()
        current.setSyncStatus(status)
        current.setCollaboration(true, ready)
      },
      onRemoteProjection: (elements) =>
        useEditorStore.getState().applyRemote(elements),
    })
    void session.start()

    return () => {
      session.stop()
      const current = useEditorStore.getState()
      current.setCollaboration(false, false)
      current.setSyncStatus("disconnected")
    }
  }, [boardId, managerRef])
}
