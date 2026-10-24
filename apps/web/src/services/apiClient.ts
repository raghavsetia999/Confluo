const env = import.meta.env as Record<string, string | undefined>

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "")

export const apiBaseUrl = (): string => {
  const configured = env.VITE_API_URL?.trim()
  if (configured) return trimTrailingSlash(configured)
  const host =
    typeof globalThis.location === "object" && globalThis.location.hostname
      ? globalThis.location.hostname
      : "localhost"
  return `http://${host}:4000`
}

let csrfToken: string | null = null

export const setCsrfToken = (token: string | null): void => {
  csrfToken = token
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

const methodNeedsCsrf = (method: string): boolean =>
  !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())

export const apiRequest = async <T>(
  path: string,
  options: RequestInit = {},
): Promise<T> => {
  const headers = new Headers(options.headers)
  const method = options.method ?? "GET"
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  if (methodNeedsCsrf(method) && csrfToken) {
    headers.set("X-CSRF-Token", csrfToken)
  }

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...options,
    method,
    headers,
    credentials: "include",
  })

  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const body = (await response.json()) as { error?: unknown }
      if (typeof body.error === "string") message = body.error
    } catch {
      // Keep the status-based fallback for non-JSON failures.
    }
    throw new ApiError(message, response.status)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
