import {
  Canvas,
  Point,
  Polyline,
  type FabricObject,
  type TPointerEventInfo,
  type TPointerEvent,
} from "fabric"
import type { CanvasElement, EditorTool, ElementType } from "../types/canvas.ts"
import {
  applyElementToObject,
  createElementObject,
  elementIdOf,
  metaOf,
  readElement,
} from "./elementObjects.ts"
import { isCanvasElement } from "./elementSchema.ts"
import { uid } from "../services/persistenceService.ts"

export interface ViewportState {
  x: number
  y: number
  zoom: number
}

export interface CanvasManagerHandlers {
  /** The document changed because of a direct canvas interaction. */
  onChange(elements: CanvasElement[], before: CanvasElement[]): void
  onSelection(ids: string[]): void
  onViewport(viewport: ViewportState): void
  /** A one-shot drawing tool has been used and should revert to select. */
  onToolConsumed(): void
}

const MIN_ZOOM = 0.2
const MAX_ZOOM = 3
const GRID_SIZE = 22
const SHAPE_TOOLS: ReadonlySet<EditorTool> = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "connector",
  "freehand",
])

const clamp = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))

const sequence = (elements: CanvasElement[]) => JSON.stringify(elements)

/**
 * Owns the Fabric canvas. React never drives rendering: the manager is a
 * projection of the element list, and the only thing that ever changes that
 * list from inside the canvas is a user gesture.
 */
export class CanvasManager {
  private readonly canvas: Canvas
  private readonly host: HTMLElement
  private readonly handlers: CanvasManagerHandlers
  private readonly objects = new Map<string, FabricObject>()
  private readonly observer: ResizeObserver

  private tool: EditorTool = "select"
  private before: CanvasElement[] | null = null
  private lastEmitted: CanvasElement[] | null = null

  private draft: {
    object: FabricObject
    element: CanvasElement
    anchor: Point
  } | null = null
  private freehand: {
    object: FabricObject
    element: CanvasElement
    origin: Point
    points: Point[]
  } | null = null
  private pan: { start: Point; transform: number[] } | null = null
  /** The text object currently in edit mode, if any (may be a group child). */
  private editing: FabricObject | null = null

  constructor(
    host: HTMLElement,
    handlers: CanvasManagerHandlers,
  ) {
    this.host = host
    this.handlers = handlers
    // The canvas element is created imperatively so React never owns a node
    // that Fabric moves around in the DOM (StrictMode remounts would break it).
    const canvasElement = document.createElement("canvas")
    host.appendChild(canvasElement)
    this.canvas = new Canvas(canvasElement, {
      preserveObjectStacking: true,
      selection: true,
      selectionColor: "rgba(98, 93, 245, 0.08)",
      selectionBorderColor: "#625df5",
      selectionLineWidth: 1.5,
      borderColor: "#625df5",
      borderScaleFactor: 1.5,
      cornerColor: "#ffffff",
      cornerStrokeColor: "#625df5",
      cornerStyle: "circle",
      cornerSize: 9,
      transparentCorners: false,
      stopContextMenu: true,
      fireRightClick: false,
      uniformScaling: false,
      backgroundColor: "transparent",
    })

    this.resize()
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(host)
    this.bind()
    this.applyTool()
    this.paintGrid()
  }

  destroy() {
    // An open text box holds content that has not been flushed yet. Leave edit
    // mode first so `text:editing:exited` persists it before the canvas goes.
    if (this.editing && this.isEditing(this.editing)) {
      const editing = this.editing as FabricObject & { exitEditing(): void }
      editing.exitEditing()
    }
    this.observer.disconnect()
    // Fabric's `dispose()` is asynchronous and, when it settles, restores the
    // original <canvas> element into the host. Under StrictMode that happens
    // after the next instance has mounted (or synchronously, before it), leaving
    // a dead canvas on top of the live one that swallows pointer events. Detach
    // both the wrapper and the restored element so nothing is left behind.
    const wrapper = this.canvas.wrapperEl
    const canvasElement = this.canvas.lowerCanvasEl
    void this.canvas.dispose()
    canvasElement?.remove()
    wrapper?.remove()
    this.objects.clear()
    this.editing = null
  }

