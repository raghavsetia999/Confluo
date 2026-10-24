import {
  ChevronDown,
  History,
  LogIn,
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
import { useAuthStore } from "../stores/authStore.ts"
import { useEditorStore } from "../stores/editorStore.ts"

export default function WhiteboardPage() {
  const { boardId = "" } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const editor = useEditorStore()
  const load = useEditorStore((state) => state.load)
  const [panel, setPanel] =
    useState<"share" | "history" | "voice" | "more" | null>(
      params.get("share") ? "share" : null,
    )
  useEffect(() => {
    load(boardId)
  }, [boardId, load])
  if (!editor.board)
    return (
      <main className="not-found">
        <Brand />
        <div>
          <span>Missing board</span>
          <h1>This whiteboard is unavailable.</h1>
          <button
            className="primary-button"
            onClick={() => navigate(user ? "/dashboard" : "/")}
          >
            Go back
          </button>
        </div>
      </main>
    )
  const closePanel = () => {
    setPanel(null)
    params.delete("share")
    setParams(params, { replace: true })
  }
  const exportBoard = () => {
    const blob = new Blob([JSON.stringify(editor.board, null, 2)], {
      type: "application/json",
    })
    const href = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = href
    link.download = `${editor.board!.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`
    link.click()
    URL.revokeObjectURL(href)
    setPanel(null)
  }
  return (
    <main className="whiteboard-page">
      <CanvasEditor />
      <header className="board-topbar">
        <div className="board-identity">
          <button
            className="icon-button"
            onClick={() => navigate(user ? "/dashboard" : "/")}
            aria-label="Back to workspace"
          >
            <Brand compact linked={false} />
          </button>
          <i />
          <div>
            <input
              value={editor.board.title}
              onChange={(event) => editor.rename(event.target.value)}
              onBlur={(event) => {
                // Titles are persisted per keystroke; normalise once the user
                // leaves the field so an empty or padded title is never stored.
                const title = event.target.value.trim()
                if (!title) editor.rename("Untitled whiteboard")
                else if (title !== event.target.value) editor.rename(title)
              }}
              aria-label="Board title"
            />
            <span>
              {boardId === "demo"
                ? "Public demo · shared canvas"
                : "Collaborative whiteboard"}
            </span>
          </div>
        </div>
        <div className="board-actions">
          <div className="collaborators">
            <Avatar name="Maya Chen" color="coral" status="online" />
            <Avatar name="Theo Lane" color="blue" status="online" />
            <Avatar name="Nora Kim" color="green" status="idle" />
            <span>Demo</span>
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
      {panel === "share" && <ShareDialog onClose={closePanel} />}
      {panel === "history" && <HistoryPanel close={closePanel} />}
      {panel === "voice" && <VoicePanel close={closePanel} />}
      {panel === "more" && (
        <div className="board-more-menu">
          {user ? (
            <Link to="/settings">
              <Settings size={15} />
              Preferences
            </Link>
          ) : (
            <Link to="/signup">
              <LogIn size={15} />
              Create an account
            </Link>
          )}
          <button onClick={() => setPanel("share")}>
            <Users size={15} />
            Manage collaborators
          </button>
          <button
            disabled={editor.collaborationActive}
            onClick={() => {
              editor.checkpoint(
                `Checkpoint ${editor.board!.revisions.length + 1}`,
              )
              setPanel("history")
            }}
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
