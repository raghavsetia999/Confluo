import { afterEach, describe, expect, it, vi } from "vitest"
import * as Y from "yjs"
import type {
  CanvasChangeListener,
  CanvasElement,
} from "../types/canvas.ts"
import { CanvasBinding, LOCAL_ORIGIN } from "./CanvasBinding.ts"
import {
  createBoardDocument,
  deleteElement,
  isElementDeleted,
  migrateSliceADocument,
  projectElements,
  readElement,
  writeElement,
  type BoardDocument,
} from "./document.ts"

class FakeCanvasSource {
  private readonly listeners = new Set<CanvasChangeListener>()
  /** Last projected value per id, simulating the Fabric object store. */
  readonly projected = new Map<string, CanvasElement>()
  readonly applyCalls: string[] = []
  readonly removeCalls: string[] = []
  readonly deferred = new Set<string>()
  private readonly busy = new Set<string>()

  subscribeChanges(listener: CanvasChangeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  get listenerCount() {
    return this.listeners.size
  }

  applyRemoteElement(element: CanvasElement) {
    this.deferred.delete(element.id)
    this.projected.set(element.id, structuredClone(element))
    this.applyCalls.push(element.id)
  }

  removeRemoteElement(id: string) {
    this.deferred.delete(id)
    this.projected.delete(id)
    this.removeCalls.push(id)
  }

  isElementBusy(id: string) {
    return this.busy.has(id)
  }

  markRemoteDeferred(id: string) {
    this.deferred.add(id)
  }

  setBusy(id: string, value = true) {
    if (value) this.busy.add(id)
    else this.busy.delete(id)
  }

  clearCalls() {
    this.applyCalls.length = 0
    this.removeCalls.length = 0
  }

  emit(elements: CanvasElement[]) {
    for (const listener of [...this.listeners]) listener(elements, [])
  }
}

const element = (overrides: Partial<CanvasElement> = {}): CanvasElement => ({
  id: "element-1",
  type: "rectangle",
  x: 10,
  y: 20,
  width: 120,
  height: 80,
  rotation: 0,
  style: { fill: "#ffffff", stroke: "#20201f", strokeWidth: 1, opacity: 1 },
  createdBy: "user-1",
  ...overrides,
})

interface Harness {
  source: FakeCanvasSource
  document: BoardDocument
  binding: CanvasBinding
  transactions: Array<{ origin: unknown }>
  warnings: ReturnType<typeof vi.spyOn>
}

const harness = (elements: CanvasElement[] = []): Harness => {
  const document = createBoardDocument("board-b2")
  migrateSliceADocument(document, { elements })
  return harnessDocument(document)
}

const harnessDocument = (document: BoardDocument): Harness => {
  const source = new FakeCanvasSource()
  const binding = new CanvasBinding(source, document)
  const transactions: Array<{ origin: unknown }> = []
  document.doc.on("afterTransaction", (transaction) => {
    transactions.push({ origin: transaction.origin })
  })
  const warnings = vi.spyOn(console, "warn").mockImplementation(() => {})
  return { source, document, binding, transactions, warnings }
}

/** A peer document with the same board schema, seeded independently. */
const peerDocument = (elements: CanvasElement[] = []): BoardDocument => {
  const document = createBoardDocument("board-b3")
  migrateSliceADocument(document, { elements })
  return document
}

/** A second Y.Doc containing exactly the source document's current state. */
const cloneDocument = (source: BoardDocument): BoardDocument => {
  const doc = new Y.Doc()
  // Apply the source before `createBoardDocument` so the clone does not write
  // its own boardId at clock 0. That keeps later deltas starting at clock 0.
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(source.doc))
  return createBoardDocument("board-b3", doc)
}

const syncFrom = (from: BoardDocument, to: BoardDocument) => {
  Y.applyUpdate(to.doc, Y.encodeStateAsUpdate(from.doc))
}

