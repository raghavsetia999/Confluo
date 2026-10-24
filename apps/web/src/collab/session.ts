import {
  HocuspocusProvider,
  type HocuspocusProviderConfiguration,
} from "@hocuspocus/provider"
import type { CanvasManager } from "../canvas/CanvasManager.ts"
import * as Y from "yjs"
import type { Whiteboard } from "../types/board.ts"
import type { CanvasElement, SyncStatus } from "../types/canvas.ts"
import { CanvasBinding, type CanvasChangeSource } from "./CanvasBinding.ts"
import { createBoardDocument, projectElements } from "./document.ts"
import { documentNameForBoard } from "./documentName.ts"

export interface CollaborationSessionSource extends CanvasChangeSource {
  setElements(elements: CanvasElement[]): void
}

export interface CollaborationSessionOptions {
  board: Whiteboard
  source: CollaborationSessionSource
  onStatus(status: SyncStatus, ready: boolean): void
  onRemoteProjection?(elements: CanvasElement[]): void
}

const env = import.meta.env as Record<string, string | undefined>

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "")

export const collaborationWebSocketUrl = (): string => {
  const configured = env.VITE_COLLAB_WS_URL?.trim()
  if (configured) return trimTrailingSlash(configured)
  const secure =
    typeof globalThis.location === "object" &&
    globalThis.location.protocol === "https:"
  const host =
    typeof globalThis.location === "object" && globalThis.location.hostname
      ? globalThis.location.hostname
      : "localhost"
  return `${secure ? "wss" : "ws"}://${host}:4001`
}

/**
 * Owns exactly one Y.Doc, Hocuspocus provider and Fabric binding for one board.
 * It is intentionally outside React so StrictMode remounts, board changes and
 * unmounts have one deterministic cleanup path.
 */
export class BoardCollaborationSession {
  private readonly board: Whiteboard
  private readonly source: CollaborationSessionSource
  private readonly onStatus: CollaborationSessionOptions["onStatus"]
  private readonly onRemoteProjection:
    | CollaborationSessionOptions["onRemoteProjection"]
    | undefined
  private doc: Y.Doc | null = null
  private provider: HocuspocusProvider | null = null
  private binding: CanvasBinding | null = null
  private active = true
  private failed = false
  private synced = false

  constructor(options: CollaborationSessionOptions) {
    this.board = options.board
    this.source = options.source
    this.onStatus = options.onStatus
    this.onRemoteProjection = options.onRemoteProjection
  }

  async start(): Promise<void> {
    this.emit("connecting", false)
    try {
      const doc = new Y.Doc()
      this.doc = doc
      const configuration: HocuspocusProviderConfiguration = {
        url: collaborationWebSocketUrl(),
        name: documentNameForBoard(this.board.id),
        document: doc,
        onStatus: ({ status }) => {
          if (!this.active || this.failed) return
          if (status === "connected") {
            this.emit(this.synced ? "synced" : "connected", this.synced)
          } else if (status === "disconnected") {
            this.emit("disconnected", false)
          } else {
            this.emit("connecting", false)
          }
        },
        onSynced: ({ state }) => {
          if (!this.active || this.failed || !state) return
          try {
            this.attachBinding()
            this.synced = true
            this.emit("synced", true)
          } catch {
            this.fail()
          }
        },
        onAuthenticationFailed: () => this.fail(),
        onDisconnect: () => {
          if (this.active && !this.failed) this.emit("disconnected", false)
        },
        onClose: () => {
          if (this.active && !this.failed) this.emit("disconnected", false)
        },
      }
      this.provider = new HocuspocusProvider(configuration)
    } catch {
      if (this.active) this.fail()
    }
  }

  private attachBinding(): void {
    if (!this.provider || !this.active) return
    if (this.binding) return
    const boardDocument = createBoardDocument(this.board.id, this.provider.document)
    const elements = projectElements(boardDocument)
    // The store starts with an empty canvas for every server-backed board. One
    // full reconciliation installs the shared projection; all later remote
    // changes use CanvasBinding's incremental, per-id projection.
    this.source.setElements(elements)
    this.binding = new CanvasBinding(this.source, boardDocument, {
      onRemoteProjection: this.onRemoteProjection,
    })
  }

  private fail(): void {
    if (!this.active || this.failed) return
    this.failed = true
    this.emit("error", false)
    this.disposeTransport()
  }

  private emit(status: SyncStatus, ready: boolean): void {
    if (this.active) this.onStatus(status, ready)
  }

  private disposeTransport(): void {
    this.binding?.dispose()
    this.binding = null
    this.provider?.destroy()
    this.provider = null
    this.doc?.destroy()
    this.doc = null
  }

  stop(): void {
    if (!this.active) return
    this.active = false
    this.disposeTransport()
  }
}

export const createCollaborationSession = (
  board: Whiteboard,
  source: CanvasManager,
  onStatus: CollaborationSessionOptions["onStatus"],
) => new BoardCollaborationSession({ board, source, onStatus })
