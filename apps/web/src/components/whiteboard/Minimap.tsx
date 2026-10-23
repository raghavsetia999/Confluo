import type { CanvasElement } from "../../types/canvas.ts"

export default function Minimap({
  elements,
  viewport,
}: {
  elements: CanvasElement[]
  viewport: {
    x: number
    y: number
    zoom: number
  }
}) {
  return (
    <div className="minimap" aria-label="Canvas overview">
      {elements.map((element) => (
        <i
          key={element.id}
          style={{
            left: `${Math.min(88, Math.max(3, element.x / 15))}%`,
            top: `${Math.min(80, Math.max(3, element.y / 10))}%`,
            background:
              element.style.fill === "transparent"
                ? element.style.stroke
                : element.style.fill,
          }}
        />
      ))}
      <span
        style={{
          transform: `translate(${-viewport.x / 30}px, ${-viewport.y / 30}px) scale(${1 / viewport.zoom})`,
        }}
      />
    </div>
  )
}
