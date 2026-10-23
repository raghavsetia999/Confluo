import type { CanvasElement } from "../types/canvas.ts"

const ELEMENT_TYPES: ReadonlySet<string> = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "text",
  "sticky-note",
  "freehand",
  "connector",
])

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

const isStyle = (value: unknown): value is CanvasElement["style"] => {
  if (!value || typeof value !== "object") return false
  const style = value as Record<string, unknown>
  return (
    typeof style.fill === "string" &&
    typeof style.stroke === "string" &&
    isFiniteNumber(style.strokeWidth) &&
    style.strokeWidth >= 0 &&
    isFiniteNumber(style.opacity)
  )
}

/**
 * Runtime guard for the serialised document. Persisted boards, drafts and
 * (later) remote Yjs payloads all cross this boundary, so the canvas never
 * receives an element it cannot render.
 */
export function isCanvasElement(value: unknown): value is CanvasElement {
  if (!value || typeof value !== "object") return false
  const element = value as Record<string, unknown>
  return (
    typeof element.id === "string" &&
    element.id.length > 0 &&
    typeof element.type === "string" &&
    ELEMENT_TYPES.has(element.type) &&
    isFiniteNumber(element.x) &&
    isFiniteNumber(element.y) &&
    // Freehand and connectors may legitimately be perfectly flat.
    isFiniteNumber(element.width) &&
    element.width >= 0 &&
    isFiniteNumber(element.height) &&
    element.height >= 0 &&
    isFiniteNumber(element.rotation) &&
    isStyle(element.style) &&
    (element.text === undefined || typeof element.text === "string") &&
    (element.points === undefined ||
      (Array.isArray(element.points) &&
        element.points.length % 2 === 0 &&
        element.points.every(isFiniteNumber))) &&
    typeof element.createdBy === "string"
  )
}

/**
 * Safe recovery for a stored element list: malformed records and duplicate ids
 * are dropped with a warning instead of tearing down the board view.
 */
export function sanitizeElements(value: unknown): CanvasElement[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const elements: CanvasElement[] = []
  for (const candidate of value) {
    if (!isCanvasElement(candidate)) {
      console.warn("[confluo] Ignoring malformed canvas element", candidate)
      continue
    }
    if (seen.has(candidate.id)) {
      console.warn(`[confluo] Ignoring duplicate element id "${candidate.id}"`)
      continue
    }
    seen.add(candidate.id)
    elements.push(candidate)
  }
  return elements
}
