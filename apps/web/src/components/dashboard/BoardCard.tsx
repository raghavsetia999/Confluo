import { Copy, Ellipsis, Pencil, Share2, Trash2 } from "lucide-react"
import { useState } from "react"
import type { Whiteboard } from "../../types/board.ts"

export default function BoardCard({
  board,
  view,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onShare,
}: {
  board: Whiteboard
  view: "grid" | "list"
  onOpen: () => void
  onRename: () => void
  onDuplicate: () => void
  onDelete: () => void
  onShare: () => void
}) {
  const [menu, setMenu] = useState(false)
  const edited = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(board.updatedAt))
  return (
    <article className={`board-card ${view}`}>
      <button
        className="board-open"
        onClick={onOpen}
        aria-label={`Open ${board.title}`}
      >
        <div className="board-thumb">
          {board.elements.slice(0, 5).map((element) => (
            <i
              key={element.id}
              className={`thumb-${element.type}`}
              style={{
                left: `${Math.min(72, element.x / 10)}%`,
                top: `${Math.min(72, element.y / 7)}%`,
                background: element.style.fill,
              }}
            />
          ))}
        </div>
        <div className="board-copy">
          <strong>{board.title}</strong>
          <span>Edited {edited}</span>
        </div>
      </button>
      <button
        className="icon-button card-menu-button"
        onClick={() => setMenu(!menu)}
        aria-label="Board actions"
      >
        <Ellipsis size={18} />
      </button>
      {menu && (
        <div className="card-menu">
          <button onClick={onRename}>
            <Pencil size={14} />
            Rename
          </button>
          <button onClick={onDuplicate}>
            <Copy size={14} />
            Duplicate
          </button>
          <button onClick={onShare}>
            <Share2 size={14} />
            Share
          </button>
          <hr />
          <button className="danger" onClick={onDelete}>
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      )}
    </article>
  )
}