  // ---------------------------------------------------------------- document

  /**
   * Reconcile the canvas against the authoritative element list. Called for
   * undo/redo, property edits, board loads — and later, for remote Yjs updates.
   */
  setElements(elements: CanvasElement[]) {
    if (elements === this.lastEmitted) return
    const seen = new Set<string>()

    for (const element of elements) {
      if (!isCanvasElement(element)) {
        console.warn("[confluo] Skipping unrenderable canvas element", element)
        continue
      }
      seen.add(element.id)
      const existing = this.objects.get(element.id)
      if (existing && metaOf(existing)?.type === element.type) {
        if (this.isEditing(existing)) continue
        applyElementToObject(existing, element)
      } else {
        if (existing) this.dropObject(existing)
        this.objects.set(element.id, createElementObject(element))
        this.canvas.add(this.objects.get(element.id)!)
      }
    }

    for (const [id, object] of [...this.objects]) {
      if (!seen.has(id)) this.dropObject(object)
    }

    if (
      !this.canvas
        .getActiveObjects()
        .some((object) => elementIdOf(object) !== undefined)
    ) {
      this.canvas.discardActiveObject()
    }

    this.canvas.requestRenderAll()
  }

  private dropObject(object: FabricObject) {
    this.canvas.remove(object)
    for (const [id, candidate] of this.objects) {
      if (candidate === object) this.objects.delete(id)
    }
  }

  /** Walk up from a sub-target (e.g. a sticky note label) to the element. */
  private owningObject(
    object: FabricObject | null | undefined,
  ): FabricObject | undefined {
    let current = object ?? undefined
    while (current?.group) current = current.group
    return current
  }

  private readAll(): CanvasElement[] {
    const elements: CanvasElement[] = []
    for (const object of this.objects.values()) {
      const element = readElement(object)
      if (element) elements.push(element)
    }
    return elements
  }

  /**
   * Publish a canvas-originated change. `before` carries the pre-gesture state
   * so the store can record one undo entry per gesture rather than per frame.
   */
  private flush() {
    const elements = this.readAll()
    const previous = this.before ?? elements
    this.before = null
    if (this.lastEmitted && sequence(this.lastEmitted) === sequence(elements)) return
    this.lastEmitted = elements
    this.handlers.onChange(elements, previous)
  }

  private commit(next: CanvasElement[]) {
    const previous = this.before ?? this.readAll()
    this.before = null
    // Deliberately does not set `lastEmitted`: creation and deletion still need
    // the reconciler to run so the canvas catches up with the store. Transform
    // gestures go through `flush`, which already reflects them.
    this.handlers.onChange(next, previous)
  }

  // ------------------------------------------------------------------- tools

  setTool(tool: EditorTool) {
    if (this.tool === tool) return
    this.tool = tool
    this.applyTool()
  }

  private applyTool() {
    const selectable = this.tool === "select"
    this.canvas.selection = selectable
    this.canvas.skipTargetFind = !selectable && this.tool !== "eraser"
    this.canvas.defaultCursor =
      this.tool === "pan" ? "grab" : this.tool === "eraser" ? "not-allowed" : "default"
    this.canvas.hoverCursor =
      this.tool === "pan" ? "grab" : this.tool === "eraser" ? "not-allowed" : "move"
    for (const object of this.objects.values()) {
      object.selectable = selectable
      object.evented = selectable || this.tool === "eraser"
    }
    this.canvas.requestRenderAll()
  }

  isEditing(object?: FabricObject | null) {
    const target = object ?? this.canvas.getActiveObject()
    return !!target && "isEditing" in target && Boolean(target.isEditing)
  }

  isInteracting() {
    return this.isEditing() || this.draft !== null || this.freehand !== null
  }

  // ---------------------------------------------------------------- viewport

