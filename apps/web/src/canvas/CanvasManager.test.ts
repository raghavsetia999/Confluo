import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CanvasElement } from "../types/canvas.ts"
import { CanvasManager } from "./CanvasManager.ts"

const codec = vi.hoisted(() => {
  class FakeObject {
    id: string
    element: Record<string, unknown>
    selectable = true
    evented = true
    group?: FakeObject
    isEditing = false

    constructor(element: Record<string, unknown>) {
      this.element = element
      this.id = String(element.id)
    }
  }

  const registry = new WeakMap<object, Record<string, unknown>>()

  return {
    FakeObject,
    createElementObject(element: Record<string, unknown>) {
      const object = new FakeObject(element)
      registry.set(object, {
        id: element.id,
        type: element.type,
        createdBy: element.createdBy,
        width: element.width,
        height: element.height,
      })
      return object
    },
    applyElementToObject(
      object: FakeObject,
      element: Record<string, unknown>,
    ) {
      object.element = element
      object.id = String(element.id)
      registry.set(object, {
        id: element.id,
        type: element.type,
        createdBy: element.createdBy,
        width: element.width,
        height: element.height,
      })
    },
    elementIdOf(object?: { id?: string } | null) {
      return object ? (registry.get(object)?.id as string | undefined) : undefined
    },
    metaOf(object: object) {
      return registry.get(object)
    },
    readElement(object: FakeObject) {
      return object.element
    },
  }
})

vi.mock("./elementObjects.ts", () => codec)

const fabric = vi.hoisted(() => {
  class FakePoint {
    x: number
    y: number

    constructor(x = 0, y = 0) {
      this.x = x
      this.y = y
    }
  }

  class FakeCanvas {
    static instances: FakeCanvas[] = []
    viewportTransform = [1, 0, 0, 1, 0, 0]
    wrapperEl = { remove: () => {} }
    lowerCanvasEl = { remove: () => {} }
    selection = true
    skipTargetFind = false
    defaultCursor = ""
    hoverCursor = ""
    objects: Array<Record<string, unknown>> = []
    readonly added: Array<Record<string, unknown>> = []
    readonly removed: Array<Record<string, unknown>> = []
    activeObjects: Array<Record<string, unknown>> = []
    readonly offCalls: Array<[string, unknown]> = []
    private readonly handlers = new Map<string, Set<(event?: unknown) => void>>()

    constructor(_element: unknown, _options: unknown) {
      FakeCanvas.instances.push(this)
    }

    on(event: string, handler: (event?: unknown) => void) {
      const handlers = this.handlers.get(event) ?? new Set()
      handlers.add(handler)
      this.handlers.set(event, handlers)
    }

    off(event: string, handler?: (event?: unknown) => void) {
      this.offCalls.push([event, handler])
      if (handler) this.handlers.get(event)?.delete(handler)
      else this.handlers.delete(event)
    }

    trigger(event: string, payload?: unknown) {
      for (const handler of [...(this.handlers.get(event) ?? [])]) {
        handler(payload)
      }
    }

    requestRenderAll() {}
    setDimensions() {}
    setViewportTransform(transform: number[]) {
      this.viewportTransform = transform
    }
    getZoom() {
      return this.viewportTransform[0]
    }
    zoomToPoint(_point: FakePoint, zoom: number) {
      this.viewportTransform = [
        zoom,
        0,
        0,
        zoom,
        this.viewportTransform[4],
        this.viewportTransform[5],
      ]
    }
    relativePan() {}
    getWidth() {
      return 800
    }
    getHeight() {
      return 600
    }
    getScenePoint() {
      return new FakePoint()
    }
    getViewportPoint() {
      return new FakePoint()
    }
    getActiveObjects() {
      return this.activeObjects
    }
    getActiveObject() {
      return this.activeObjects[0]
    }
    discardActiveObject() {
      this.activeObjects = []
    }
    setActiveObject(object: Record<string, unknown>) {
      this.activeObjects = [object]
    }
    add(object: Record<string, unknown>) {
      this.added.push(object)
      this.objects.push(object)
    }
    remove(object: Record<string, unknown>) {
      this.removed.push(object)
      this.objects = this.objects.filter((candidate) => candidate !== object)
      this.activeObjects = this.activeObjects.filter(
        (candidate) => candidate !== object,
      )
    }
    setCursor() {}
    dispose() {}
  }

  const Stub = class {}
  return { FakeCanvas, FakePoint, Stub }
})

vi.mock("fabric", () => ({
  Canvas: fabric.FakeCanvas,
  Point: fabric.FakePoint,
  Polyline: fabric.Stub,
  Ellipse: fabric.Stub,
  Group: fabric.Stub,
  Polygon: fabric.Stub,
  Rect: fabric.Stub,
  Textbox: fabric.Stub,
}))

