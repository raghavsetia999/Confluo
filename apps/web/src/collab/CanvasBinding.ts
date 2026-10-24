import * as Y from "yjs"
import { isCanvasElement } from "../canvas/elementSchema.ts"
import type {
  CanvasChangeListener,
  CanvasElement,
} from "../types/canvas.ts"
import {
  deleteElement,
  isElementDeleted,
  projectElements,
  readElement,
  writeElement,
  type BoardDocument,
} from "./document.ts"

/**
 * Origin for writes produced by the local canvas. B3's observer ignores this
 * origin (the canvas already shows the change); anything else is treated as a
 * remote update that must be reconciled.
 */
export const LOCAL_ORIGIN = Symbol("confluo:local")

/**
 * The slice of `CanvasManager` this binding needs. Keeping it structural means
 * the collab layer stays free of Fabric and can be tested with a fake canvas.
 */
export interface CanvasChangeSource {
  subscribeChanges(listener: CanvasChangeListener): () => void
  /** Create or update the object for one affected element. */
  applyRemoteElement(element: CanvasElement): void
  /** Remove the object for an element deleted from the shared document. */
  removeRemoteElement(id: string): void
  /** True while a local edit/transform must not be interrupted by remote data. */
  isElementBusy(id: string): boolean
  /** Remember that a remote change is waiting for this id's local gesture. */
  markRemoteDeferred(id: string): void
}

export interface CanvasBindingOptions {
  /** Test seam. Production writes always use `LOCAL_ORIGIN`. */
  origin?: unknown
  /**
   * Optional derived-UI notification. The canvas is projected directly; this
   * callback lets secondary UI (minimap, inspector) consume the same shared
   * state without making Zustand a document source.
   */
  onRemoteProjection?: (elements: CanvasElement[]) => void
}

/**
 * Mirrors committed local canvas edits into one board's shared document and
 * projects shared-document changes back into the canvas.
 *
 * Local writes are grouped by the canvas change feed and tagged with
 * `LOCAL_ORIGIN`; the Yjs observer ignores those transactions because Fabric
 * already shows the result. Remote transactions are projected incrementally:
 * only the changed element ids are read and applied.
 *
 * Inbound policy:
 * - `observeDeep` watches the root `elements` map and nested element maps.
 * - An element currently being locally text-edited or transformed is "busy".
 *   Remote fields for that id are deferred; the local commit is written on
 *   gesture end and wins (last writer). A remote delete is applied after the
 *   gesture ends, when the local stale snapshot is already suppressed.
 * - A root-key deletion is remembered so a stale Fabric event cannot recreate
 *   the deleted id.
 *
 * A binding owns one canvas subscription and one Yjs deep observer. Construct
 * it per canvas/document pair and call `dispose()` when either goes away.
 */
export class CanvasBinding {
  private readonly document: BoardDocument
  private readonly source: CanvasChangeSource
  private readonly origin: unknown
  private readonly onRemoteProjection:
    | ((elements: CanvasElement[]) => void)
    | null
  private unsubscribe: (() => void) | null
  private disposed = false
  /** Remote ids deferred until their local gesture ends. */
  private readonly pending = new Set<string>()
  /** Ids deleted remotely; stale local snapshots must not resurrect them. */
  private readonly remoteDeleted = new Set<string>()

  constructor(
    source: CanvasChangeSource,
    document: BoardDocument,
    options: CanvasBindingOptions = {},
  ) {
    this.document = document
    this.source = source
    this.origin = options.origin ?? LOCAL_ORIGIN
    this.onRemoteProjection = options.onRemoteProjection ?? null
    this.unsubscribe = source.subscribeChanges(this.handleChange)
    this.document.elements.observeDeep(this.handleRemote)
    // Reconcile a canvas that is attached to an already-populated document.
    for (const element of projectElements(this.document)) {
      this.source.applyRemoteElement(element)
    }
    this.onRemoteProjection?.(projectElements(this.document))
  }

  private handleChange = (elements: CanvasElement[]) => {
    this.applyLocal(elements)
    this.flushPending()
  }

  /**
   * Deep observer over `elements`. A nested element-map mutation arrives with
   * `path = [elementId]`; a root add/remove arrives on the root map with the
   * changed id in `keys`. Both are reduced to the same affected-id set.
   */
  private handleRemote = (
    events: Y.YEvent<Y.AbstractType<unknown>>[],
    transaction: Y.Transaction,
  ) => {
    if (this.disposed || transaction.origin === this.origin) return

    const ids = new Set<string>()
    for (const event of events) {
      if (event.target === this.document.elements) {
        for (const id of event.keys.keys()) ids.add(id)
      } else {
        const id = event.path[0]
        if (typeof id === "string") ids.add(id)
      }
    }
    this.projectIds(ids)
  }

