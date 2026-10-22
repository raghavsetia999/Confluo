
import {
  Circle,
  Copy,
  Hand,
  MousePointer2,
  Square,
  Trash2,
  Type,
} from "lucide-react";

import type {
  CanvasHandle,
  CanvasTool,
} from "./canvas.types";

interface Props {
  canvas: CanvasHandle | null;
  activeTool: CanvasTool;
  onToolChange: (tool: CanvasTool) => void;
}

const baseButton =
  "rounded-lg p-2 transition-colors hover:bg-slate-100";

export default function CanvasToolbar({
  canvas,
  activeTool,
  onToolChange,
}: Props) {
  return (
    <div className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
      <button
        className={`${baseButton} ${
          activeTool === "select" ? "bg-blue-100 text-blue-700" : ""
        }`}
        onClick={() => onToolChange("select")}
        title="Select objects"
        aria-label="Select objects"
      >
        <MousePointer2 size={20} />
      </button>

      <button
        className={`${baseButton} ${
          activeTool === "pan" ? "bg-blue-100 text-blue-700" : ""
        }`}
        onClick={() => onToolChange("pan")}
        title="Pan canvas"
        aria-label="Pan canvas"
      >
        <Hand size={20} />
      </button>

      <div className="mx-1 h-7 w-px bg-slate-200" />

      <button
        className={baseButton}
        onClick={() => canvas?.addRectangle()}
        title="Add rectangle"
        aria-label="Add rectangle"
        disabled={!canvas}
      >
        <Square size={20} />
      </button>

      <button
        className={baseButton}
        onClick={() => canvas?.addCircle()}
        title="Add circle"
        aria-label="Add circle"
        disabled={!canvas}
      >
        <Circle size={20} />
      </button>

      <button
        className={baseButton}
        onClick={() => canvas?.addText()}
        title="Add text"
        aria-label="Add text"
        disabled={!canvas}
      >
        <Type size={20} />
      </button>

      <div className="mx-1 h-7 w-px bg-slate-200" />

      <button
        className={baseButton}
        onClick={() => canvas?.duplicateSelected()}
        title="Duplicate selection"
        aria-label="Duplicate selection"
        disabled={!canvas}
      >
        <Copy size={20} />
      </button>

      <button
        className={`${baseButton} text-red-600 hover:bg-red-50`}
        onClick={() => canvas?.deleteSelected()}
        title="Delete selection"
        aria-label="Delete selection"
        disabled={!canvas}
      >
        <Trash2 size={20} />
      </button>
    </div>
  );
}
