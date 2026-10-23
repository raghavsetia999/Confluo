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
  error: "Local save error",
}

export default function ConnectionStatus({
  status,
  simulateOffline,
}: {
  status: SyncStatus
  simulateOffline: () => void
}) {
  const Icon =
    status === "saved"
      ? Check
      : status === "offline"
        ? CloudOff
        : status === "error"
          ? AlertTriangle
          : status === "syncing" || status === "reconnecting"
            ? LoaderCircle
            : Wifi
  return (
    <button
      className={`connection-status status-${status}`}
      onClick={simulateOffline}
      title="Click to simulate offline/online"
    >
      <Icon size={14} className={status === "syncing" ? "spin" : ""} />
      <span>{labels[status]}</span>
      <small>Local prototype</small>
    </button>
  )
}
