import { Copy, RotateCw, Trash2 } from "lucide-react"
import { useEditorStore } from "../../stores/editorStore.ts"
import type { CanvasElement } from "../../types/canvas.ts"

interface PropertiesToolbarProps {
  onUpdate: (changes: {
    rotation?: number
    style?: Partial<CanvasElement["style"]>
  }) => void
  onRotate: () => void
  onDuplicate: () => void
  onDelete: () => void
}

export default function PropertiesToolbar({
  onUpdate,
  onRotate,
  onDuplicate,
  onDelete,
}: PropertiesToolbarProps) {
  const { elements, selectedIds } = useEditorStore()
  const selected = elements.find((element) => selectedIds.includes(element.id))
  if (!selected) return null
  return (
    <div className="properties-toolbar">
      <label title="Fill color">
        <span>Fill</span>
        <input
          type="color"
          value={
            selected.style.fill === "transparent"
              ? "#ffffff"
              : selected.style.fill
          }
          onChange={(event) =>
            onUpdate({ style: { fill: event.target.value } })
          }
        />
      </label>
      <label title="Stroke color">
        <span>Stroke</span>
        <input
          type="color"
          value={selected.style.stroke}
          onChange={(event) =>
            onUpdate({ style: { stroke: event.target.value } })
          }
        />
      </label>
      <label className="stroke-width">
        Width
        <select
          value={selected.style.strokeWidth}
          onChange={(event) =>
            onUpdate({ style: { strokeWidth: Number(event.target.value) } })
          }
        >
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="4">4</option>
          <option value="8">8</option>
        </select>
      </label>
      <button
        className="icon-button"
        onClick={onRotate}
        title="Rotate 15°"
      >
        <RotateCw size={16} />
      </button>
      <button className="icon-button" onClick={onDuplicate} title="Duplicate">
        <Copy size={16} />
      </button>
      <button
        className="icon-button danger"
        onClick={onDelete}
        title="Delete"
      >
        <Trash2 size={16} />
      </button>
    </div>
  )
}
