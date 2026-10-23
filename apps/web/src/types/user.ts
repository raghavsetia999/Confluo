export interface User {
  id: string
  name: string
  email: string
  avatarUrl?: string
  createdAt: string
}

export interface WhiteboardMember {
  userId: string
  boardId: string
  name: string
  email: string
  role: "owner" | "editor" | "viewer"
  status: "online" | "idle" | "offline"
  joinedAt: string
}

export interface UserPresence {
  userId: string
  name: string
  color: string
  cursor?: {
    x: number
    y: number
  }
  status: "active" | "idle"
}

export interface AudioParticipant {
  userId: string
  name: string
  isMuted: boolean
  isSpeaking: boolean
  position: {
    x: number
    y: number
  }
}