const captureUpdates = (document: BoardDocument) => {
  const updates: Uint8Array[] = []
  const listener = (update: Uint8Array) => updates.push(update)
  document.doc.on("update", listener)
  return {
    updates,
    stop: () => document.doc.off("update", listener),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("CanvasBinding local writes", () => {
  it("inserts a locally created element with its existing id and fields", () => {
    const { source, document, transactions } = harness()
    const created = element({ id: "element_created-1", x: 7, y: 8 })

    source.emit([created])

    expect(readElement(document, created.id)).toStrictEqual(created)
    expect(projectElements(document).map((item) => item.id)).toEqual([
      created.id,
    ])
    expect(transactions).toHaveLength(1)
    expect(transactions[0].origin).toBe(LOCAL_ORIGIN)
  })

  it("updates committed geometry in one transaction", () => {
    const original = element({ id: "geometry" })
    const { source, document, transactions } = harness([original])
    const moved: CanvasElement = {
      ...original,
      x: 50,
      y: 60,
      width: 200,
      height: 90,
      rotation: 30,
    }

    source.emit([moved])

    expect(transactions).toHaveLength(1)
    expect(transactions[0].origin).toBe(LOCAL_ORIGIN)
    const map = document.elements.get(original.id)
    expect(map?.get("pos")).toStrictEqual({ x: 50, y: 60 })
    expect(map?.get("size")).toStrictEqual({ w: 200, h: 90 })
    expect(map?.get("rotation")).toBe(30)
    expect(readElement(document, original.id)).toStrictEqual(moved)
  })

  it("updates only the four documented style properties", () => {
    const original = element({ id: "styled" })
    const { source, document } = harness([original])
    const style = {
      fill: "#123456",
      stroke: "#abcdef",
      strokeWidth: 4,
      opacity: 0.5,
    }

    source.emit([{ ...original, style }])

    const map = document.elements.get(original.id)
    expect(map?.get("style")).toStrictEqual(style)
    expect(Object.keys(map?.get("style") as object).sort()).toEqual([
      "fill",
      "opacity",
      "stroke",
      "strokeWidth",
    ])
    expect(readElement(document, original.id)?.style).toStrictEqual(style)
  })

  it("updates text without recreating the element", () => {
    const note = element({ id: "note", type: "sticky-note", text: "" })
    const { source, document, transactions } = harness([note])

    source.emit([{ ...note, text: "hello collaborators" }])

    expect(transactions).toHaveLength(1)
    expect(readElement(document, "note")?.text).toBe("hello collaborators")
    expect(document.elements.size).toBe(1)
  })

  it("deletes elements that are absent from the committed snapshot", () => {
    const keep = element({ id: "keep" })
    const gone = element({ id: "gone", type: "ellipse" })
    const { source, document, transactions } = harness([keep, gone])

    source.emit([keep])

    expect(transactions).toHaveLength(1)
    expect(isElementDeleted(document, "gone")).toBe(true)
    expect(readElement(document, "gone")).toBeNull()
    expect(projectElements(document).map((item) => item.id)).toEqual(["keep"])
  })

  it("groups creation, update and deletion into a single transaction", () => {
    const keep = element({ id: "keep" })
    const gone = element({ id: "gone", type: "ellipse" })
    const created = element({ id: "created", type: "diamond" })
    const { source, document, transactions } = harness([keep, gone])

    source.emit([
      { ...keep, x: 300, rotation: 15 },
      created,
    ])

    expect(transactions).toHaveLength(1)
    expect(transactions[0].origin).toBe(LOCAL_ORIGIN)
    expect(projectElements(document).map((item) => item.id)).toEqual([
      "keep",
      "created",
    ])
    expect(isElementDeleted(document, "gone")).toBe(true)
  })

  it("notifies derived UI for remote projections but not local writes", () => {
    const remote = element({ id: "remote" })
    const left = peerDocument([remote])
    const right = peerDocument()
    const source = new FakeCanvasSource()
    const snapshots: CanvasElement[][] = []
    const binding = new CanvasBinding(source, right, {
      onRemoteProjection: (elements) => snapshots.push(elements),
    })

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toEqual([])

    source.emit([element({ id: "local" })])
    expect(snapshots).toHaveLength(1)

    syncFrom(left, right)
    expect(snapshots).toHaveLength(2)
    expect(snapshots[1].map((item) => item.id)).toEqual(["local", "remote"])
    binding.dispose()
  })

  it("is a no-op for an unchanged snapshot (pan/zoom emits no document write)", () => {
    const existing = element({ id: "still" })
    const { source, document, transactions } = harness([existing])

    source.emit([{ ...existing }])
    source.emit([{ ...existing }])

    expect(transactions).toHaveLength(0)
    expect(projectElements(document)).toStrictEqual([existing])
  })

  it("keeps ids and immutable fields stable", () => {
    const original = element({ id: "immutable" })
    const { source, document, transactions } = harness([original])

    source.emit([{ ...original, createdBy: "someone-else", x: 99 }])

    expect(transactions).toHaveLength(1)
    const stored = readElement(document, "immutable")
    expect(stored?.id).toBe("immutable")
    expect(stored?.createdBy).toBe("user-1")
    expect(stored?.x).toBe(99)
  })

  it("ignores a local type change and warns", () => {
    const original = element({ id: "typed", type: "rectangle" })
    const { source, document, transactions, warnings } = harness([original])

    source.emit([
      { ...original, type: "ellipse" } as unknown as CanvasElement,
    ])

    expect(transactions).toHaveLength(0)
    expect(readElement(document, "typed")?.type).toBe("rectangle")
    expect(warnings).toHaveBeenCalledWith(
      expect.stringContaining("Ignoring type change"),
    )
  })

  it("ignores invalid local elements without deleting the valid shared one", () => {
    const shared = element({ id: "shared" })
    const other = element({ id: "other" })
    const { source, document, warnings } = harness([shared, other])

    source.emit([
      { ...shared, width: -10 },
      { ...other, x: 40 },
    ] as unknown as CanvasElement[])

    expect(readElement(document, "shared")).toStrictEqual(shared)
    expect(isElementDeleted(document, "shared")).toBe(false)
    expect(readElement(document, "other")?.x).toBe(40)
    expect(warnings).toHaveBeenCalled()
  })
})

describe("CanvasBinding remote projection", () => {
  it("converges two independent documents and projects the incoming element", () => {
    const shared = element({ id: "peer", x: 12, y: 34 })
    const left = peerDocument([shared])
    const right = peerDocument()
    const { source } = harnessDocument(right)

    expect(source.projected.size).toBe(0)

    syncFrom(left, right)

    expect(projectElements(right)).toStrictEqual(projectElements(left))
    expect(source.projected.get("peer")).toStrictEqual(shared)
  })

  it("projects an already-populated document when the binding attaches", () => {
    const existing = element({ id: "existing" })
    const document = peerDocument([existing])

    const { source } = harnessDocument(document)

    expect(source.projected.get("existing")).toStrictEqual(existing)
  })

  it("updates only the affected object for a nested property change", () => {
    const first = element({ id: "first", x: 1 })
    const second = element({ id: "second", type: "ellipse", x: 2 })
    const left = peerDocument([first, second])
    const right = peerDocument()
    const { source } = harnessDocument(right)
    syncFrom(left, right)
    source.clearCalls()

    const captured = captureUpdates(left)
    writeElement(left, {
      ...first,
      x: 77,
      style: { ...first.style, fill: "#111111" },
    })

    expect(captured.updates).toHaveLength(1)
    Y.applyUpdate(right.doc, captured.updates[0])

    expect(source.applyCalls).toEqual(["first"])
    expect(source.projected.get("first")?.x).toBe(77)
    expect(source.projected.get("first")?.style.fill).toBe("#111111")
    expect(source.projected.get("second")).toStrictEqual(second)
    expect(projectElements(right)).toStrictEqual(projectElements(left))
  })

  it("creates an object when a root-map entry is added", () => {
    const left = peerDocument()
    const right = peerDocument()
    const { source } = harnessDocument(right)
    syncFrom(left, right)
    source.clearCalls()
    const created = element({ id: "created", type: "diamond", x: 50, y: 60 })
    const captured = captureUpdates(left)

    writeElement(left, created)
    expect(captured.updates).toHaveLength(1)
    Y.applyUpdate(right.doc, captured.updates[0])

    expect(source.applyCalls).toEqual(["created"])
    expect(source.projected.get("created")).toStrictEqual(created)
  })

  it("removes an object when the root-map entry is deleted, and suppresses stale writes", () => {
    const shared = element({ id: "removed" })
    const left = peerDocument([shared])
    const right = peerDocument()
    const { source, document } = harnessDocument(right)
    syncFrom(left, right)
    source.clearCalls()

    const captured = captureUpdates(left)
    left.doc.transact(() => left.elements.delete("removed"))
    expect(captured.updates).toHaveLength(1)
    Y.applyUpdate(right.doc, captured.updates[0])

    expect(source.removeCalls).toEqual(["removed"])
    expect(source.projected.has("removed")).toBe(false)
    expect(document.elements.has("removed")).toBe(false)

    const afterDelete = captureUpdates(right)
    source.emit([shared])

    expect(afterDelete.updates).toHaveLength(0)
    expect(source.projected.has("removed")).toBe(false)
    expect(source.removeCalls).toEqual(["removed"])
    expect(document.elements.has("removed")).toBe(false)
  })

  it("treats a tombstone as a deletion and suppresses stale writes", () => {
    const shared = element({ id: "tombstoned" })
    const left = peerDocument([shared])
    const right = peerDocument()
    const { source } = harnessDocument(right)
    syncFrom(left, right)
    source.clearCalls()

    const captured = captureUpdates(left)
    deleteElement(left, "tombstoned")
    Y.applyUpdate(right.doc, captured.updates[0])

    expect(source.removeCalls).toEqual(["tombstoned"])
    expect(isElementDeleted(right, "tombstoned")).toBe(true)

    const afterDelete = captureUpdates(right)
    source.emit([shared])

    expect(afterDelete.updates).toHaveLength(0)
    expect(readElement(right, "tombstoned")).toBeNull()
    expect(source.projected.has("tombstoned")).toBe(false)
  })

  it("is idempotent when the same update is delivered twice", () => {
    const left = peerDocument([element({ id: "duplicate" })])
    const right = peerDocument()
    const { source, document } = harnessDocument(right)
    const captured = captureUpdates(right)
    const update = Y.encodeStateAsUpdate(left.doc)

    Y.applyUpdate(right.doc, update)
    expect(source.applyCalls).toEqual(["duplicate"])
    expect(captured.updates).toHaveLength(1)

    source.clearCalls()
    captured.updates.length = 0
    Y.applyUpdate(right.doc, update)

    expect(source.applyCalls).toEqual([])
    expect(captured.updates).toHaveLength(0)
    expect(projectElements(right)).toStrictEqual(projectElements(left))
    expect(document.elements.get("duplicate")).toBeDefined()
  })

  it("converges when updates are delivered out of order", () => {
    const left = peerDocument()
    const right = peerDocument()
    const { source } = harnessDocument(right)
    syncFrom(left, right)
    source.clearCalls()
    const captured = captureUpdates(left)
    const created = element({ id: "ordered", x: 1, y: 2 })

    writeElement(left, created)
    writeElement(left, { ...created, x: 42, rotation: 15 })
    expect(captured.updates).toHaveLength(2)

    // The property update is based on the created element. Applying it first
    // must still leave a valid final state once the create arrives.
    Y.applyUpdate(right.doc, captured.updates[1])
    Y.applyUpdate(right.doc, captured.updates[0])

    expect(projectElements(right)).toStrictEqual(projectElements(left))
    expect(source.projected.get("ordered")?.x).toBe(42)
    expect(source.projected.get("ordered")?.rotation).toBe(15)
  })

  it("converges concurrent edits to different elements", () => {
    const first = element({ id: "concurrent-first", x: 1, y: 2 })
    const second = element({
      id: "concurrent-second",
      type: "ellipse",
      x: 3,
      y: 4,
    })
    const base = peerDocument([first, second])
    const left = cloneDocument(base)
    const right = cloneDocument(base)
    const leftUpdates = captureUpdates(left)
    const rightUpdates = captureUpdates(right)

    writeElement(left, { ...first, x: 101 })
    writeElement(right, { ...second, y: 202 })
    expect(leftUpdates.updates).toHaveLength(1)
    expect(rightUpdates.updates).toHaveLength(1)

    Y.applyUpdate(right.doc, leftUpdates.updates[0])
    Y.applyUpdate(left.doc, rightUpdates.updates[0])

    expect(projectElements(left)).toStrictEqual(projectElements(right))
    expect(readElement(left, "concurrent-first")?.x).toBe(101)
    expect(readElement(right, "concurrent-first")?.x).toBe(101)
    expect(readElement(left, "concurrent-second")?.y).toBe(202)
    expect(readElement(right, "concurrent-second")?.y).toBe(202)

    // A third peer receiving both updates should project both, independently.
    const target = cloneDocument(base)
    const { source } = harnessDocument(target)
    source.clearCalls()
    Y.applyUpdate(target.doc, leftUpdates.updates[0])
    Y.applyUpdate(target.doc, rightUpdates.updates[0])

    expect(source.applyCalls).toEqual(["concurrent-first", "concurrent-second"])
    expect(source.projected.get("concurrent-first")?.x).toBe(101)
    expect(source.projected.get("concurrent-second")?.y).toBe(202)
  })

  it("converges same-property writes to one deterministic winner", () => {
    const shared = element({ id: "same-field", x: 10, y: 20 })
    const base = peerDocument([shared])
    const left = cloneDocument(base)
    const right = cloneDocument(base)
    const leftUpdates = captureUpdates(left)
    const rightUpdates = captureUpdates(right)

    writeElement(left, { ...shared, x: 111 })
    writeElement(right, { ...shared, x: 222 })
    Y.applyUpdate(right.doc, leftUpdates.updates[0])
    Y.applyUpdate(left.doc, rightUpdates.updates[0])

    const leftX = readElement(left, "same-field")?.x
    const rightX = readElement(right, "same-field")?.x
    expect(leftX).toBe(rightX)
    expect([111, 222]).toContain(leftX)

    // Delivery order must not change the winner: replay both updates in the
    // opposite order onto fresh peers seeded from the same base.
    const forward = cloneDocument(base)
    const reverse = cloneDocument(base)
    Y.applyUpdate(forward.doc, leftUpdates.updates[0])
    Y.applyUpdate(forward.doc, rightUpdates.updates[0])
    Y.applyUpdate(reverse.doc, rightUpdates.updates[0])
    Y.applyUpdate(reverse.doc, leftUpdates.updates[0])

    expect(readElement(forward, "same-field")?.x).toBe(leftX)
    expect(readElement(reverse, "same-field")?.x).toBe(leftX)
  })

  it("converges delete-versus-update as a hidden tombstone with both writes retained", () => {
    const shared = element({ id: "delete-update", x: 10, y: 20 })
    const base = peerDocument([shared])
    const left = cloneDocument(base)
    const right = cloneDocument(base)
    const leftUpdates = captureUpdates(left)
    const rightUpdates = captureUpdates(right)

    deleteElement(left, "delete-update")
    writeElement(right, { ...shared, x: 222 })

    Y.applyUpdate(right.doc, leftUpdates.updates[0])
    Y.applyUpdate(left.doc, rightUpdates.updates[0])

    expect(isElementDeleted(left, "delete-update")).toBe(true)
    expect(isElementDeleted(right, "delete-update")).toBe(true)
    expect(projectElements(left)).toEqual([])
    expect(projectElements(right)).toEqual([])
    const stored = left.elements.get("delete-update") as Y.Map<unknown>
    expect(stored.get("pos")).toStrictEqual({ x: 222, y: 20 })

    const forward = cloneDocument(base)
    const reverse = cloneDocument(base)
    Y.applyUpdate(forward.doc, leftUpdates.updates[0])
    Y.applyUpdate(forward.doc, rightUpdates.updates[0])
    Y.applyUpdate(reverse.doc, rightUpdates.updates[0])
    Y.applyUpdate(reverse.doc, leftUpdates.updates[0])
    expect(isElementDeleted(forward, "delete-update")).toBe(true)
    expect(isElementDeleted(reverse, "delete-update")).toBe(true)
  })

  it("ignores a remote field update that arrives after a delete", () => {
    const shared = element({ id: "late-update", x: 10, y: 20 })
    const base = peerDocument([shared])
    const updater = cloneDocument(base)
    const deleter = cloneDocument(base)
    const target = cloneDocument(base)
    const { source } = harnessDocument(target)
    source.clearCalls()

    const update = captureUpdates(updater)
    const deletion = captureUpdates(deleter)
    writeElement(updater, { ...shared, x: 99 })
    deleteElement(deleter, "late-update")
    expect(update.updates).toHaveLength(1)
    expect(deletion.updates).toHaveLength(1)

    // Deliver the tombstone first, then the earlier field update.
    Y.applyUpdate(target.doc, deletion.updates[0])
    expect(source.projected.has("late-update")).toBe(false)
    Y.applyUpdate(target.doc, update.updates[0])

    expect(isElementDeleted(target, "late-update")).toBe(true)
    expect(readElement(target, "late-update")).toBeNull()
    expect(source.projected.has("late-update")).toBe(false)
    expect(projectElements(target)).toEqual([])
  })

  it("does not loop remote projection back into local Yjs writes", () => {
    const left = peerDocument([element({ id: "loop-check" })])
    const right = peerDocument()
    const { source, transactions } = harnessDocument(right)
    const captured = captureUpdates(right)

    syncFrom(left, right)

    expect(source.applyCalls).toEqual(["loop-check"])
    expect(captured.updates).toHaveLength(1)
    expect(transactions.map((entry) => entry.origin)).toEqual([null])
    expect(
      transactions.some((entry) => entry.origin === LOCAL_ORIGIN),
    ).toBe(false)
  })

  it("defers a remote text edit while the element is being edited locally", () => {
    const note = element({
      id: "note",
      type: "sticky-note",
      text: "initial",
    })
    const left = peerDocument([note])
    const right = peerDocument()
    const { source } = harnessDocument(right)
    syncFrom(left, right)
    source.clearCalls()
    source.setBusy("note")

    const remote = captureUpdates(left)
    writeElement(left, { ...note, text: "remote edit" })
    Y.applyUpdate(right.doc, remote.updates[0])

    expect(source.applyCalls).toEqual([])
    expect(source.projected.get("note")?.text).toBe("initial")
    expect(source.deferred.has("note")).toBe(true)

    const local = { ...note, text: "local wins" }
    const localUpdates = captureUpdates(right)
    source.emit([local])

    expect(localUpdates.updates).toHaveLength(1)
    expect(readElement(right, "note")?.text).toBe("local wins")
    // Still busy at this point: the deferred remote id remains deferred.
    expect(source.applyCalls).toEqual([])

    source.setBusy("note", false)
    localUpdates.updates.length = 0
    source.emit([local])

    expect(localUpdates.updates).toHaveLength(0)
    expect(source.applyCalls).toEqual(["note"])
    expect(source.projected.get("note")?.text).toBe("local wins")
    expect(readElement(right, "note")?.text).toBe("local wins")
    expect(source.deferred.has("note")).toBe(false)
  })

  it("applies a deferred remote delete after a local edit ends", () => {
    const note = element({
      id: "note-delete",
      type: "sticky-note",
      text: "editing",
    })
    const left = peerDocument([note])
    const right = peerDocument()
    const { source, document } = harnessDocument(right)
    syncFrom(left, right)
    source.clearCalls()
    source.setBusy("note-delete")

    const remote = captureUpdates(left)
    left.doc.transact(() => left.elements.delete("note-delete"))
    Y.applyUpdate(right.doc, remote.updates[0])

    expect(source.removeCalls).toEqual([])
    expect(source.projected.has("note-delete")).toBe(true)
    expect(source.deferred.has("note-delete")).toBe(true)

    source.emit([note])
    expect(source.removeCalls).toEqual([])
    expect(source.projected.has("note-delete")).toBe(true)
    expect(source.deferred.has("note-delete")).toBe(true)

    source.setBusy("note-delete", false)
    source.emit([note])

    expect(source.removeCalls).toEqual(["note-delete"])
    expect(source.projected.has("note-delete")).toBe(false)
    expect(source.deferred.has("note-delete")).toBe(false)
    expect(document.elements.has("note-delete")).toBe(false)
  })
})

describe("CanvasBinding lifecycle", () => {
  it("subscribes once and unsubscribes on dispose", () => {
    const { source, binding } = harness()
    expect(source.listenerCount).toBe(1)

    binding.dispose()
    expect(source.listenerCount).toBe(0)

    binding.dispose()
    expect(source.listenerCount).toBe(0)
  })

  it("has no effect on the document after dispose", () => {
    const { source, document, binding, transactions } = harness()

    binding.dispose()
    source.emit([element({ id: "after-dispose" })])
    binding.applyLocal([element({ id: "after-dispose" })])

    expect(transactions).toHaveLength(0)
    expect(projectElements(document)).toEqual([])
  })

  it("stops projecting remote changes after dispose", () => {
    const { source, document, binding } = harness()
    binding.dispose()
    source.clearCalls()

    writeElement(document, element({ id: "after-dispose-remote" }))

    expect(source.applyCalls).toEqual([])
    expect(source.projected.has("after-dispose-remote")).toBe(false)
  })

  it("replaces cleanly on remount without duplicate deep observers", () => {
    const first = harness()
    first.binding.dispose()

    const second = new CanvasBinding(first.source, first.document)
    first.source.clearCalls()
    writeElement(first.document, element({ id: "observed-once" }))

    expect(first.source.applyCalls).toEqual(["observed-once"])
    second.dispose()
    expect(first.source.listenerCount).toBe(0)
  })

  it("replaces cleanly on remount without duplicate subscriptions", () => {
    const first = harness()
    first.binding.dispose()

    const second = new CanvasBinding(first.source, first.document)
    expect(first.source.listenerCount).toBe(1)

    first.source.emit([element({ id: "remounted" })])

    expect(projectElements(first.document).map((item) => item.id)).toEqual([
      "remounted",
    ])
    second.dispose()
    expect(first.source.listenerCount).toBe(0)
  })
})