const FABRIC_EVENTS = [
  "mouse:down",
  "mouse:move",
  "mouse:up",
  "mouse:wheel",
  "object:modified",
  "before:transform",
  "text:editing:entered",
  "text:editing:exited",
  "selection:created",
  "selection:updated",
  "selection:cleared",
]

const setup = () => {
  const host = {
    appendChild: vi.fn(),
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
    style: {},
  } as unknown as HTMLElement
  const handlers = {
    onChange: vi.fn(),
    onSelection: vi.fn(),
    onViewport: vi.fn(),
    onToolConsumed: vi.fn(),
  }
  const manager = new CanvasManager(host, handlers)
  const canvas = fabric.FakeCanvas.instances.at(-1)!
  return { manager, canvas, handlers }
}

const remoteElement = (
  overrides: Partial<CanvasElement> = {},
): CanvasElement => ({
  id: "remote-1",
  type: "rectangle",
  x: 100,
  y: 200,
  width: 120,
  height: 80,
  rotation: 0,
  style: { fill: "#ffffff", stroke: "#20201f", strokeWidth: 1, opacity: 1 },
  createdBy: "peer",
  ...overrides,
})

beforeEach(() => {
  fabric.FakeCanvas.instances.length = 0
  vi.stubGlobal("document", {
    createElement: () => ({ remove: vi.fn() }),
  })
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("CanvasManager change feed", () => {
  it("emits committed document changes to subscribers", () => {
    const { manager, canvas, handlers } = setup()
    const listener = vi.fn()
    manager.subscribeChanges(listener)

    canvas.trigger("object:modified")

    expect(handlers.onChange).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0]).toEqual([])
  })

  it("stops notifying after unsubscribe", () => {
    const { manager, canvas, handlers } = setup()
    const listener = vi.fn()
    const unsubscribe = manager.subscribeChanges(listener)
    unsubscribe()

    canvas.trigger("object:modified")

    expect(handlers.onChange).toHaveBeenCalledTimes(1)
    expect(listener).not.toHaveBeenCalled()
  })

  it("never emits for viewport-only changes", () => {
    const { manager, canvas, handlers } = setup()
    const listener = vi.fn()
    manager.subscribeChanges(listener)

    manager.setZoom(2)
    manager.resetZoom()
    manager.fitToContent()
    canvas.trigger("mouse:wheel", {
      e: {
        preventDefault() {},
        stopPropagation() {},
        ctrlKey: false,
        metaKey: false,
        deltaX: 0,
        deltaY: 20,
      },
    })

    expect(handlers.onViewport).toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
  })

  it("reports text editing while the editing object is tracked", () => {
    const { manager, canvas } = setup()
    expect(manager.isEditing()).toBe(false)

    canvas.trigger("text:editing:entered", { target: { isEditing: true } })
    expect(manager.isEditing()).toBe(true)

    canvas.trigger("text:editing:exited")
    expect(manager.isEditing()).toBe(false)
  })

  it("forces a commit at text-editor exit when remote data was deferred", () => {
    const { manager, canvas } = setup()
    const element = remoteElement({
      id: "note",
      type: "sticky-note",
      text: "local",
    })
    manager.applyRemoteElement(element)
    const object = canvas.objects[0] as { element: CanvasElement }

    // Establish a last-emitted snapshot equal to the current canvas state.
    canvas.trigger("object:modified")
    const listener = vi.fn()
    manager.subscribeChanges(listener)

    canvas.trigger("text:editing:entered", { target: object })
    manager.markRemoteDeferred("note")
    canvas.trigger("text:editing:exited")

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0][0].text).toBe("local")
  })

  it("does not re-emit an unchanged text-editor exit without a deferred remote", () => {
    const { manager, canvas } = setup()
    const element = remoteElement({
      id: "note",
      type: "sticky-note",
      text: "local",
    })
    manager.applyRemoteElement(element)
    const object = canvas.objects[0] as { element: CanvasElement }

    canvas.trigger("object:modified")
    const listener = vi.fn()
    manager.subscribeChanges(listener)

    canvas.trigger("text:editing:entered", { target: object })
    canvas.trigger("text:editing:exited")

    expect(listener).not.toHaveBeenCalled()
  })

  it("unregisters every Fabric event and clears listeners on destroy", () => {
    const { manager, canvas, handlers } = setup()
    const listener = vi.fn()
    manager.subscribeChanges(listener)

    manager.destroy()

    const unregistered = canvas.offCalls.map(([event]) => event)
    for (const event of FABRIC_EVENTS) {
      expect(unregistered).toContain(event)
    }

    canvas.trigger("object:modified")
    expect(listener).not.toHaveBeenCalled()
    expect(handlers.onChange).not.toHaveBeenCalled()
  })
})

