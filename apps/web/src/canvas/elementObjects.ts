import {
  Ellipse,
  Group,
  Polygon,
  Polyline,
  Rect,
  Textbox,
  type FabricObject,
} from "fabric"
import type { CanvasElement, ElementType } from "../types/canvas.ts"

export const INK = "#20201f"
const FONT = "DM Sans"
const DIAMOND_BASE = 100
const TITLE_SIZE = 24
const NOTE_TEXT_SIZE = 13
const NOTE_PADDING = 14
const NOTE_RADIUS = 3
const SHAPE_RADIUS = 10

/**
 * Types rendered from a fixed natural geometry and resized through scaleX/scaleY.
 * Everything else stores its size directly in width/height.
 */
const SCALED_TYPES: ReadonlySet<ElementType> = new Set([
  "diamond",
  "freehand",
])

interface ElementMeta {
  id: string
  type: ElementType
  createdBy: string
  /** Natural (unscaled) geometry captured at the last apply. */
  width: number
  height: number
}

/**
 * Fabric objects carry no application identity of their own, so we keep it out
 * of band. A WeakMap avoids polluting object options (which Fabric serialises)
 * and lets objects be discarded without cleanup.
 */
const registry = new WeakMap<FabricObject, ElementMeta>()

export const metaOf = (object: FabricObject): ElementMeta | undefined =>
  registry.get(object)

/**
 * Resolve the owning element id for an object, walking up through groups and
 * active selections. Returns undefined for objects Confluo does not own.
 */
export function elementIdOf(
  object: FabricObject | undefined,
): string | undefined {
  let current = object
  while (current) {
    const meta = registry.get(current)
    if (meta) return meta.id
    current = current.group
  }
  return undefined
}

const strokeValue = (stroke: string) =>
  stroke === "transparent" ? undefined : stroke

const strokeRead = (stroke: string | null | undefined) => stroke ?? "transparent"

const paint = (element: CanvasElement) => ({
  fill: element.style.fill,
  stroke: strokeValue(element.style.stroke),
  strokeWidth: element.style.strokeWidth,
  opacity: element.style.opacity,
  strokeUniform: true,
})

const place = (element: CanvasElement) => ({
  left: element.x + element.width / 2,
  top: element.y + element.height / 2,
  angle: element.rotation,
  originX: "center" as const,
  originY: "center" as const,
})

function remember(
  object: FabricObject,
  element: CanvasElement,
  width: number,
  height: number,
) {
  registry.set(object, {
    id: element.id,
    type: element.type,
    createdBy: element.createdBy,
    width,
    height,
  })
  // Polygons and polylines derive left/top from their points, so placement is
  // reasserted after construction to keep the element model authoritative.
  object.set({
    left: element.x + element.width / 2,
    top: element.y + element.height / 2,
    angle: element.rotation,
  })
  object.setCoords()
  return object
}

function diamondPoints(size: number) {
  return [
    { x: size / 2, y: 0 },
    { x: size, y: size / 2 },
    { x: size / 2, y: size },
    { x: 0, y: size / 2 },
  ]
}

/** Local-space points for a connector: the segment plus an open arrow head. */
function connectorPoints(width: number, height: number) {
  const length = Math.hypot(width, height) || 1
  const ux = width / length
  const uy = height / length
  const head = Math.min(16, Math.max(6, length * 0.2))
  const baseX = width - ux * head
  const baseY = height - uy * head
  const wing = head * 0.45
  return [
    { x: 0, y: 0 },
    { x: width, y: height },
    { x: baseX - uy * wing, y: baseY + ux * wing },
    { x: width, y: height },
    { x: baseX + uy * wing, y: baseY - ux * wing },
  ]
}

const freehandPoints = (element: CanvasElement) => {
  const flat = element.points ?? []
  const points: { x: number; y: number }[] = []
  for (let index = 0; index + 1 < flat.length; index += 2) {
    points.push({ x: flat[index], y: flat[index + 1] })
  }
  return points.length ? points : [{ x: 0, y: 0 }]
}

