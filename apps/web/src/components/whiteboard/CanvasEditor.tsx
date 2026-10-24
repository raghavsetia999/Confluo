import { useEffect, useRef, useState } from "react"
import { useBoardCollaboration } from "../../collab/useBoardCollaboration.ts"
import { CanvasManager, type ViewportState } from "../../canvas/CanvasManager.ts"
import { useEditorStore } from "../../stores/editorStore.ts"
import type { CanvasElement, EditorTool } from "../../types/canvas.ts"
import Minimap from "./Minimap.tsx"
import PropertiesToolbar from "./PropertiesToolbar.tsx"
import ZoomControls from "./ZoomControls.tsx"

const SHORTCUTS: Record<string, EditorTool> = {
  v: "select",
  h: "pan",
  r: "rectangle",
  o: "ellipse",
  d: "diamond",
  c: "connector",
  p: "freehand",
  t: "text",
  n: "sticky-note",
  e: "eraser",
}

export default function CanvasEditor() {
  const hostRef = useRef<HTMLDivElement>(null)
  const managerRef = useRef<CanvasManager | null>(null)
  const [viewport, setViewport] = useState<ViewportState>({
    x: 0,
    y: 0,
    zoom: 1,
  })
  const tool = useEditorStore((state) => state.tool)
  const elements = useEditorStore((state) => state.elements)
  const boardId = useEditorStore((state) => state.board?.id ?? null)
  const collaborationActive = useEditorStore(
    (state) => state.collaborationActive,
  )
  const collaborationReady = useEditorStore(
    (state) => state.collaborationReady,
  )
  const syncStatus = useEditorStore((state) => state.syncStatus)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const manager = new CanvasManager(host, {
      onChange: (next, before) => useEditorStore.getState().commit(next, before),
      onSelection: (ids) => useEditorStore.getState().select(ids),
      onViewport: setViewport,
      onToolConsumed: () => useEditorStore.getState().setTool("select"),
    })
    managerRef.current = manager

    const state = useEditorStore.getState()
    manager.setElements(state.elements)
    manager.setTool(state.tool)
    setViewport(manager.getViewport())

    const unsubscribe = useEditorStore.subscribe((next, previous) => {
      // Remote snapshots are already projected by CanvasBinding. Re-feeding the
      // derived Zustand copy would duplicate the work and could interrupt an
      // in-flight local gesture.
      if (
        next.elements !== previous.elements &&
        next.elementsSource !== "remote"
      ) {
        manager.setElements(next.elements)
      }
      if (next.tool !== previous.tool) manager.setTool(next.tool)
    })

    return () => {
      unsubscribe()
      manager.destroy()
      managerRef.current = null
    }
  }, [])

  useBoardCollaboration(boardId, managerRef)

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches("input, textarea, select, [contenteditable]")) return
      const manager = managerRef.current
      if (manager?.isEditing()) return
      const store = useEditorStore.getState()
      if (store.collaborationActive && !store.collaborationReady) return

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault()
        if (event.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (store.selectedIds.length) {
          event.preventDefault()
          if (manager) manager.deleteSelected()
          else store.remove()
        }
        return
      }
      if (event.key === "Escape") {
        manager?.cancel()
        store.select([])
        return
      }
      const nextTool = SHORTCUTS[event.key.toLowerCase()]
      if (nextTool) store.setTool(nextTool)
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  const updateSelected = (changes: {
    rotation?: number
    style?: Partial<CanvasElement["style"]>
  }) => {
    const manager = managerRef.current
    if (manager) {
      manager.updateSelected(changes)
      return
    }
    const state = useEditorStore.getState()
    const selected = state.elements.find((element) =>
      state.selectedIds.includes(element.id),
    )
    if (!selected) return
    state.update(state.selectedIds, {
      ...changes,
      style: changes.style
        ? { ...selected.style, ...changes.style }
        : selected.style,
    })
  }

  const rotateSelected = () => {
    const manager = managerRef.current
    if (manager) {
      manager.rotateSelected(15)
      return
    }
    const state = useEditorStore.getState()
    const selected = state.elements.find((element) =>
      state.selectedIds.includes(element.id),
    )
    if (selected) {
      state.update([selected.id], { rotation: selected.rotation + 15 })
    }
  }

  const duplicateSelected = () => {
    const manager = managerRef.current
    if (manager) manager.duplicateSelected()
    else useEditorStore.getState().duplicate()
  }

  const deleteSelected = () => {
    const manager = managerRef.current
    if (manager) manager.deleteSelected()
    else useEditorStore.getState().remove()
  }

  const locked = collaborationActive && !collaborationReady

  return (
    <div
      className={`canvas-editor tool-${tool} ${locked ? "collab-locked" : ""}`}
    >
      <div className="canvas-host" ref={hostRef} />
      {locked ? (
        <div className="collab-lock" role="status">
          <strong>
            {syncStatus === "error"
              ? "Collaboration unavailable"
              : "Connecting to shared board"}
          </strong>
          <span>
            {syncStatus === "error"
              ? "Editing is paused so changes are not mistaken for saved work."
              : "The canvas is read-only until the shared document is synced."}
          </span>
        </div>
      ) : null}
      <PropertiesToolbar
        onUpdate={updateSelected}
        onRotate={rotateSelected}
        onDuplicate={duplicateSelected}
        onDelete={deleteSelected}
      />
      <ZoomControls
        zoom={viewport.zoom}
        setZoom={(zoom) => managerRef.current?.setZoom(zoom)}
        fit={() => managerRef.current?.fitToContent()}
      />
      <Minimap elements={elements} viewport={viewport} />
    </div>
  )
}
