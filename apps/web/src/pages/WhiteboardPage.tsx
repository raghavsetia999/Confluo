import {
  ChevronDown,
  History,
  MoreHorizontal,
  Redo2,
  Settings,
  Share2,
  Undo2,
  Users,
  Volume2,
} from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"
import VoicePanel from "../components/audio/VoicePanel"
import ShareDialog from "../components/collaboration/ShareDialog"
import HistoryPanel from "../components/history/HistoryPanel"
import Avatar from "../components/ui/Avatar"
import Brand from "../components/ui/Brand"
import CanvasEditor from "../components/whiteboard/CanvasEditor"
import ConnectionStatus from "../components/whiteboard/ConnectionStatus"
import DrawingToolbar from "../components/whiteboard/DrawingToolbar"
import { useEditorStore } from "../stores/editorStore.ts"
import type { Whiteboard } from "../types/board.ts"

function BoardTitleInput({ board }: { board: Whiteboard }) {
  const rename = useEditorStore((state) => state.rename)
  const [title, setTitle] = useState(board.title)

  const saveTitle = () => {
    const next = title.trim() || "Untitled whiteboard"
    setTitle(next)
    if (next !== board.title) void rename(next)
  }

  return (
    <input
      value={title}
      onChange={(event) => setTitle(event.target.value)}
      onBlur={saveTitle}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
      }}
      aria-label="Board title"
    />
  )
}

export default function WhiteboardPage() {
  const { boardId = "" } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const editor = useEditorStore()
  const load = useEditorStore((state) => state.load)
  const [panel, setPanel] =
    useState<"share" | "history" | "voice" | "more" | null>(
      params.get("share") ? "share" : null,
    )

  useEffect(() => {
    void load(boardId)
  }, [boardId, load])

  const closePanel = () => {
    setPanel(null)
    params.delete("share")
    setParams(params, { replace: true })
  }

  const board = editor.board?.id === boardId ? editor.board : null

  if (!board) {
    if (editor.loading || !editor.error) {
      return (
        <main className="not-found">
          <Brand />
          <div>
            <span>Opening board</span>
            <h1>Loading the shared canvas…</h1>
          </div>
        </main>
      )
    }
    return (
      <main className="not-found">
        <Brand />
        <div>
          <span>Unavailable</span>
          <h1>This whiteboard is unavailable.</h1>
          <p>{editor.error}</p>
          <button
            className="primary-button"
            onClick={() => navigate("/dashboard")}
          >
            Back to dashboard
          </button>
        </div>
      </main>
    )
  }

  const exportBoard = () => {
    const blob = new Blob([JSON.stringify(board, null, 2)], {
      type: "application/json",
    })
    const href = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = href
    link.download = `${board.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`
    link.click()
    URL.revokeObjectURL(href)
    setPanel(null)
  }

  return (
    <main className="whiteboard-page">
      <CanvasEditor key={board.id} />
      <header className="board-topbar">
        <div className="board-identity">
          <button
            className="icon-button"
            onClick={() => navigate("/dashboard")}
            aria-label="Back to workspace"
          >
            <Brand compact linked={false} />
          </button>
          <i />
          <div>
            <BoardTitleInput key={board.id} board={board} />
            <span>
              Collaborative whiteboard ·{" "}
              {board.permission === "owner" ? "owned by you" : "joined"}
            </span>
          </div>
        </div>
        <div className="board-actions">
          <div className="collaborators">
            {board.members.slice(0, 3).map((member) => (
              <Avatar
                key={member.userId}
                name={member.name}
                color={member.role === "owner" ? "coral" : "blue"}
                status="offline"
              />
            ))}
            <span>{board.members.length}</span>
          </div>
          <button
            className="top-button"
            onClick={() => setPanel(panel === "voice" ? null : "voice")}
          >
            <Volume2 size={16} />
            Voice
          </button>
          <button className="primary-button" onClick={() => setPanel("share")}>
            <Share2 size={15} />
            Share
          </button>
          <i />
          <button
            className="icon-button"
            onClick={editor.undo}
            disabled={editor.collaborationActive || !editor.undoStack.length}
            title="Undo"
          >
            <Undo2 size={17} />
          </button>
          <button
            className="icon-button"
            onClick={editor.redo}
            disabled={editor.collaborationActive || !editor.redoStack.length}
            title="Redo"
          >
            <Redo2 size={17} />
          </button>
          <button
            className={`icon-button ${panel === "history" ? "active" : ""}`}
            onClick={() => setPanel(panel === "history" ? null : "history")}
            title="Version history"
          >
            <History size={18} />
          </button>
          <button
            className="icon-button"
            onClick={() => setPanel(panel === "more" ? null : "more")}
          >
            <MoreHorizontal size={19} />
          </button>
        </div>
      </header>
      <DrawingToolbar />
      <div className="board-status">
        <ConnectionStatus status={editor.syncStatus} />
        <button
          className="icon-button"
          onClick={() =>
            alert(
              "Shortcuts: V Select · H Pan · R Rectangle · O Ellipse · D Diamond · C Connector · P Pencil · T Text · N Note · E Eraser",
            )
          }
          aria-label="Keyboard shortcuts"
        >
          ?
        </button>
      </div>
      {panel === "share" && (
        <ShareDialog board={board} onClose={closePanel} />
      )}
      {panel === "history" && <HistoryPanel close={closePanel} />}
      {panel === "voice" && <VoicePanel close={closePanel} />}
      {panel === "more" && (
        <div className="board-more-menu">
          <Link to="/settings">
            <Settings size={15} />
            Preferences
          </Link>
          <button onClick={() => setPanel("share")}>
            <Users size={15} />
            Manage collaborators
          </button>
          <button
            disabled
            title="Version history is not available for server-backed boards yet"
            onClick={() => setPanel("history")}
          >
            <History size={15} />
            Quick checkpoint
          </button>
          <span />
          <button onClick={exportBoard}>
            Export board
            <ChevronDown size={13} />
          </button>
        </div>
      )}
    </main>
  )
}
