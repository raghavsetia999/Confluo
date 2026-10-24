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

/** A committed local canvas change. `before` is the pre-gesture snapshot. */
export type CanvasChangeListener = (
  elements: CanvasElement[],
  before: CanvasElement[],
) => void

export type EditorTool = "select" | "pan" | "rectangle" | "ellipse" | "diamond" | "text" | "sticky-note" | "freehand" | "connector" | "eraser"

export type SyncStatus =
  | "saved"
  | "syncing"
  | "offline"
  | "reconnecting"
  | "connecting"
  | "connected"
  | "synced"
  | "disconnected"
  | "error"

export interface SyncState {
  status: SyncStatus
  pendingChanges: number
  lastSyncedAt?: string
  errorMessage?: string
}
