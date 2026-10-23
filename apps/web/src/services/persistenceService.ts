export interface PersistenceService {
  read<T>(key: string, fallback: T): T
  write<T>(key: string, value: T): void
  remove(key: string): void
}

export const browserPersistence: PersistenceService = {
  read<T,>(key: string, fallback: T): T {
    try {
      const value = localStorage.getItem(key)
      return value ? JSON.parse(value) as T : fallback
    } catch {
      return fallback
    }
  },
  write<T,>(key: string, value: T) {
    localStorage.setItem(key, JSON.stringify(value))
  },
  remove(key: string) {
    localStorage.removeItem(key)
  },
}

export const uid = (prefix = "id") =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
