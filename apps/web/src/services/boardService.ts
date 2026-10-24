import type { CanvasElement } from "../types/canvas.ts"
import type { Whiteboard } from "../types/board.ts"
import type { WhiteboardMember } from "../types/user.ts"
import { apiRequest } from "./apiClient.ts"

interface ApiBoard {
  id: string
  title: string
  ownerId: string
  role?: "owner" | "editor" | "viewer"
  createdAt: string
  updatedAt: string
}

interface ApiMember {
  userId: string
  name: string
  email: string
  role: "owner" | "editor"
  joinedAt: string
}

interface BoardListResponse {
  boards: ApiBoard[]
}

interface BoardResponse {
  board: ApiBoard
}

interface BoardDetailResponse extends BoardResponse {
  members: ApiMember[]
}

const toMember = (member: ApiMember, boardId: string): WhiteboardMember => ({
  userId: member.userId,
  boardId,
  name: member.name,
  email: member.email,
  role: member.role,
  status: "offline",
  joinedAt: member.joinedAt,
})

const toBoard = (
  board: ApiBoard,
  members: ApiMember[] = [],
  elements: CanvasElement[] = [],
): Whiteboard => ({
  id: board.id,
  title: board.title,
  ownerId: board.ownerId,
  createdAt: board.createdAt,
  updatedAt: board.updatedAt,
  permission: board.role ?? "editor",
  elements,
  members: members.map((member) => toMember(member, board.id)),
  invitations: [],
  revisions: [],
  branches: [],
  activeBranchId: "",
})

const boardPath = (id: string): string => `/api/boards/${encodeURIComponent(id)}`

export const boardService = {
  async list(): Promise<Whiteboard[]> {
    const response = await apiRequest<BoardListResponse>("/api/boards")
    return response.boards.map((board) => toBoard(board))
  },

  async get(id: string): Promise<Whiteboard> {
    const response = await apiRequest<BoardDetailResponse>(boardPath(id))
    return toBoard(response.board, response.members)
  },

  async create(title: string): Promise<Whiteboard> {
    const response = await apiRequest<BoardResponse>("/api/boards", {
      method: "POST",
      body: JSON.stringify({ title }),
    })
    return toBoard(response.board)
  },

  async rename(id: string, title: string): Promise<Whiteboard> {
    const response = await apiRequest<BoardResponse>(boardPath(id), {
      method: "PATCH",
      body: JSON.stringify({ title }),
    })
    return toBoard(response.board)
  },

  async duplicate(id: string): Promise<Whiteboard> {
    const response = await apiRequest<BoardResponse>(`${boardPath(id)}/duplicate`, {
      method: "POST",
      body: JSON.stringify({}),
    })
    return toBoard(response.board)
  },

  async remove(id: string): Promise<void> {
    await apiRequest<void>(boardPath(id), { method: "DELETE" })
  },

  async join(boardId: string): Promise<Whiteboard> {
    const response = await apiRequest<BoardResponse>("/api/boards/join", {
      method: "POST",
      body: JSON.stringify({ boardId }),
    })
    return toBoard(response.board)
  },

  async members(id: string): Promise<WhiteboardMember[]> {
    const response = await apiRequest<{ members: ApiMember[] }>(
      `${boardPath(id)}/members`,
    )
    return response.members.map((member) => toMember(member, id))
  },
}
