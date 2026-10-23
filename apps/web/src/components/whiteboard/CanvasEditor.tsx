import { useEffect, useMemo, useRef, useState } from "react"
import { useEditorStore } from "../../stores/editorStore.ts"
import type { CanvasElement } from "../../types/canvas.ts"
import { uid } from "../../services/persistenceService.ts"
import { demoPresence } from "../../services/collaborationService.ts"
import PropertiesToolbar from "./PropertiesToolbar.tsx"
import ZoomControls from "./ZoomControls.tsx"
import Minimap from "./Minimap.tsx"

type DragState = {
  kind: "pan"
  startX: number
  startY: number
  originX: number
  originY: number
} | {
  kind: "move"
  startX: number
  startY: number
  original: CanvasElement[]
  ids: string[]
} | {
  kind: "resize"
  startX: number
  startY: number
  original: CanvasElement
  before: CanvasElement[]
} | {
  kind: "rotate"
  centerX: number
  centerY: number
  original: CanvasElement
  before: CanvasElement[]
} | {
  kind: "draw"
  id: string
  startX: number
  startY: number
  before: CanvasElement[]
}

const defaults = {
  fill: "#eeedff",
  stroke: "#625df5",
  strokeWidth: 2,
  opacity: 1,
}

export default function CanvasEditor() {
  const store = useEditorStore()
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 })
  const [drag, setDrag] = useState<DragState | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const selected = useMemo(
    () => store.elements.find((element) => store.selectedIds[0] === element.id),
    [store.elements, store.selectedIds],
  )

  const worldPoint = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: (clientX - rect.left - viewport.x) / viewport.zoom,
      y: (clientY - rect.top - viewport.y) / viewport.zoom,
    }
  }

  useEffect(() => {
    const keys: Record<string, typeof store.tool> = {
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
    const handler = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).matches("input, textarea, select"))
        return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault()
        if (event.shiftKey) store.redo()
        else store.undo()
      } else if (
        (event.key === "Delete" || event.key === "Backspace") &&
        store.selectedIds.length
      )
        store.remove()
      else if (event.key === "Escape") {
        store.select([])
        setEditing(null)
      } else if (keys[event.key.toLowerCase()])
        store.setTool(keys[event.key.toLowerCase()])
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [store])

  const beginCanvas = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    const point = worldPoint(event.clientX, event.clientY)
    if (store.tool === "select") {
      store.select([])
      return
    }
    if (store.tool === "pan") {
      setDrag({
        kind: "pan",
        startX: event.clientX,
        startY: event.clientY,
        originX: viewport.x,
        originY: viewport.y,
      })
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    const type = store.tool
    if (type === "eraser") return
    const element: CanvasElement = {
      id: uid("element"),
      type,
      x: point.x,
      y: point.y,
      width: type === "text" ? 180 : type === "sticky-note" ? 180 : 1,
      height: type === "text" ? 42 : type === "sticky-note" ? 130 : 1,
      rotation: 0,
      style:
        type === "sticky-note"
          ? { ...defaults, fill: "#fff0b8", stroke: "#e2ca76" }
          : type === "text"
            ? {
                ...defaults,
                fill: "transparent",
                stroke: "#20201f",
                strokeWidth: 1,
              }
            : { ...defaults },
      text:
        type === "text"
          ? "Double-click to edit"
          : type === "sticky-note"
            ? "Add your thought…"
            : undefined,
      points: type === "freehand" ? [point.x, point.y] : undefined,
      createdBy: store.board?.ownerId ?? "demo",
    }
    const before = structuredClone(store.elements)
    useEditorStore.setState({
      elements: [...store.elements, element],
      selectedIds: [element.id],
    })
    if (type === "text" || type === "sticky-note") {
      store.commit([...before, element], before)
      store.setTool("select")
      setEditing(element.id)
    } else {
      setDrag({
        kind: "draw",
        id: element.id,
        startX: point.x,
        startY: point.y,
        before,
      })
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }

  const beginElement = (event: React.PointerEvent, element: CanvasElement) => {
    event.stopPropagation()
    if (store.tool === "eraser") {
      store.remove([element.id])
      return
    }
    if (store.tool !== "select") return
    const ids = event.shiftKey
      ? Array.from(new Set([...store.selectedIds, element.id]))
      : store.selectedIds.includes(element.id)
        ? store.selectedIds
        : [element.id]
    store.select(ids)
    const point = worldPoint(event.clientX, event.clientY)
    setDrag({
      kind: "move",
      startX: point.x,
      startY: point.y,
      original: structuredClone(store.elements),
      ids,
    })
    ;(event.currentTarget as SVGElement).setPointerCapture(event.pointerId)
  }

  const move = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return
    if (drag.kind === "pan") {
      setViewport((current) => ({
        ...current,
        x: drag.originX + event.clientX - drag.startX,
        y: drag.originY + event.clientY - drag.startY,
      }))
      return
    }
    const point = worldPoint(event.clientX, event.clientY)
    if (drag.kind === "move") {
      useEditorStore.setState({
        elements: drag.original.map((element) =>
          drag.ids.includes(element.id)
            ? {
                ...element,
                x: element.x + point.x - drag.startX,
                y: element.y + point.y - drag.startY,
              }
            : element,
        ),
      })
    } else if (drag.kind === "resize") {
      useEditorStore.setState({
        elements: store.elements.map((element) =>
          element.id === drag.original.id
            ? {
                ...element,
                width: Math.max(20, point.x - drag.original.x),
                height: Math.max(20, point.y - drag.original.y),
              }
            : element,
        ),
      })
    } else if (drag.kind === "rotate") {
      const angle =
        (Math.atan2(point.y - drag.centerY, point.x - drag.centerX) * 180) /
          Math.PI +
        90
      useEditorStore.setState({
        elements: store.elements.map((element) =>
          element.id === drag.original.id
            ? { ...element, rotation: Math.round(angle) }
            : element,
        ),
      })
    } else if (drag.kind === "draw") {
      useEditorStore.setState({
        elements: store.elements.map((element) => {
          if (element.id !== drag.id) return element
          if (element.type === "freehand")
            return {
              ...element,
              points: [...(element.points ?? []), point.x, point.y],
              width: Math.abs(point.x - drag.startX),
              height: Math.abs(point.y - drag.startY),
            }
          return {
            ...element,
            x: Math.min(drag.startX, point.x),
            y: Math.min(drag.startY, point.y),
            width: Math.max(2, Math.abs(point.x - drag.startX)),
            height: Math.max(2, Math.abs(point.y - drag.startY)),
          }
        }),
      })
    }
  }

  const end = () => {
    if (!drag) return
    const current = useEditorStore.getState().elements
    if (drag.kind === "move") store.commit(current, drag.original)
    if (drag.kind === "resize" || drag.kind === "rotate")
      store.commit(current, drag.before)
    if (drag.kind === "draw") {
      store.commit(current, drag.before)
      store.setTool("select")
    }
    setDrag(null)
  }

  const wheel = (event: React.WheelEvent) => {
    event.preventDefault()
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY * 0.002)
      const rect = svgRef.current!.getBoundingClientRect()
      const pointer = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }
      setViewport((current) => {
        const zoom = Math.min(3, Math.max(0.2, current.zoom * factor))
        return {
          zoom,
          x: pointer.x - ((pointer.x - current.x) / current.zoom) * zoom,
          y: pointer.y - ((pointer.y - current.y) / current.zoom) * zoom,
        }
      })
    } else
      setViewport((current) => ({
        ...current,
        x: current.x - event.deltaX,
        y: current.y - event.deltaY,
      }))
  }

  const fit = () => {
    if (!store.elements.length) return setViewport({ x: 0, y: 0, zoom: 1 })
    const minX = Math.min(...store.elements.map((element) => element.x))
    const minY = Math.min(...store.elements.map((element) => element.y))
    const maxX = Math.max(
      ...store.elements.map((element) => element.x + element.width),
    )
    const maxY = Math.max(
      ...store.elements.map((element) => element.y + element.height),
    )
    const rect = svgRef.current!.getBoundingClientRect()
    const zoom = Math.min(
      1.4,
      Math.max(
        0.25,
        Math.min(
          (rect.width - 220) / (maxX - minX || 1),
          (rect.height - 180) / (maxY - minY || 1),
        ),
      ),
    )
    setViewport({
      zoom,
      x: (rect.width - (maxX - minX) * zoom) / 2 - minX * zoom,
      y: (rect.height - (maxY - minY) * zoom) / 2 - minY * zoom,
    })
  }

  return (
    <div className={`canvas-editor tool-${store.tool}`}>
      <svg
        ref={svgRef}
        onPointerDown={beginCanvas}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onWheel={wheel}
      >
        <defs>
          <pattern
            id="dotGrid"
            width="22"
            height="22"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r="1" fill="#d9d9d5" />
          </pattern>
          <marker
            id="arrowhead"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0 0 L8 4 L0 8 Z" fill="context-stroke" />
          </marker>
        </defs>
        <rect width="100%" height="100%" fill="url(#dotGrid)" />
        <g
          transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}
        >
          {store.elements.map((element) => (
            <ElementShape
              key={element.id}
              element={element}
              selected={store.selectedIds.includes(element.id)}
              onPointerDown={(event) => beginElement(event, element)}
              onDoubleClick={() =>
                element.text !== undefined ? setEditing(element.id) : undefined
              }
            />
          ))}
          {selected && (
            <Selection
              element={selected}
              onResize={(event) => {
                event.stopPropagation()
                setDrag({
                  kind: "resize",
                  startX: 0,
                  startY: 0,
                  original: structuredClone(selected),
                  before: structuredClone(store.elements),
                })
              }}
              onRotate={(event) => {
                event.stopPropagation()
                setDrag({
                  kind: "rotate",
                  centerX: selected.x + selected.width / 2,
                  centerY: selected.y + selected.height / 2,
                  original: structuredClone(selected),
                  before: structuredClone(store.elements),
                })
              }}
            />
          )}
          {demoPresence.map(
            (presence) =>
              presence.cursor && (
                <g
                  key={presence.userId}
                  transform={`translate(${presence.cursor.x} ${presence.cursor.y})`}
                  className="remote-cursor"
                >
                  <path
                    d="M0 0 L5 18 L9 11 L16 9 Z"
                    fill={presence.color}
                    stroke="white"
                    strokeWidth="1.5"
                  />
                  <rect
                    x="11"
                    y="12"
                    width="42"
                    height="20"
                    rx="5"
                    fill={presence.color}
                  />
                  <text
                    x="32"
                    y="26"
                    textAnchor="middle"
                    fill="white"
                    fontSize="10"
                  >
                    {presence.name}
                  </text>
                </g>
              ),
          )}
        </g>
      </svg>
      {editing && (
        <TextEditor
          element={store.elements.find((element) => element.id === editing)!}
          viewport={viewport}
          close={() => setEditing(null)}
        />
      )}
      <PropertiesToolbar />
      <ZoomControls
        zoom={viewport.zoom}
        setZoom={(zoom) => setViewport((current) => ({ ...current, zoom }))}
        fit={fit}
      />
      <Minimap elements={store.elements} viewport={viewport} />
    </div>
  )
}

