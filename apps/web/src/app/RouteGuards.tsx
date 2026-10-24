import { Navigate, Outlet, useLocation } from "react-router"
import WhiteboardPage from "../pages/WhiteboardPage.tsx"
import { useAuthStore } from "../stores/authStore.ts"

const SessionLoading = () => (
  <main className="not-found">
    <div>
      <span>CONFLUO</span>
      <h1>Opening your workspace…</h1>
    </div>
  </main>
)

export function ProtectedRoute() {
  const user = useAuthStore((state) => state.user)
  const initialized = useAuthStore((state) => state.initialized)
  const location = useLocation()
  if (!initialized) return <SessionLoading />
  if (!user)
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

export function BoardRoute() {
  const user = useAuthStore((state) => state.user)
  const initialized = useAuthStore((state) => state.initialized)
  const location = useLocation()
  if (!initialized) return <SessionLoading />
  if (!user)
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <WhiteboardPage />
}
