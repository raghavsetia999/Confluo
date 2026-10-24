import * as Y from "yjs"
import { isCanvasElement, sanitizeElements } from "../canvas/elementSchema.ts"
import type { CanvasElement } from "../types/canvas.ts"

/**
 * Typed wrapper over the shared Yjs document for one board.
 *
 * This module owns the **document shape only**. It knows nothing about
 * Hocuspocus, sockets, Fabric, React or Zustand. The canvas binding reads and
 * writes through these functions, and the server calls
 * `migrateSliceADocument` once when a board has no stored state.
 *
 * Shape (see docs/architecture/slice-b-collaboration.md §4):
 *
 *   Y.Doc
 *   ├─ "elements" : Y.Map<elementId, Y.Map>   one nested map per element
 *   └─ "meta"     : Y.Map                     boardId, schemaVersion, migratedAt
 *
 * The element id lives in the *key*, never duplicated inside the nested map, so
 * there is exactly one source of identity.
 */

export const SCHEMA_VERSION = 1

/** Default origin for the one-time Slice A import. */
export const MIGRATION_ORIGIN = Symbol("confluo:migration")

const ELEMENTS_KEY = "elements"
const META_KEY = "meta"
const BOARD_ID_KEY = "boardId"
const SCHEMA_VERSION_KEY = "schemaVersion"
const MIGRATED_AT_KEY = "migratedAt"

export interface BoardDocument {
  readonly boardId: string
  readonly doc: Y.Doc
  readonly elements: Y.Map<Y.Map<unknown>>
  readonly meta: Y.Map<unknown>
}

export interface WriteElementOptions {
  /** Yjs transaction origin. The binding passes its local origin here. */
  origin?: unknown
  /** Override the stacking index. Migration uses the stored array index. */
  z?: number
}