function ElementShape({
  element,
  selected,
  onPointerDown,
  onDoubleClick,
}: {
  element: CanvasElement
  selected: boolean
  onPointerDown: (event: React.PointerEvent) => void
  onDoubleClick: () => void
}) {
  const common = {
    fill: element.style.fill,
    stroke: element.style.stroke,
    strokeWidth: element.style.strokeWidth,
    opacity: element.style.opacity,
    onPointerDown,
    onDoubleClick,
    className: selected ? "canvas-element selected" : "canvas-element",
    transform: `rotate(${element.rotation} ${element.x + element.width / 2} ${element.y + element.height / 2})`,
  }
  if (element.type === "ellipse")
    return (
      <ellipse
        {...common}
        cx={element.x + element.width / 2}
        cy={element.y + element.height / 2}
        rx={Math.abs(element.width / 2)}
        ry={Math.abs(element.height / 2)}
      />
    )
  if (element.type === "diamond")
    return (
      <polygon
        {...common}
        points={`${element.x + element.width / 2},${element.y} ${element.x + element.width},${element.y + element.height / 2} ${element.x + element.width / 2},${element.y + element.height} ${element.x},${element.y + element.height / 2}`}
      />
    )
  if (element.type === "connector")
    return (
      <line
        {...common}
        x1={element.x}
        y1={element.y}
        x2={element.x + element.width}
        y2={element.y + element.height}
        markerEnd="url(#arrowhead)"
      />
    )
  if (element.type === "freehand")
    return (
      <polyline
        {...common}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={(element.points ?? [])
          .reduce<string[]>(
            (result, value, index, points) =>
              index % 2 === 0
                ? [...result, `${value},${points[index + 1]}`]
                : result,
            [],
          )
          .join(" ")}
      />
    )
  if (element.type === "text")
    return (
      <g {...common}>
        <rect
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          fill="transparent"
          stroke="transparent"
        />
        <text
          x={element.x}
          y={element.y + 30}
          fill={element.style.stroke}
          stroke="none"
          fontSize="24"
          fontWeight="600"
        >
          {element.text}
        </text>
      </g>
    )
  return (
    <g {...common}>
      <rect
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        rx={element.type === "sticky-note" ? 3 : 10}
      />
      {element.text && (
        <foreignObject
          x={element.x + 14}
          y={element.y + 13}
          width={Math.max(1, element.width - 28)}
          height={Math.max(1, element.height - 26)}
        >
          <div className="element-text">{element.text}</div>
        </foreignObject>
      )}
    </g>
  )
}