  getViewport(): ViewportState {
    const transform = this.canvas.viewportTransform
    return { x: transform[4], y: transform[5], zoom: transform[0] }
  }

  setZoom(zoom: number) {
    const next = clamp(zoom)
    const center = new Point(
      this.canvas.getWidth() / 2,
      this.canvas.getHeight() / 2,
    )
    this.canvas.zoomToPoint(center, next)
    this.afterViewport()
  }

  resetZoom() {
    this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
    this.canvas.requestRenderAll()
    this.afterViewport()
  }

  fitToContent() {
    const elements = this.readAll()
    if (!elements.length) return this.resetZoom()
    const minX = Math.min(...elements.map((element) => element.x))
    const minY = Math.min(...elements.map((element) => element.y))
    const maxX = Math.max(...elements.map((element) => element.x + element.width))
    const maxY = Math.max(...elements.map((element) => element.y + element.height))
    const width = this.canvas.getWidth()
    const height = this.canvas.getHeight()
    const zoom = clamp(
      Math.min(
        Math.min(1.4, (width - 220) / Math.max(1, maxX - minX)),
        Math.min(1.4, (height - 180) / Math.max(1, maxY - minY)),
      ),
    )
    this.canvas.setViewportTransform([
      zoom,
      0,
      0,
      zoom,
      (width - (maxX - minX) * zoom) / 2 - minX * zoom,
      (height - (maxY - minY) * zoom) / 2 - minY * zoom,
    ])
    this.canvas.requestRenderAll()
    this.afterViewport()
  }

  private afterViewport() {
    this.paintGrid()
    this.handlers.onViewport(this.getViewport())
  }

  private paintGrid() {
    const { x, y, zoom } = this.getViewport()
    const size = GRID_SIZE * zoom
    this.host.style.backgroundImage =
      "radial-gradient(circle, #d9d9d5 1px, transparent 1px)"
    this.host.style.backgroundSize = `${size}px ${size}px`
    this.host.style.backgroundPosition = `${x}px ${y}px`
  }

  private resize() {
    const rect = this.host.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    this.canvas.setDimensions({ width: rect.width, height: rect.height })
    this.canvas.requestRenderAll()
    this.afterViewport()
  }

  // ------------------------------------------------------------------ events

  private bind() {
    this.canvas.on("mouse:down", this.onPointerDown)
    this.canvas.on("mouse:move", this.onPointerMove)
    this.canvas.on("mouse:up", this.onPointerUp)
    this.canvas.on("mouse:wheel", this.onWheel)
    this.canvas.on("object:modified", this.onModified)
    this.canvas.on("text:editing:entered", this.onEditingEntered)
    this.canvas.on("text:editing:exited", this.onEditingExited)
    this.canvas.on("selection:created", this.syncSelection)
    this.canvas.on("selection:updated", this.syncSelection)
    this.canvas.on("selection:cleared", this.syncSelection)
  }

  private syncSelection = () => {
    const ids = new Set<string>()
    for (const object of this.canvas.getActiveObjects()) {
      const id = elementIdOf(object)
      if (id) ids.add(id)
    }
    this.handlers.onSelection([...ids])
  }

  private onModified = () => {
    this.flush()
  }

  private onEditingEntered = (event: { target?: FabricObject }) => {
    this.editing = event.target ?? null
    this.before ??= this.readAll()
  }

  private onEditingExited = () => {
    this.editing = null
    this.flush()
  }

