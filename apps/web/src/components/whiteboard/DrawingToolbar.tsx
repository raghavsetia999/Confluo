import {
  ArrowUpRight,
  Circle,
  Diamond,
  Eraser,
  Hand,
  MousePointer2,
  PenLine,
  Square,
  StickyNote,
  TextCursorInput,
} from "lucide-react"
import { useEditorStore } from "../../stores/editorStore.ts"
import type { EditorTool } from "../../types/canvas.ts"

const tools: {
  id: EditorTool
  label: string
  key: string
  icon: typeof Square
}[] = [
  { id: "select", label: "Select", key: "V", icon: MousePointer2 },
  { id: "pan", label: "Pan", key: "H", icon: Hand },
  { id: "rectangle", label: "Rectangle", key: "R", icon: Square },
  { id: "ellipse", label: "Ellipse", key: "O", icon: Circle },
  { id: "diamond", label: "Diamond", key: "D", icon: Diamond },
  { id: "connector", label: "Connector", key: "C", icon: ArrowUpRight },
  { id: "freehand", label: "Draw", key: "P", icon: PenLine },
  { id: "text", label: "Text", key: "T", icon: TextCursorInput },
  { id: "sticky-note", label: "Sticky note", key: "N", icon: StickyNote },
  { id: "eraser", label: "Eraser", key: "E", icon: Eraser },
]

export default function DrawingToolbar() {
  const tool = useEditorStore((state) => state.tool)
  const setTool = useEditorStore((state) => state.setTool)
  return (
    <nav className="drawing-toolbar" aria-label="Drawing tools">
      {tools.map(({ id, label, key, icon: Icon }) => (
        <button
          key={id}
          className={tool === id ? "active" : ""}
          onClick={() => setTool(id)}
          aria-label={label}
        >
          <Icon size={18} />
          <span>
            {label}
            <kbd>{key}</kbd>
          </span>
        </button>
      ))}
    </nav>
  )
}
