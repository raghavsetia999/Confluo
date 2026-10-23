import { useEffect, useRef, useState } from "react"
import { CanvasManager, type ViewportState } from "../../canvas/CanvasManager.ts"
import { useEditorStore } from "../../stores/editorStore.ts"
import type { EditorTool } from "../../types/canvas.ts"
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
      if (next.elements !== previous.elements) manager.setElements(next.elements)
      if (next.tool !== previous.tool) manager.setTool(next.tool)
    })

    return () => {
      unsubscribe()
      manager.destroy()
      managerRef.current = null
    }
  }, [])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches("input, textarea, select, [contenteditable]")) return
      const manager = managerRef.current
      if (manager?.isEditing()) return
      const store = useEditorStore.getState()

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault()
        if (event.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (store.selectedIds.length) {
          event.preventDefault()
          store.remove()
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

  return (
    <div className={`canvas-editor tool-${tool}`}>
      <div className="canvas-host" ref={hostRef} />
      <PropertiesToolbar />
      <ZoomControls
        zoom={viewport.zoom}
        setZoom={(zoom) => managerRef.current?.setZoom(zoom)}
        fit={() => managerRef.current?.fitToContent()}
      />
      <Minimap elements={elements} viewport={viewport} />
    </div>
  )
}
