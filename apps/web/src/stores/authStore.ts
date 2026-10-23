import { create } from "zustand"
import { authService } from "../services/authService"
import type { User } from "../types/user.ts"

interface AuthState {
  user: User | null
  loading: boolean
  error: string | null
  login(email: string, password: string): Promise<void>
  signup(name: string, email: string, password: string): Promise<void>
  logout(): void
  clearError(): void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: authService.current(),
  loading: false,
  error: null,
  async login(email, password) {
    set({ loading: true, error: null })
    try {
      set({ user: await authService.login(email, password), loading: false })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Unable to sign in.",
      })
      throw error
    }
  },
  async signup(name, email, password) {
    set({ loading: true, error: null })
    try {
      set({
        user: await authService.signup(name, email, password),
        loading: false,
      })
    } catch (error) {
      set({
        loading: false,
        error:
          error instanceof Error ? error.message : "Unable to create account.",
      })
      throw error
    }
  },
  logout() {
    authService.logout()
    set({ user: null })
  },
  clearError: () => set({ error: null }),
}))
