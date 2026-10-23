import { createBrowserRouter } from "react-router"
import DashboardPage from "../pages/DashboardPage.tsx"
import ForgotPasswordPage from "../pages/ForgotPasswordPage.tsx"
import LandingPage from "../pages/LandingPage.tsx"
import LoginPage from "../pages/LoginPage.tsx"
import NotFoundPage from "../pages/NotFoundPage.tsx"
import SettingsPage from "../pages/SettingsPage.tsx"
import SignupPage from "../pages/SignupPage.tsx"
import { BoardRoute, ProtectedRoute } from "./RouteGuards.tsx"

export const router = createBrowserRouter([
  { path: "/", Component: LandingPage },
  { path: "/login", Component: LoginPage },
  { path: "/signup", Component: SignupPage },
  { path: "/forgot-password", Component: ForgotPasswordPage },
  {
    Component: ProtectedRoute,
    children: [
      { path: "/dashboard", Component: DashboardPage },
      { path: "/settings", Component: SettingsPage },
    ],
  },
  { path: "/board/:boardId", Component: BoardRoute },
  { path: "*", Component: NotFoundPage },
])