  private onPointerDown = (event: TPointerEventInfo<TPointerEvent>) => {
    const native = event.e as MouseEvent
    const wantsPan =
      this.tool === "pan" || native.altKey || (native.button !== undefined && native.button === 1)

    if (wantsPan) {
      this.before = null
      this.pan = {
        start: new Point(native.clientX, native.clientY),
        transform: [...this.canvas.viewportTransform],
      }
      // Keep Fabric from starting a selection or transform underneath the pan.
      this.canvas.selection = false
      this.canvas.skipTargetFind = true
      this.canvas.setCursor("grabbing")
      return
    }

    if (this.tool === "eraser") {
      this.before ??= this.readAll()
      const target = this.owningObject(event.target)
      if (target) {
        this.dropObject(target)
        this.flush()
        this.canvas.requestRenderAll()
      }
      return
    }

    if (!SHAPE_TOOLS.has(this.tool) && this.tool !== "text" && this.tool !== "sticky-note") {
      if (this.tool === "select") {
        // Never clobber a snapshot captured when text editing began.
        this.before ??= this.readAll()
        if (!event.target) this.canvas.discardActiveObject()
      }
      return
    }

    this.before ??= this.readAll()
    const point = this.canvas.getScenePoint(event.e)

    if (this.tool === "text" || this.tool === "sticky-note") {
      this.createTextualElement(this.tool, point)
      return
    }

    if (this.tool === "freehand") {
      this.startFreehand(point)
      return
    }

    const element = this.shapeElement(this.tool as ElementType, point, point)
    this.draft = { object: createElementObject(element), element, anchor: point }
    this.draft.object.set({ selectable: false, evented: false })
    this.canvas.add(this.draft.object)
    this.canvas.requestRenderAll()
  }

  private onPointerMove = (event: TPointerEventInfo<TPointerEvent>) => {
    const native = event.e as MouseEvent

    if (this.pan) {
      this.canvas.setViewportTransform([
        this.pan.transform[0],
        0,
        0,
        this.pan.transform[3],
        this.pan.transform[4] + native.clientX - this.pan.start.x,
        this.pan.transform[5] + native.clientY - this.pan.start.y,
      ])
      this.afterViewport()
      return
    }

    if (this.freehand) {
      const point = this.canvas.getScenePoint(event.e)
      this.freehand.points.push(point)
      this.drawFreehand()
      return
    }

    if (this.draft) {
      const point = this.canvas.getScenePoint(event.e)
      const element = this.shapeElement(
        this.draft.element.type,
        this.draft.anchor,
        point,
        this.draft.element,
      )
      this.draft.element = element
      applyElementToObject(this.draft.object, element)
      this.canvas.requestRenderAll()
    }
  }

  private onPointerUp = () => {
    if (this.pan) {
      this.pan = null
      this.applyTool()
      this.canvas.setCursor(this.tool === "pan" ? "grab" : "default")
      return
    }

    if (this.freehand) {
      this.finishFreehand()
      return
    }

    if (this.draft) {
      const element = this.draft.element
      this.canvas.remove(this.draft.object)
      this.draft = null
      this.commit([...this.readAll(), element])
      this.handlers.onToolConsumed()
      this.selectElement(element.id)
      this.canvas.requestRenderAll()
      return
    }

    this.before = null
  }

  private onWheel = (event: TPointerEventInfo<WheelEvent>) => {
    event.e.preventDefault()
    event.e.stopPropagation()
    if (event.e.ctrlKey || event.e.metaKey) {
      const zoom = clamp(this.canvas.getZoom() * Math.exp(-event.e.deltaY * 0.002))
      this.canvas.zoomToPoint(this.canvas.getViewportPoint(event.e), zoom)
    } else {
      this.canvas.relativePan(new Point(-event.e.deltaX, -event.e.deltaY))
    }
    this.afterViewport()
  }

  // ---------------------------------------------------------------- creation

  private shapeElement(
    tool: ElementType,
    start: Point,
    end: Point,
    previous?: CanvasElement,
  ): CanvasElement {
    const x = Math.min(start.x, end.x)
    const y = Math.min(start.y, end.y)
    const width = Math.max(2, Math.abs(end.x - start.x))
    const height = Math.max(2, Math.abs(end.y - start.y))
    const base =
      previous ??
      ({
        id: uid("element"),
        type: tool,
        x,
        y,
        width,
        height,
        rotation: 0,
        style: this.defaultStyle(tool),
        createdBy: "local",
      } satisfies CanvasElement)

    return {
      ...base,
      x,
      y,
      width,
      height,
      text: undefined,
      points: undefined,
    }
  }