function stickyRect(element: CanvasElement) {
  return new Rect({
    left: 0,
    top: 0,
    originX: "left",
    originY: "top",
    width: element.width,
    height: element.height,
    rx: NOTE_RADIUS,
    ry: NOTE_RADIUS,
    strokeUniform: true,
    fill: element.style.fill,
    stroke: strokeValue(element.style.stroke),
    strokeWidth: element.style.strokeWidth,
  })
}

function stickyLabel(element: CanvasElement) {
  return new Textbox(element.text ?? "", {
    left: NOTE_PADDING,
    top: NOTE_PADDING - 2,
    originX: "left",
    originY: "top",
    width: Math.max(20, element.width - NOTE_PADDING * 2),
    fontFamily: FONT,
    fontSize: NOTE_TEXT_SIZE,
    lineHeight: 1.4,
    fill: INK,
    editable: true,
    splitByGrapheme: false,
  })
}

export function createElementObject(element: CanvasElement): FabricObject {
  const shared = { ...place(element), selectable: true, evented: true }

  switch (element.type) {
    case "rectangle":
      return remember(
        new Rect({
          ...shared,
          ...paint(element),
          width: element.width,
          height: element.height,
          rx: SHAPE_RADIUS,
          ry: SHAPE_RADIUS,
        }),
        element,
        element.width,
        element.height,
      )

    case "ellipse":
      return remember(
        new Ellipse({
          ...shared,
          ...paint(element),
          rx: element.width / 2,
          ry: element.height / 2,
        }),
        element,
        element.width,
        element.height,
      )

    case "diamond":
      return remember(
        new Polygon(diamondPoints(DIAMOND_BASE), {
          ...shared,
          ...paint(element),
          scaleX: element.width / DIAMOND_BASE,
          scaleY: element.height / DIAMOND_BASE,
        }),
        element,
        DIAMOND_BASE,
        DIAMOND_BASE,
      )

    case "text":
      return remember(
        new Textbox(element.text ?? "", {
          ...shared,
          width: element.width,
          fontFamily: FONT,
          fontSize: TITLE_SIZE,
          fontWeight: "600",
          lineHeight: 1.3,
          // Boards saved by the SVG renderer stored text colour in `stroke`
          // and left `fill` transparent; normalise that legacy shape.
          fill:
            element.style.fill === "transparent" ? INK : element.style.fill,
          opacity: element.style.opacity,
          splitByGrapheme: false,
          editable: true,
        }),
        element,
        element.width,
        element.height,
        // height is re-derived from the text below
      )

    case "sticky-note": {
      const group = new Group([stickyRect(element), stickyLabel(element)], {
        ...shared,
        subTargetCheck: true,
        interactive: true,
      })
      return remember(group, element, element.width, element.height)
    }

    case "connector":
      return remember(
        new Polyline(connectorPoints(element.width, element.height), {
          ...shared,
          ...paint(element),
          fill: "transparent",
          strokeLineJoin: "miter",
          strokeLineCap: "round",
        }),
        element,
        element.width,
        element.height,
      )

    case "freehand":
      return remember(
        new Polyline(freehandPoints(element), {
          ...shared,
          ...paint(element),
          fill: "transparent",
          strokeLineCap: "round",
          strokeLineJoin: "round",
        }),
        element,
        element.width,
        element.height,
      )
  }
}

