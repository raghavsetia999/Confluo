import {
  ArrowLeftRight,
  Check,
  GitBranch,
  RotateCcw,
  Save,
  X,
} from "lucide-react"
import { useState } from "react"
import { useEditorStore } from "../../stores/editorStore.ts"
import type { Revision } from "../../types/revision.ts"

export default function HistoryPanel({ close }: { close: () => void }) {
  const { board, elements, checkpoint, restore, branch, switchBranch } =
    useEditorStore()
  const [selected, setSelected] = useState<Revision | null>(
    board?.revisions[0] ?? null,
  )
  const [name, setName] = useState("")
  const [compare, setCompare] = useState(false)
  if (!board) return null
  const differences = selected
    ? {
        added: elements.filter(
          (element) =>
            !selected.elements.some((item) => item.id === element.id),
        ).length,
        removed: selected.elements.filter(
          (element) => !elements.some((item) => item.id === element.id),
        ).length,
        changed: elements.filter((element) =>
          selected.elements.some(
            (item) =>
              item.id === element.id &&
              JSON.stringify(item) !== JSON.stringify(element),
          ),
        ).length,
      }
    : null
  const save = () => {
    checkpoint(name.trim() || `Checkpoint ${board.revisions.length + 1}`)
    setName("")
  }
  return (
    <aside className="history-panel">
      <header>
        <div>
          <h2>Version history</h2>
          <p>Local snapshots for this board</p>
        </div>
        <button className="icon-button" onClick={close}>
          <X size={18} />
        </button>
      </header>
      <div className="branch-select">
        <span>
          <GitBranch size={15} />
          Branch
        </span>
        <select
          value={board.activeBranchId}
          onChange={(event) => switchBranch(event.target.value)}
        >
          {board.branches.map((item) => (
            <option value={item.id} key={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <div className="checkpoint-form">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name this checkpoint"
        />
        <button className="primary-button" onClick={save}>
          <Save size={14} />
          Save
        </button>
      </div>
      <div className="revision-list">
        {board.revisions.length === 0 ? (
          <div className="history-empty">
            <Save size={22} />
            <strong>No checkpoints yet</strong>
            <p>Create one before exploring a risky idea.</p>
          </div>
        ) : (
          board.revisions.map((revision) => (
            <button
              key={revision.id}
              className={selected?.id === revision.id ? "active" : ""}
              onClick={() => setSelected(revision)}
            >
              <i />
              <div>
                <small>{new Date(revision.createdAt).toLocaleString()}</small>
                <strong>{revision.label ?? "Unnamed revision"}</strong>
                <span>{revision.elements.length} elements</span>
              </div>
              {selected?.id === revision.id && <Check size={15} />}
            </button>
          ))
        )}
      </div>
      {selected && (
        <div className="revision-preview">
          <div>
            {selected.elements.slice(0, 6).map((element) => (
              <i
                key={element.id}
                style={{
                  left: `${Math.min(80, element.x / 12)}%`,
                  top: `${Math.min(75, element.y / 9)}%`,
                  background: element.style.fill,
                }}
              />
            ))}
          </div>
          <span>Previewing</span>
          <strong>{selected.label}</strong>
        </div>
      )}
      {compare && differences && (
        <div className="compare-summary">
          <strong>
            <ArrowLeftRight size={14} />
            Compared with live board
          </strong>
          <span className="added">+{differences.added} added</span>
          <span className="removed">−{differences.removed} removed</span>
          <span>{differences.changed} modified</span>
        </div>
      )}
      <footer>
        <button
          className="secondary-button"
          disabled={!selected}
          onClick={() => setCompare(!compare)}
        >
          <ArrowLeftRight size={14} />
          Compare
        </button>
        <button
          className="secondary-button"
          disabled={!selected}
          onClick={() =>
            selected && branch(selected, `Branch ${board.branches.length + 1}`)
          }
        >
          <GitBranch size={14} />
          Branch
        </button>
        <button
          className="primary-button"
          disabled={!selected}
          onClick={() => selected && restore(selected)}
        >
          <RotateCcw size={14} />
          Restore
        </button>
      </footer>
      <small className="panel-disclaimer">
        Local prototype history · not distributed CRDT history
      </small>
    </aside>
  )
}
