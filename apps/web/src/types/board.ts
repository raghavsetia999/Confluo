import type { CanvasElement } from "./canvas.ts"
import type { Revision, RevisionBranch } from "./revision.ts"
import type { WhiteboardMember } from "./user.ts"

export interface ShareInvitation {
  id: string
  boardId: string
  email: string
  role: "editor" | "viewer"
  status: "pending" | "accepted" | "expired"
}

export interface Whiteboard {
  id: string
  title: string
  ownerId: string
  createdAt: string
  updatedAt: string
  permission: "owner" | "editor" | "viewer"
  elements: CanvasElement[]
  members: WhiteboardMember[]
  invitations: ShareInvitation[]
  revisions: Revision[]
  branches: RevisionBranch[]
  activeBranchId: string
}

export type BoardRole = Whiteboard["permission"]