  private defaultStyle(tool: EditorTool): CanvasElement["style"] {
    if (tool === "sticky-note") {
      return {
        fill: "#fff0b8",
        stroke: "#e2ca76",
        strokeWidth: 1,
        opacity: 1,
      }
    }
    if (tool === "text") {
      return { fill: "#20201f", stroke: "transparent", strokeWidth: 0, opacity: 1 }
    }
    if (tool === "connector" || tool === "freehand") {
      return { fill: "transparent", stroke: "#20201f", strokeWidth: 2, opacity: 1 }
    }
    return { fill: "#eeedff", stroke: "#625df5", strokeWidth: 2, opacity: 1 }
  }

  private createTextualElement(tool: "text" | "sticky-note", point: Point) {
    const element: CanvasElement = {
      id: uid("element"),
      type: tool,
      x: point.x,
      y: point.y,
      width: tool === "text" ? 240 : 190,
      height: tool === "text" ? 36 : 130,
      rotation: 0,
      style: this.defaultStyle(tool),
      text: "",
      createdBy: "local",
    }

    this.commit([...this.readAll(), element])
    this.handlers.onToolConsumed()
    this.selectElement(element.id)
    const object = this.objects.get(element.id)
    if (!object) return
    const target =
      tool === "sticky-note"
        ? (object as unknown as { getObjects(): FabricObject[] }).getObjects()[1]
        : object
    if (target && "enterEditing" in target) {
      this.canvas.setActiveObject(target)
      ;(target as unknown as { enterEditing(): void }).enterEditing()
    }
  }

  private startFreehand(origin: Point) {
    const element: CanvasElement = {
      id: uid("element"),
      type: "freehand",
      x: origin.x,
      y: origin.y,
      width: 2,
      height: 2,
      rotation: 0,
      style: this.defaultStyle("freehand"),
      points: [0, 0],
      createdBy: "local",
    }
    const object = createElementObject(element)
    object.set({ selectable: false, evented: false })
    this.canvas.add(object)
    this.freehand = { object, element, origin, points: [origin] }
  }

  private drawFreehand() {
    const draft = this.freehand
    if (!draft) return
    const local = draft.points.map((point) => ({
      x: point.x - draft.origin.x,
      y: point.y - draft.origin.y,
    }))
    const xs = local.map((point) => point.x)
    const ys = local.map((point) => point.y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const maxX = Math.max(...xs)
    const maxY = Math.max(...ys)

    draft.object.set({ points: local })
    ;(draft.object as Polyline).setDimensions()
    draft.object.set({
      left: draft.origin.x + (minX + maxX) / 2,
      top: draft.origin.y + (minY + maxY) / 2,
    })
    draft.object.setCoords()

    draft.element = {
      ...draft.element,
      x: draft.origin.x + minX,
      y: draft.origin.y + minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
      rotation: 0,
      points: local.flatMap((point) => [point.x - minX, point.y - minY]),
    }
    this.canvas.requestRenderAll()
  }

  private finishFreehand() {
    const draft = this.freehand
    if (!draft) return
    this.canvas.remove(draft.object)
    this.freehand = null
    if ((draft.element.points?.length ?? 0) < 4) {
      this.before = null
      return
    }
    this.commit([...this.readAll(), draft.element])
    this.handlers.onToolConsumed()
    this.selectElement(draft.element.id)
    this.canvas.requestRenderAll()
  }

  private selectElement(id: string) {
    const object = this.objects.get(id)
    if (!object) return
    this.canvas.setActiveObject(object)
    this.syncSelection()
    this.canvas.requestRenderAll()
  }

  /** Escape: leave text editing first, otherwise clear the selection. */
  cancel() {
    const active = this.canvas.getActiveObject()
    if (this.isEditing(active)) {
      ;(active as unknown as { exitEditing(): void }).exitEditing()
      return
    }
    this.canvas.discardActiveObject()
    this.syncSelection()
    this.canvas.requestRenderAll()
  }
}
