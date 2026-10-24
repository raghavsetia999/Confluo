import { useEffect } from "react"
import { RouterProvider } from "react-router"
import { useAuthStore } from "../stores/authStore.ts"
import { router } from "./Router"

export default function App() {
  const initialize = useAuthStore((state) => state.initialize)

  useEffect(() => {
    void initialize()
  }, [initialize])

  return <RouterProvider router={router} />
}