/** Push document state onto an existing object without recreating it. */
export function applyElementToObject(
  object: FabricObject,
  element: CanvasElement,
) {
  const meta = registry.get(object)
  if (!meta || meta.type !== element.type) return

  object.set({
    left: element.x + element.width / 2,
    top: element.y + element.height / 2,
    angle: element.rotation,
    opacity: element.style.opacity,
  })
  meta.createdBy = element.createdBy

  if (SCALED_TYPES.has(element.type)) {
    object.set({
      scaleX: element.width / meta.width,
      scaleY: element.height / meta.height,
    })
  } else if (element.type === "rectangle") {
    object.set({
      scaleX: 1,
      scaleY: 1,
      width: element.width,
      height: element.height,
      ...paint(element),
    })
    meta.width = element.width
    meta.height = element.height
  } else if (element.type === "ellipse") {
    const ellipse = object as Ellipse
    ellipse.set({
      scaleX: 1,
      scaleY: 1,
      rx: element.width / 2,
      ry: element.height / 2,
      ...paint(element),
    })
    meta.width = element.width
    meta.height = element.height
  } else if (element.type === "text") {
    const text = object as Textbox
    text.set({
      scaleX: 1,
      scaleY: 1,
      width: element.width,
      text: element.text ?? "",
      fill: element.style.fill,
    })
    meta.width = element.width
    meta.height = text.height
  } else if (element.type === "sticky-note") {
    const group = object as Group
    const [rect, label] = group.getObjects()
    ;(rect as Rect).set({
      width: element.width,
      height: element.height,
      fill: element.style.fill,
      stroke: strokeValue(element.style.stroke),
      strokeWidth: element.style.strokeWidth,
    })
    ;(label as Textbox).set({
      width: Math.max(20, element.width - NOTE_PADDING * 2),
      text: element.text ?? "",
    })
    group.set({ scaleX: 1, scaleY: 1 })
    group.triggerLayout()
    meta.width = element.width
    meta.height = element.height
  } else if (element.type === "connector") {
    // Connector geometry is derived from the element box, so points are
    // regenerated instead of scaled (a scaled arrow head distorts).
    const line = object as Polyline
    line.set({
      points: connectorPoints(element.width, element.height),
      scaleX: 1,
      scaleY: 1,
    })
    line.setDimensions()
    meta.width = element.width
    meta.height = element.height
  }

  // `setDimensions` and group layout can move an object, so the placement is
  // reasserted last to keep the element model authoritative.
  object.set({
    left: element.x + element.width / 2,
    top: element.y + element.height / 2,
    angle: element.rotation,
  })
  object.setCoords()
}

/** Rebuild the logical element from an object's current transform. */
export function readElement(object: FabricObject): CanvasElement | null {
  const meta = registry.get(object)
  if (!meta) return null

  const center = object.getCenterPoint()
  // `getTotalObjectScaling()` also folds in the canvas viewport zoom and retina
  // scaling, which would make the logical element geometry depend on the
  // viewport. `getObjectScaling()` keeps only object/group scaling.
  const scaling = object.getObjectScaling()
  const naturalHeight =
    meta.type === "text" ? (object as Textbox).height : meta.height
  const width = Math.max(1, Math.abs(meta.width * scaling.x))
  const height = Math.max(1, Math.abs(naturalHeight * scaling.y))

  const element: CanvasElement = {
    id: meta.id,
    type: meta.type,
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
    rotation: object.getTotalAngle(),
    style: { fill: "#ffffff", stroke: "transparent", strokeWidth: 0, opacity: 1 },
    createdBy: meta.createdBy,
  }

  element.style.opacity = object.opacity ?? 1

  switch (meta.type) {
    case "text": {
      const text = object as Textbox
      element.text = text.text
      element.style.fill = String(text.fill ?? INK)
      element.style.opacity = text.opacity ?? 1
      break
    }
    case "sticky-note": {
      const [rect, label] = (object as Group).getObjects()
      const shape = rect as Rect
      element.text = (label as Textbox).text
      element.style.fill = String(shape.fill ?? "#ffffff")
      element.style.stroke = strokeRead(shape.stroke as string | undefined)
      element.style.strokeWidth = shape.strokeWidth ?? 0
      break
    }
    case "freehand": {
      const points: number[] = []
      for (const point of (object as Polyline).points) {
        points.push(point.x, point.y)
      }
      element.points = points
      element.style.fill = "transparent"
      element.style.stroke = strokeRead(object.stroke as string | undefined)
      element.style.strokeWidth = object.strokeWidth ?? 0
      break
    }
    case "connector": {
      element.style.fill = "transparent"
      element.style.stroke = strokeRead(object.stroke as string | undefined)
      element.style.strokeWidth = object.strokeWidth ?? 0
      break
    }
    default: {
      element.style.fill = String(object.fill ?? "#ffffff")
      element.style.stroke = strokeRead(object.stroke as string | undefined)
      element.style.strokeWidth = object.strokeWidth ?? 0
    }
  }

  return element
}
