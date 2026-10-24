import type { User } from "../types/user.ts"
import { apiRequest, setCsrfToken } from "./apiClient.ts"

interface AuthResponse {
  user: User
  csrfToken: string
}

interface SessionResponse {
  user: User | null
  csrfToken?: string
}

/**
 * Sessions are HttpOnly cookies owned by the API. The CSRF token is kept in
 * memory only and is re-fetched from the session endpoint after a refresh.
 */
export const authService = {
  async current(): Promise<User | null> {
    const session = await apiRequest<SessionResponse>("/api/auth/session")
    setCsrfToken(session.csrfToken ?? null)
    return session.user
  },

  async signup(
    name: string,
    email: string,
    password: string,
  ): Promise<User> {
    const response = await apiRequest<AuthResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    })
    setCsrfToken(response.csrfToken)
    return response.user
  },

  async login(email: string, password: string): Promise<User> {
    const response = await apiRequest<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    })
    setCsrfToken(response.csrfToken)
    return response.user
  },

  async logout(): Promise<void> {
    try {
      await apiRequest<void>("/api/auth/logout", { method: "POST" })
    } finally {
      setCsrfToken(null)
    }
  },
}