  private projectIds(ids: Iterable<string>) {
    for (const id of ids) {
      if (this.disposed) return
      const element = readElement(this.document, id)

      if (!element) {
        // Covers both a tombstone and a removed root-map entry. Remember it so
        // a stale Fabric snapshot cannot write the id back into the document.
        this.remoteDeleted.add(id)
        if (this.source.isElementBusy(id)) {
          this.source.markRemoteDeferred(id)
          this.pending.add(id)
          continue
        }
        this.pending.delete(id)
        this.source.removeRemoteElement(id)
        continue
      }

      this.remoteDeleted.delete(id)
      if (this.source.isElementBusy(id)) {
        this.source.markRemoteDeferred(id)
        this.pending.add(id)
        continue
      }
      this.pending.delete(id)
      this.source.applyRemoteElement(element)
    }
    this.onRemoteProjection?.(projectElements(this.document))
  }

  private flushPending() {
    if (this.disposed || this.pending.size === 0) return
    const ids = [...this.pending]
    this.pending.clear()
    this.projectIds(ids)
  }

  /**
   * Mirror a full committed local snapshot. The canvas feed is already
   * boundary-based (object modified, text edit exited, pointer up), so this is
   * never called for pointer-move frames.
   *
   * Field-level diffing means an unchanged snapshot — for example after a pan
   * or zoom — writes nothing at all.
   */
  applyLocal(elements: CanvasElement[]): void {
    if (this.disposed) return

    const incoming = new Map<string, CanvasElement>()
    const incomingIds = new Set<string>()
    for (const element of elements) {
      if (!element || typeof element.id !== "string") {
        console.warn("[confluo] Ignoring invalid local canvas element", element)
        continue
      }
      // Track the id even when the record is invalid: a malformed local copy
      // must not be mistaken for a deletion of the shared element.
      incomingIds.add(element.id)
      if (!isCanvasElement(element)) {
        console.warn("[confluo] Ignoring invalid local canvas element", element)
        continue
      }
      incoming.set(element.id, element)
    }

    const writes: CanvasElement[] = []
    for (const [id, element] of incoming) {
      const existing = readElement(this.document, id)
      if (!existing) {
        // A tombstoned or root-deleted id is one-way; never resurrect it from a
        // stale snapshot (for example an object:modified event that was already
        // queued when the remote delete arrived).
        if (this.remoteDeleted.has(id) || isElementDeleted(this.document, id)) {
          continue
        }
        writes.push(element)
        continue
      }
      if (existing.type !== element.type) {
        // Type is immutable in the document model (change = delete + create).
        console.warn(`[confluo] Ignoring type change for element "${id}"`)
        continue
      }
      if (!sameElement(existing, element)) writes.push(element)
    }

    const deletes = projectElements(this.document)
      .filter((element) => !incomingIds.has(element.id))
      .map((element) => element.id)

    if (writes.length === 0 && deletes.length === 0) return

    // One transaction for the whole gesture: a move that also updates z or a
    // create/delete batch lands as a single atomic shared update. Deletion is a
    // tombstone (B0 §3), so `projectElements` removes it logically while a
    // concurrent field write can still be ordered against it.
    this.document.doc.transact(() => {
      for (const element of writes) writeElement(this.document, element)
      for (const id of deletes) deleteElement(this.document, id)
    }, this.origin)
  }

  /** Detach from the canvas. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.document.elements.unobserveDeep(this.handleRemote)
    this.pending.clear()
    this.unsubscribe?.()
    this.unsubscribe = null
  }
}

const sameStyle = (
  a: CanvasElement["style"],
  b: CanvasElement["style"],
): boolean =>
  a.fill === b.fill &&
  a.stroke === b.stroke &&
  a.strokeWidth === b.strokeWidth &&
  a.opacity === b.opacity

const samePoints = (a?: number[], b?: number[]): boolean => {
  if (a === undefined || b === undefined) return a === b
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

const sameElement = (a: CanvasElement, b: CanvasElement): boolean =>
  a.id === b.id &&
  a.type === b.type &&
  a.x === b.x &&
  a.y === b.y &&
  a.width === b.width &&
  a.height === b.height &&
  a.rotation === b.rotation &&
  a.text === b.text &&
  sameStyle(a.style, b.style) &&
  samePoints(a.points, b.points)
