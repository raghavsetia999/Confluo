import {
  Bell,
  LayoutGrid,
  Link2,
  List,
  LoaderCircle,
  LogOut,
  Plus,
  Search,
  Settings,
  Sparkles,
} from "lucide-react"
import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router"
import ShareDialog from "../components/collaboration/ShareDialog"
import BoardCard from "../components/dashboard/BoardCard"
import Avatar from "../components/ui/Avatar"
import Brand from "../components/ui/Brand"
import Modal from "../components/ui/Modal"
import { useAuthStore } from "../stores/authStore.ts"
import { useBoardStore } from "../stores/boardStore.ts"

const BOARD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

export default function DashboardPage() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const boards = useBoardStore((state) => state.boards)
  const loading = useBoardStore((state) => state.loading)
  const loadError = useBoardStore((state) => state.error)
  const load = useBoardStore((state) => state.load)
  const createBoardFor = useBoardStore((state) => state.create)
  const renameBoard = useBoardStore((state) => state.rename)
  const duplicateBoard = useBoardStore((state) => state.duplicate)
  const removeBoard = useBoardStore((state) => state.remove)
  const joinBoard = useBoardStore((state) => state.join)
  const [search, setSearch] = useState("")
  const [view, setView] = useState<"grid" | "list">("grid")
  const [sharing, setSharing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)
  const [newTitle, setNewTitle] = useState("Untitled whiteboard")
  const [joinId, setJoinId] = useState("")
  const [dialogError, setDialogError] = useState("")
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState("")

  useEffect(() => {
    if (user) void load()
  }, [user, load])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(""), 3000)
    return () => clearTimeout(timer)
  }, [toast])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return boards
    return boards.filter(
      (board) =>
        board.title.toLowerCase().includes(query) ||
        board.id.toLowerCase().includes(query),
    )
  }, [boards, search])

  const firstName = user?.name.split(" ")[0] ?? "there"
  const sharingBoard = boards.find((board) => board.id === sharing) ?? null

  const openCreate = () => {
    setDialogError("")
    setNewTitle("Untitled whiteboard")
    setCreating(true)
  }

  const createBoard = async (event: FormEvent) => {
    event.preventDefault()
    const title = newTitle.trim()
    if (!title) {
      setDialogError("Give the board a name.")
      return
    }
    setBusy(true)
    setDialogError("")
    try {
      const board = await createBoardFor(title)
      setCreating(false)
      setNewTitle("Untitled whiteboard")
      navigate(`/board/${board.id}`)
    } catch (error) {
      setDialogError(
        error instanceof Error ? error.message : "Unable to create the board.",
      )
    } finally {
      setBusy(false)
    }
  }

  const join = async (event: FormEvent) => {
    event.preventDefault()
    const boardId = joinId.trim()
    if (!BOARD_ID_PATTERN.test(boardId)) {
      setDialogError("Enter the board ID exactly as it was shared.")
      return
    }
    setBusy(true)
    setDialogError("")
    try {
      const board = await joinBoard(boardId)
      setJoining(false)
      setJoinId("")
      navigate(`/board/${board.id}`)
    } catch (error) {
      setDialogError(
        error instanceof Error ? error.message : "Unable to join the board.",
      )
    } finally {
      setBusy(false)
    }
  }

  const rename = async (id: string, current: string) => {
    const title = window.prompt("Rename board", current)?.trim()
    if (!title) return
    try {
      await renameBoard(id, title)
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Unable to rename board")
    }
  }

  const duplicate = async (id: string) => {
    try {
      await duplicateBoard(id)
      setToast("Board duplicated")
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Unable to duplicate board",
      )
    }
  }

  const remove = async (id: string) => {
    if (!window.confirm("Delete this board permanently?")) return
    try {
      await removeBoard(id)
      setToast("Board deleted")
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Unable to delete board")
    }
  }

  return (
    <main className="dashboard-page">
      <nav className="dashboard-nav">
        <Brand />
        <label className="dashboard-search">
          <Search size={15} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search boards or IDs"
            aria-label="Search boards"
          />
          <kbd>/</kbd>
        </label>
        <div className="nav-actions">
          <button className="icon-button" aria-label="Notifications">
            <Bell size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="Settings"
            onClick={() => navigate("/settings")}
          >
            <Settings size={17} />
          </button>
          {user && (
            <div className="profile-menu">
              <Avatar name={user.name} color="indigo" status="online" />
              <div>
                <strong>{user.name}</strong>
                <span>{user.email}</span>
                <Link to="/settings">
                  <Settings size={14} />
                  Preferences
                </Link>
                <button onClick={() => void logout()}>
                  <LogOut size={14} />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </nav>

      <section className="dashboard-content">
        <header className="dashboard-heading">
          <div>
            <small>YOUR WORKSPACE</small>
            <h1>Welcome back, {firstName}</h1>
            <p>Pick up where you left off or start something new.</p>
          </div>
          <div className="dashboard-heading-actions">
            <button
              className="secondary-button"
              onClick={() => {
                setDialogError("")
                setJoining(true)
              }}
            >
              <Link2 size={15} />
              Join board
            </button>
            <button className="primary-button" onClick={openCreate}>
              <Plus size={16} />
              New board
            </button>
          </div>
        </header>

        <div className="board-section-header">
          <div>
            <h2>{search ? "Search results" : "Your boards"}</h2>
            <span>{filtered.length}</span>
          </div>
          <div>
            <button
              className={`icon-button ${view === "grid" ? "active" : ""}`}
              onClick={() => setView("grid")}
              aria-label="Grid view"
              title="Grid view"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              className={`icon-button ${view === "list" ? "active" : ""}`}
              onClick={() => setView("list")}
              aria-label="List view"
              title="List view"
            >
              <List size={16} />
            </button>
          </div>
        </div>

        {loadError && <p className="form-error">{loadError}</p>}

        {loading && boards.length === 0 ? (
          <div className="empty-state">
            <LoaderCircle className="spin" size={26} />
            <h2>Loading your boards</h2>
            <p>Checking your workspace on the server.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <Sparkles size={26} />
            <h2>{search ? "No boards found" : "Start with a blank canvas"}</h2>
            <p>
              {search
                ? "Try a different board name or ID."
                : "Create a board, or join one with an ID from a teammate."}
            </p>
            {!search && (
              <button className="primary-button" onClick={openCreate}>
                <Plus size={15} />
                Create your first board
              </button>
            )}
          </div>
        ) : (
          <div className={`boards ${view}`}>
            {filtered.map((board) => (
              <BoardCard
                key={board.id}
                board={board}
                view={view}
                canManage={board.permission === "owner"}
                onOpen={() => navigate(`/board/${board.id}`)}
                onRename={() => void rename(board.id, board.title)}
                onDuplicate={() => void duplicate(board.id)}
                onDelete={() => void remove(board.id)}
                onShare={() => setSharing(board.id)}
              />
            ))}
            {!search && (
              <button className="new-board-tile" onClick={openCreate}>
                <Plus size={22} />
                <strong>New board</strong>
                <span>Start from a blank canvas</span>
              </button>
            )}
          </div>
        )}
      </section>

      {sharingBoard && (
        <ShareDialog
          board={sharingBoard}
          onClose={() => setSharing(null)}
        />
      )}

      {creating && (
        <Modal
          title="Create a board"
          description="Name it now; you can always rename it later."
          onClose={() => setCreating(false)}
        >
          <form className="modal-form" onSubmit={(event) => void createBoard(event)}>
            <label>
              Board name
              <input
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                maxLength={200}
                autoFocus
                placeholder="Product discovery"
              />
            </label>
            {dialogError && <p className="form-error">{dialogError}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
              <button className="primary-button" disabled={busy}>
                {busy && <LoaderCircle className="spin" size={15} />}
                Create board
              </button>
            </div>
          </form>
        </Modal>
      )}

      {joining && (
        <Modal
          title="Join a board"
          description="Paste the board ID or board link shared by a teammate."
          onClose={() => setJoining(false)}
        >
          <form className="modal-form" onSubmit={(event) => void join(event)}>
            <label>
              Board ID
              <input
                value={joinId}
                onChange={(event) => setJoinId(event.target.value)}
                autoFocus
                placeholder="e.g. 7f4c9a54-…"
                spellCheck={false}
              />
            </label>
            <p className="dialog-hint">
              A board ID identifies a board but is not a password. Only people
              you trust should receive it.
            </p>
            {dialogError && <p className="form-error">{dialogError}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setJoining(false)}
              >
                Cancel
              </button>
              <button className="primary-button" disabled={busy}>
                {busy && <LoaderCircle className="spin" size={15} />}
                Join board
              </button>
            </div>
          </form>
        </Modal>
      )}

      {toast && (
        <button className="toast" onClick={() => setToast("")}>
          {toast}
        </button>
      )}
    </main>
  )
}
