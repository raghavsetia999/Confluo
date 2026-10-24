import {
  AlertTriangle,
  Check,
  CloudOff,
  LoaderCircle,
  Wifi,
} from "lucide-react"
import type { SyncStatus } from "../../types/canvas.ts"

const labels: Record<SyncStatus, string> = {
  saved: "Saved locally",
  syncing: "Saving locally",
  offline: "Offline · saved locally",
  reconnecting: "Reconnecting",
  connecting: "Connecting",
  connected: "Connected · syncing",
  synced: "Live · server sync",
  disconnected: "Disconnected · changes at risk",
  error: "Collaboration error",
}

const notes: Partial<Record<SyncStatus, string>> = {
  synced: "No save receipt",
  connecting: "Loading shared state",
  connected: "Waiting for document",
  disconnected: "Reload may lose edits",
  error: "Editing paused",
}

export default function ConnectionStatus({ status }: { status: SyncStatus }) {
  const Icon =
    status === "saved"
      ? Check
      : status === "offline" || status === "disconnected"
        ? CloudOff
        : status === "error"
          ? AlertTriangle
          : status === "connecting" ||
              status === "syncing" ||
              status === "reconnecting" ||
              status === "connected"
            ? LoaderCircle
            : Wifi
  const spinning =
    status === "syncing" ||
    status === "reconnecting" ||
    status === "connecting" ||
    status === "connected"
  const detail =
    notes[status] ??
    (status === "offline" || status === "saved" ? "Local fallback" : "")
  return (
    <div
      className={`connection-status status-${status}`}
      title={
        status === "synced"
          ? "Connected to the collaboration server. This does not guarantee a durable snapshot yet."
          : status === "disconnected"
            ? "The collaboration socket is down. In-memory changes are not durably saved."
            : undefined
      }
    >
      <Icon size={14} className={spinning ? "spin" : ""} />
      <span>{labels[status]}</span>
      {detail ? <small>{detail}</small> : null}
    </div>
  )
}