function Selection({
  element,
  onResize,
  onRotate,
}: {
  element: CanvasElement
  onResize: (event: React.PointerEvent) => void
  onRotate: (event: React.PointerEvent) => void
}) {
  return (
    <g
      className="selection-box"
      transform={`rotate(${element.rotation} ${element.x + element.width / 2} ${element.y + element.height / 2})`}
    >
      <rect
        x={element.x - 4}
        y={element.y - 4}
        width={element.width + 8}
        height={element.height + 8}
        fill="none"
        stroke="#625df5"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={element.x + element.width}
        cy={element.y + element.height}
        r="6"
        onPointerDown={onResize}
      />
      <line
        x1={element.x + element.width / 2}
        y1={element.y - 4}
        x2={element.x + element.width / 2}
        y2={element.y - 28}
        stroke="#625df5"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={element.x + element.width / 2}
        cy={element.y - 33}
        r="6"
        onPointerDown={onRotate}
      />
    </g>
  )
}

function TextEditor({
  element,
  viewport,
  close,
}: {
  element: CanvasElement
  viewport: {
    x: number
    y: number
    zoom: number
  }
  close: () => void
}) {
  const original = useRef(structuredClone(useEditorStore.getState().elements))
  return (
    <textarea
      className="canvas-text-editor"
      autoFocus
      value={element.text}
      onChange={(event) =>
        useEditorStore.setState((state) => ({
          elements: state.elements.map((item) =>
            item.id === element.id
              ? { ...item, text: event.target.value }
              : item,
          ),
        }))
      }
      onBlur={() => {
        useEditorStore
          .getState()
          .commit(useEditorStore.getState().elements, original.current)
        close()
      }}
      style={{
        left: viewport.x + element.x * viewport.zoom,
        top: viewport.y + element.y * viewport.zoom,
        width: element.width * viewport.zoom,
        height: element.height * viewport.zoom,
        transform: `rotate(${element.rotation}deg)`,
      }}
    />
  )
}