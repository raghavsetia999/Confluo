import {
  Bell,
  LayoutGrid,
  List,
  LogOut,
  Plus,
  Search,
  Settings,
  Sparkles,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router"
import BoardCard from "../components/dashboard/BoardCard"
import ShareDialog from "../components/collaboration/ShareDialog"
import Avatar from "../components/ui/Avatar"
import Brand from "../components/ui/Brand"
import { useAuthStore } from "../stores/authStore.ts"
import { useBoardStore } from "../stores/boardStore.ts"
import { useEditorStore } from "../stores/editorStore.ts"

export default function DashboardPage() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const boards = useBoardStore((state) => state.boards)
  const load = useBoardStore((state) => state.load)
  const createBoardFor = useBoardStore((state) => state.create)
  const renameBoard = useBoardStore((state) => state.rename)
  const duplicateBoard = useBoardStore((state) => state.duplicate)
  const removeBoard = useBoardStore((state) => state.remove)
  const [search, setSearch] = useState("")
  const [view, setView] = useState<"grid" | "list">("grid")
  const [sharing, setSharing] = useState(false)
  const [toast, setToast] = useState("")

  useEffect(() => {
    if (user) load(user.id)
  }, [user, load])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(""), 3000)
    return () => clearTimeout(timer)
  }, [toast])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return boards
    return boards.filter((board) => board.title.toLowerCase().includes(query))
  }, [boards, search])

  const firstName = user?.name.split(" ")[0] ?? "there"

  const createBoard = () => {
    if (!user) return
    const board = createBoardFor(user.id)
    navigate(`/board/${board.id}`)
  }

  const rename = (id: string, current: string) => {
    const title = window.prompt("Rename board", current)?.trim()
    if (title) renameBoard(id, title)
  }

  const duplicate = (id: string) => {
    if (!user) return
    duplicateBoard(id, user.id)
    setToast("Board duplicated")
  }

  const remove = (id: string) => {
    if (!window.confirm("Delete this board permanently?")) return
    removeBoard(id)
    setToast("Board deleted")
  }

  const share = (id: string) => {
    useEditorStore.getState().load(id)
    setSharing(true)
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
            placeholder="Search boards"
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
                <button onClick={logout}>
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
          <button className="primary-button" onClick={createBoard}>
            <Plus size={16} />
            New board
          </button>
        </header>

        <div className="board-section-header">
          <div>
            <h2>{search ? "Search results" : "Recent boards"}</h2>
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

        {filtered.length === 0 ? (
          <div className="empty-state">
            <Sparkles size={26} />
            <h2>{search ? "No boards found" : "Start with a blank canvas"}</h2>
            <p>
              {search
                ? "Try a different search term."
                : "Your boards will appear here once you create one."}
            </p>
            {!search && (
              <button className="primary-button" onClick={createBoard}>
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
                onOpen={() => navigate(`/board/${board.id}`)}
                onRename={() => rename(board.id, board.title)}
                onDuplicate={() => duplicate(board.id)}
                onDelete={() => remove(board.id)}
                onShare={() => share(board.id)}
              />
            ))}
            {!search && (
              <button className="new-board-tile" onClick={createBoard}>
                <Plus size={22} />
                <strong>New board</strong>
                <span>Start from a blank canvas</span>
              </button>
            )}
          </div>
        )}
      </section>

      {sharing && <ShareDialog onClose={() => setSharing(false)} />}
      {toast && (
        <button className="toast" onClick={() => setToast("")}>
          {toast}
        </button>
      )}
    </main>
  )
}
