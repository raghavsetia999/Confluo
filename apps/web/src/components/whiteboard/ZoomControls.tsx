import { Focus, Minus, Plus, RotateCcw } from "lucide-react"

export default function ZoomControls({
  zoom,
  setZoom,
  fit,
}: {
  zoom: number
  setZoom: (zoom: number) => void
  fit: () => void
}) {
  return (
    <div className="zoom-controls">
      <button onClick={() => setZoom(Math.max(0.2, zoom - 0.1))}>
        <Minus size={16} />
      </button>
      <button className="zoom-value" onClick={() => setZoom(1)}>
        {Math.round(zoom * 100)}%
      </button>
      <button onClick={() => setZoom(Math.min(3, zoom + 0.1))}>
        <Plus size={16} />
      </button>
      <i />
      <button onClick={fit} title="Fit to content">
        <Focus size={16} />
      </button>
      <button onClick={() => setZoom(1)} title="Reset zoom">
        <RotateCcw size={16} />
      </button>
    </div>
  )
}
