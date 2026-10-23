export type ElementType = "rectangle" | "ellipse" | "diamond" | "text" | "sticky-note" | "freehand" | "connector"

export interface CanvasElement {
  id: string
  type: ElementType
  x: number
  y: number
  width: number
  height: number
  rotation: number
  style: {
    fill: string
    stroke: string
    strokeWidth: number
    opacity: number
  }
  text?: string
  points?: number[]
  createdBy: string
}

export type EditorTool = "select" | "pan" | "rectangle" | "ellipse" | "diamond" | "text" | "sticky-note" | "freehand" | "connector" | "eraser"

export type SyncStatus = "saved" | "syncing" | "offline" | "reconnecting" | "error"

export interface SyncState {
  status: SyncStatus
  pendingChanges: number
  lastSyncedAt?: string
  errorMessage?: string
}
