export const SESSION_COOKIE = "confluo_session"
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

export const parseCookieHeader = (
  header: string | undefined,
): Map<string, string> => {
  const cookies = new Map<string, string>()
  if (!header) return cookies
  for (const part of header.split(";")) {
    const separator = part.indexOf("=")
    if (separator <= 0) continue
    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (!name) continue
    try {
      cookies.set(name, decodeURIComponent(value))
    } catch {
      cookies.set(name, value)
    }
  }
  return cookies
}

export const sessionTokenFromCookieHeader = (
  header: string | undefined,
): string | null => parseCookieHeader(header).get(SESSION_COOKIE) ?? null

export const serializeSessionCookie = (
  token: string,
  options: { secure: boolean; maxAgeSeconds?: number },
): string => {
  const flags = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${options.maxAgeSeconds ?? SESSION_TTL_SECONDS}`,
  ]
  if (options.secure) flags.push("Secure")
  return flags.join("; ")
}

export const clearSessionCookie = (secure: boolean): string => {
  const flags = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ]
  if (secure) flags.push("Secure")
  return flags.join("; ")
}