describe("CanvasManager remote projection", () => {
  it("creates, updates and removes one object without emitting local changes", () => {
    const { manager, canvas, handlers } = setup()
    const created = remoteElement({
      id: "remote-note",
      type: "sticky-note",
      x: 120,
      y: 80,
      width: 190,
      height: 150,
      rotation: -2,
      text: "remote note",
    })

    manager.applyRemoteElement(created)

    expect(canvas.added).toHaveLength(1)
    expect(canvas.objects).toHaveLength(1)
    const object = canvas.objects[0] as { id: string; element: CanvasElement }
    expect(object.id).toBe("remote-note")
    expect(object.element).toStrictEqual(created)
    expect(object.element.x).toBe(120)
    expect(object.element.y).toBe(80)
    expect(object.element.style.fill).toBe(created.style.fill)
    expect(object.element.text).toBe("remote note")
    expect(handlers.onChange).not.toHaveBeenCalled()

    const moved = { ...created, x: 300, y: 400 }
    canvas.setActiveObject(object)
    manager.applyRemoteElement(moved)

    expect(canvas.added).toHaveLength(1)
    expect(object.element).toStrictEqual(moved)
    expect(object.id).toBe(created.id)
    expect(canvas.getActiveObjects()).toEqual([object])

    manager.removeRemoteElement(created.id)

    expect(canvas.removed).toContain(object)
    expect(canvas.objects).toHaveLength(0)
    expect(handlers.onChange).not.toHaveBeenCalled()
  })

  it("keeps element coordinates and viewport unchanged when projecting remotely", () => {
    const { manager, canvas } = setup()
    const element = remoteElement({ x: 42, y: 84 })

    manager.setZoom(2)
    const transformBefore = [...canvas.viewportTransform]
    const viewportBefore = manager.getViewport()
    manager.applyRemoteElement(element)

    const object = canvas.objects[0] as { element: CanvasElement }
    expect(object.element.x).toBe(42)
    expect(object.element.y).toBe(84)
    expect(canvas.getZoom()).toBe(2)
    expect(canvas.viewportTransform).toStrictEqual(transformBefore)
    expect(manager.getViewport()).toStrictEqual(viewportBefore)

    manager.applyRemoteElement({ ...element, x: 50, y: 90, rotation: 15 })

    expect(canvas.objects).toHaveLength(1)
    expect(canvas.objects[0]).toBe(object)
    expect(object.element.x).toBe(50)
    expect(object.element.y).toBe(90)
    expect(canvas.viewportTransform).toStrictEqual(transformBefore)
    expect(manager.getViewport()).toStrictEqual(viewportBefore)
  })

  it("does not touch an element while its text editor is active", () => {
    const { manager, canvas } = setup()
    const note = remoteElement({
      id: "note",
      type: "sticky-note",
      text: "initial",
    })
    manager.applyRemoteElement(note)
    const object = canvas.objects[0] as { element: CanvasElement }

    canvas.trigger("text:editing:entered", { target: object })
    expect(manager.isElementBusy("note")).toBe(true)

    manager.applyRemoteElement({ ...note, text: "remote" })
    manager.removeRemoteElement("note")

    expect(object.element.text).toBe("initial")
    expect(canvas.objects).toContain(object)

    canvas.trigger("text:editing:exited")
    expect(manager.isElementBusy("note")).toBe(false)

    manager.applyRemoteElement({ ...note, text: "remote" })
    expect(object.element.text).toBe("remote")
  })

  it("tracks an active transform and clears it on the committed modify", () => {
    const { manager, canvas } = setup()
    const element = remoteElement()
    manager.applyRemoteElement(element)
    const object = canvas.objects[0] as { element: CanvasElement }

    canvas.trigger("before:transform", { transform: { target: object } })
    expect(manager.isElementBusy(element.id)).toBe(true)

    manager.removeRemoteElement(element.id)
    expect(canvas.objects).toContain(object)

    canvas.trigger("object:modified")
    expect(manager.isElementBusy(element.id)).toBe(false)

    manager.removeRemoteElement(element.id)
    expect(canvas.objects).toHaveLength(0)
  })

  it("forces a transform commit when remote data was deferred", () => {
    const { manager, canvas } = setup()
    const element = remoteElement()
    manager.applyRemoteElement(element)
    const object = canvas.objects[0] as { element: CanvasElement }

    canvas.trigger("object:modified")
    const listener = vi.fn()
    manager.subscribeChanges(listener)

    canvas.trigger("before:transform", { transform: { target: object } })
    manager.markRemoteDeferred(element.id)
    canvas.trigger("object:modified")

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0][0].id).toBe(element.id)
  })

  it("clears the selection when a selected object is deleted remotely", () => {
    const { manager, canvas, handlers } = setup()
    const element = remoteElement()
    manager.applyRemoteElement(element)
    const object = canvas.objects[0] as Record<string, unknown>

    canvas.setActiveObject(object)
    manager.removeRemoteElement(element.id)

    expect(canvas.getActiveObjects()).toEqual([])
    expect(handlers.onSelection).toHaveBeenCalledWith([])
  })
})
