import type { UserPresence } from "../types/user.ts"

export const demoPresence: UserPresence[] = [
  {
    userId: "theo",
    name: "Theo",
    color: "#5588d8",
    cursor: { x: 760, y: 360 },
    status: "active",
  },
  {
    userId: "nora",
    name: "Nora",
    color: "#58a982",
    cursor: { x: 410, y: 220 },
    status: "idle",
  },
]

export interface CollaborationProvider {
  connect(boardId: string): Promise<void>
  disconnect(): void
}

export const demoCollaborationProvider: CollaborationProvider = {
  async connect() {
    return Promise.resolve()
  },
  disconnect() {},
}