export interface MigrationResult {
  /** False when the document was already migrated (or already has content). */
  migrated: boolean
  inserted: string[]
  /** Legacy records dropped because they were invalid or duplicated. */
  skipped: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

/**
 * Deep-copy a JSON value before it crosses the Yjs boundary. Plain objects
 * retrieved from a shared type must never be mutated in place.
 */
const cloneJson = <T>(value: T): T => structuredClone(value)

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const setIfChanged = (map: Y.Map<unknown>, key: string, value: unknown) => {
  if (!sameJson(map.get(key), value)) map.set(key, value)
}

/**
 * Element entries must be nested Y.Maps. A malformed shared document (buggy or
 * malicious peer) can put any JSON value at an element key; such a value is not
 * an element and must never reach `.get()` or the projection.
 */
const asElementMap = (value: unknown): Y.Map<unknown> | null =>
  value instanceof Y.Map ? value : null

/**
 * Open (or initialise) the shared document for one board. Passing an existing
 * `Y.Doc` that already carries a different `boardId` is a programming error:
 * one document must never hold two boards.
 */
export function createBoardDocument(
  boardId: string,
  doc: Y.Doc = new Y.Doc(),
): BoardDocument {
  if (typeof boardId !== "string" || boardId.trim().length === 0) {
    throw new Error("A non-empty boardId is required")
  }

  const elements = doc.getMap<Y.Map<unknown>>(ELEMENTS_KEY)
  const meta = doc.getMap<unknown>(META_KEY)
  const existingBoardId = meta.get(BOARD_ID_KEY)
  const version = meta.get(SCHEMA_VERSION_KEY)

  if (version !== undefined && version !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported document schema version ${String(version)} (expected ${SCHEMA_VERSION})`,
    )
  }
  if (existingBoardId !== undefined && existingBoardId !== boardId) {
    throw new Error(
      `Y.Doc already belongs to board "${String(existingBoardId)}"`,
    )
  }
  if (existingBoardId === undefined) {
    doc.transact(() => meta.set(BOARD_ID_KEY, boardId))
  }

  return { boardId, doc, elements, meta }
}

export function hasElement(document: BoardDocument, id: string): boolean {
  return document.elements.has(id)
}

export function isElementDeleted(document: BoardDocument, id: string): boolean {
  return asElementMap(document.elements.get(id))?.get("deleted") === true
}

/**
 * Read one live element. Returns null for a missing or tombstoned element, and
 * for a nested map whose fields do not form a valid CanvasElement.
 */
export function readElement(
  document: BoardDocument,
  id: string,
): CanvasElement | null {
  const map = asElementMap(document.elements.get(id))
  if (!map || map.get("deleted") === true) return null
  return toCanvasElement(id, map)
}

/**
 * Project the whole live document into the existing Slice A model. Order is the
 * stored `z` ascending, tie-broken by id — Slice A kept stacking in array order.
 * Tombstoned, malformed and non-map entries are omitted.
 */
export function projectElements(document: BoardDocument): CanvasElement[] {
  const rows: Array<{ z: number; id: string; element: CanvasElement }> = []
  for (const [id, value] of document.elements) {
    const map = asElementMap(value)
    if (!map || map.get("deleted") === true) continue
    const element = toCanvasElement(id, map)
    if (!element) continue
    const z = map.get("z")
    rows.push({ z: isFiniteNumber(z) ? z : 0, id, element })
  }
  rows.sort((a, b) => a.z - b.z || a.id.localeCompare(b.id))
  return rows.map((row) => row.element)
}

/**
 * Insert or replace an element's logical fields. Returns false when the id is
 * tombstoned (Slice B never resurrects a deleted element).
 *
 * Immutable fields (`type`, `createdBy`, `z`) are only written on insert. A
 * caller attempting to change `type` is rejected rather than silently corrupting
 * the element.
 */
export function writeElement(
  document: BoardDocument,
  element: CanvasElement,
  options: WriteElementOptions = {},
): boolean {
  if (!isCanvasElement(element)) {
    const id = (element as Partial<CanvasElement> | null)?.id
    throw new Error(`Invalid canvas element "${String(id)}"`)
  }

  // A non-map value at the key is not a logical element: the insert below
  // replaces it rather than throwing or crashing.
  const existing = asElementMap(document.elements.get(element.id))
  if (existing && existing.get("deleted") === true) return false
  if (existing && existing.get("type") !== element.type) {
    throw new Error(
      `Cannot change element "${element.id}" from "${String(existing.get("type"))}" to "${element.type}"`,
    )
  }

  const z = existing
    ? isFiniteNumber(existing.get("z"))
      ? (existing.get("z") as number)
      : nextZ(document)
    : (options.z ?? nextZ(document))

  document.doc.transact(() => {
    const map = existing ?? new Y.Map<unknown>()
    if (!existing) {
      document.elements.set(element.id, map)
      map.set("type", element.type)
      map.set("createdBy", element.createdBy)
      map.set("z", z)
      map.set("deleted", false)
    }

    setIfChanged(map, "pos", { x: element.x, y: element.y })
    setIfChanged(map, "size", { w: element.width, h: element.height })
    setIfChanged(map, "rotation", element.rotation)
    setIfChanged(map, "style", {
      fill: element.style.fill,
      stroke: element.style.stroke,
      strokeWidth: element.style.strokeWidth,
      opacity: element.style.opacity,
    })

    if (element.text === undefined) map.delete("text")
    else setIfChanged(map, "text", element.text)

    if (element.points === undefined) map.delete("points")
    else setIfChanged(map, "points", [...element.points])
  }, options.origin)

  return true
}

/**
 * Tombstone an element. The key is kept so a concurrent field write cannot
 * vanish; projection and reads hide it. Returns true only on the transition.
 */
export function deleteElement(
  document: BoardDocument,
  id: string,
  origin?: unknown,
): boolean {
  const stored = document.elements.get(id)
  if (stored === undefined) return false
  const map = asElementMap(stored)
  if (!map) {
    // Non-map junk is not a tombstonable element; drop the key outright.
    document.doc.transact(() => document.elements.delete(id), origin)
    return true
  }
  if (map.get("deleted") === true) return false
  document.doc.transact(() => map.set("deleted", true), origin)
  return true
}

/**
 * One-time conversion of a Slice A board document (or a bare element array)
 * into this Y.Doc. Only `elements` is read; revisions and branches are outside
 * the canvas document and are not migrated. Idempotent: a document that already
 * carries a schemaVersion or any element content is left untouched.
 *
 * The marker and the seeded data are written in the same transaction, so a
 * crash can never leave a half-migrated document that would be re-applied.
 */
export function migrateSliceADocument(
  document: BoardDocument,
  legacy: unknown,
  options: { origin?: unknown } = {},
): MigrationResult {
  if (document.meta.get(SCHEMA_VERSION_KEY) !== undefined || document.elements.size > 0) {
    return { migrated: false, inserted: [], skipped: 0 }
  }

  const source = legacyElements(legacy)
  const valid = sanitizeElements(source)

  const origin = options.origin ?? MIGRATION_ORIGIN
  const inserted: string[] = []

  document.doc.transact(() => {
    valid.forEach((element, index) => {
      const map = new Y.Map<unknown>()
      document.elements.set(element.id, map)
      map.set("type", element.type)
      map.set("createdBy", element.createdBy)
      map.set("z", index)
      map.set("deleted", false)
      map.set("pos", { x: element.x, y: element.y })
      map.set("size", { w: element.width, h: element.height })
      map.set("rotation", element.rotation)
      map.set("style", {
        fill: element.style.fill,
        stroke: element.style.stroke,
        strokeWidth: element.style.strokeWidth,
        opacity: element.style.opacity,
      })
      if (element.text !== undefined) map.set("text", element.text)
      if (element.points !== undefined) map.set("points", [...element.points])
      inserted.push(element.id)
    })

    document.meta.set(SCHEMA_VERSION_KEY, SCHEMA_VERSION)
    document.meta.set(MIGRATED_AT_KEY, new Date().toISOString())
  }, origin)

  return { migrated: true, inserted, skipped: source.length - valid.length }
}

// ---------------------------------------------------------------- internals

const legacyElements = (legacy: unknown): unknown[] => {
  if (Array.isArray(legacy)) return legacy
  if (isRecord(legacy) && Array.isArray(legacy.elements)) return legacy.elements
  return []
}

const nextZ = (document: BoardDocument): number => {
  let max = -1
  for (const value of document.elements.values()) {
    const map = asElementMap(value)
    if (!map) continue
    const z = map.get("z")
    if (isFiniteNumber(z) && z > max) max = z
  }
  return max + 1
}

const toCanvasElement = (
  id: string,
  map: Y.Map<unknown>,
): CanvasElement | null => {
  const pos = map.get("pos")
  const size = map.get("size")
  const style = map.get("style")
  if (!isRecord(pos) || !isRecord(size) || !isRecord(style)) return null

  const candidate: Record<string, unknown> = {
    id,
    type: map.get("type"),
    x: pos.x,
    y: pos.y,
    width: size.w,
    height: size.h,
    rotation: map.get("rotation"),
    style: {
      fill: style.fill,
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      opacity: style.opacity,
    },
    createdBy: map.get("createdBy"),
  }

  const text = map.get("text")
  if (text !== undefined) candidate.text = text

  const points = map.get("points")
  if (points !== undefined) {
    if (!Array.isArray(points)) return null
    candidate.points = cloneJson(points)
  }

  return isCanvasElement(candidate) ? candidate : null
}
