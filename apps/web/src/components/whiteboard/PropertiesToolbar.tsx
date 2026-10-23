import { Copy, RotateCw, Trash2 } from "lucide-react"
import { useEditorStore } from "../../stores/editorStore.ts"

export default function PropertiesToolbar() {
  const { elements, selectedIds, update, duplicate, remove } = useEditorStore()
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
            update(selectedIds, {
              style: { ...selected.style, fill: event.target.value },
            })
          }
        />
      </label>
      <label title="Stroke color">
        <span>Stroke</span>
        <input
          type="color"
          value={selected.style.stroke}
          onChange={(event) =>
            update(selectedIds, {
              style: { ...selected.style, stroke: event.target.value },
            })
          }
        />
      </label>
      <label className="stroke-width">
        Width
        <select
          value={selected.style.strokeWidth}
          onChange={(event) =>
            update(selectedIds, {
              style: {
                ...selected.style,
                strokeWidth: Number(event.target.value),
              },
            })
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
        onClick={() =>
          update(selectedIds, { rotation: selected.rotation + 15 })
        }
        title="Rotate 15°"
      >
        <RotateCw size={16} />
      </button>
      <button className="icon-button" onClick={duplicate} title="Duplicate">
        <Copy size={16} />
      </button>
      <button
        className="icon-button danger"
        onClick={() => remove()}
        title="Delete"
      >
        <Trash2 size={16} />
      </button>
    </div>
  )
}
