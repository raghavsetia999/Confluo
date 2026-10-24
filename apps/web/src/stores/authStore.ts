import { create } from "zustand"
import { authService } from "../services/authService"
import type { User } from "../types/user.ts"

interface AuthState {
  user: User | null
  initialized: boolean
  loading: boolean
  error: string | null
  initialize(): Promise<void>
  login(email: string, password: string): Promise<void>
  signup(name: string, email: string, password: string): Promise<void>
  logout(): Promise<void>
  clearError(): void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  initialized: false,
  loading: false,
  error: null,
  async initialize() {
    set({ loading: true, error: null })
    try {
      set({ user: await authService.current(), initialized: true, loading: false })
    } catch {
      set({ user: null, initialized: true, loading: false })
    }
  },
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
  async logout() {
    set({ loading: true, error: null })
    try {
      await authService.logout()
      set({ user: null, loading: false })
    } catch (error) {
      set({
        user: null,
        loading: false,
        error: error instanceof Error ? error.message : "Unable to sign out.",
      })
    }
  },
  clearError: () => set({ error: null }),
}))
