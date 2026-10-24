import WebSocket from 'ws'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { createBoardDocument, projectElements } from '../../web/src/collab/document.ts'

const browserInfo = await (await fetch('http://localhost:9222/json/version')).json()
const browser = new WebSocket(browserInfo.webSocketDebuggerUrl)
await new Promise<void>((resolve, reject) => { browser.once('open', () => resolve()); browser.once('error', reject) })
let nextId = 1
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
const events: any[] = []
browser.on('message', (data) => {
  const msg = JSON.parse(data.toString())
  if (msg.id) {
    const p = pending.get(msg.id)
    if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result) }
  } else events.push(msg)
})
const send = (method: string, params: any = {}, sessionId?: string) => new Promise<any>((resolve, reject) => {
  const id = nextId++
  pending.set(id, { resolve, reject })
  browser.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
})
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const waitFor = async (predicate: () => boolean | Promise<boolean>, message: string, timeoutMs = 7000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await sleep(50)
  }
  throw new Error(`Timed out: ${message}`)
}

class Page {
  session!: string
  targetId!: string
  errors: string[] = []
  constructor(public contextId: string) {}
  async open() {
    const target = await send('Target.createTarget', { url: 'http://localhost:5173/board/demo', browserContextId: this.contextId })
    this.targetId = target.targetId
    this.session = (await send('Target.attachToTarget', { targetId: this.targetId, flatten: true })).sessionId
    await send('Runtime.enable', {}, this.session)
    await send('Page.enable', {}, this.session)
    for (const event of events) {
      if (event.sessionId === this.session && event.method === 'Runtime.exceptionThrown') this.errors.push(event.params.exceptionDetails?.text ?? 'exception')
    }
    await waitFor(async () => (await this.eval<string>('document.querySelector(".connection-status")?.innerText ?? ""')).includes('Live · server sync'), 'page sync')
    const errors = await this.eval<string[]>(`[...document.querySelectorAll('.connection-status')].map(x=>x.innerText)`)
    console.log('page ready', errors)
  }
  async eval<T>(expression: string): Promise<T> {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, this.session)
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result?.value as T
  }
  async click(selector: string) { await this.eval(`document.querySelector(${JSON.stringify(selector)}).click()`) }
  async mouse(type: string, x: number, y: number, extra: any = {}) {
    await send('Input.dispatchMouseEvent', { type, x, y, ...extra }, this.session)
  }
  async drag(x1: number, y1: number, x2: number, y2: number) {
    await this.mouse('mousePressed', x1, y1, { button: 'left', buttons: 1, clickCount: 1 })
    for (let i = 1; i <= 5; i++) {
      await this.mouse('mouseMoved', x1 + (x2 - x1) * i / 5, y1 + (y2 - y1) * i / 5, { button: 'left', buttons: 1 })
      await sleep(20)
    }
    await this.mouse('mouseReleased', x2, y2, { button: 'left', buttons: 0, clickCount: 1 })
  }
  async hash(): Promise<string> {
    return this.eval<string>(`(() => [...document.querySelectorAll('.canvas-host canvas')].map((c) => { const d = c.toDataURL(); let h = 2166136261; for (let i = 0; i < d.length; i += 89) h = Math.imul(h ^ d.charCodeAt(i), 16777619); return (h >>> 0).toString(16) }).join(':'))()`)
  }
  async regionHash(x: number, y: number, width: number, height: number): Promise<string> {
    return this.eval<string>(`(() => { const c = document.querySelectorAll('.canvas-host canvas')[0]; const d = c.getContext('2d').getImageData(${x}, ${y}, ${width}, ${height}).data; let h = 2166136261; for (let i = 0; i < d.length; i += 7) h = Math.imul(h ^ d[i], 16777619); return (h >>> 0).toString(16) })()`)
  }
  async reload() {
    const before = await this.eval<number>('performance.timeOrigin')
    await send('Page.reload', {}, this.session)
    await waitFor(async () => {
      const after = await this.eval<number>('performance.timeOrigin').catch(() => before)
      if (after === before) return false
      const status = await this.eval<string>('document.querySelector(".connection-status")?.innerText ?? ""').catch(() => '')
      return status.includes('Live · server sync')
    }, 'page reload and resync', 10_000)
  }
  async close() {
    await send('Target.closeTarget', { targetId: this.targetId }).catch(() => undefined)
  }
}

const contextA = (await send('Target.createBrowserContext')).browserContextId
const contextB = (await send('Target.createBrowserContext')).browserContextId
const a = new Page(contextA)
const b = new Page(contextB)
await a.open()
await b.open()

const observerDoc = new Y.Doc()
let observerSynced = false
const observer = new HocuspocusProvider({
  url: 'ws://localhost:4001',
  name: 'confluo.board.demo',
  document: observerDoc,
  onSynced: ({ state }) => { if (state) observerSynced = true },
  onAuthenticationFailed: ({ reason }) => { throw new Error(reason) },
})
await waitFor(() => observerSynced, 'observer sync')
const document = createBoardDocument('demo', observerDoc)
const elements = () => projectElements(document)
console.log('initial elements', elements().length)

const beforeCreate = await b.hash()
await a.click('[aria-label="Rectangle"]')
await a.drag(450, 520, 630, 650)
await waitFor(() => elements().some((e) => e.type === 'rectangle' && Math.abs(e.x - 450) < 3 && Math.abs(e.y - 520) < 3), 'rectangle in shared document')
await waitFor(async () => (await b.hash()) !== beforeCreate, 'rectangle visible in second browser')
console.log('create propagated')

const beforeMove = await b.hash()
await a.click('[aria-label="Select"]')
await a.drag(540, 585, 760, 585)
await waitFor(() => elements().some((e) => e.type === 'rectangle' && e.x > 620), 'rectangle move in shared document')
await waitFor(async () => (await b.hash()) !== beforeMove, 'move visible in second browser')
console.log('move propagated')

const beforeSticky = await b.hash()
await a.click('[aria-label="Sticky note"]')
await a.mouse('mousePressed', 980, 560, { button: 'left', buttons: 1, clickCount: 1 })
await a.mouse('mouseReleased', 980, 560, { button: 'left', buttons: 0, clickCount: 1 })
await sleep(150)
await a.eval(`document.querySelector('textarea')?.focus()`)
await send('Input.insertText', { text: 'hello collab' }, a.session)
await a.mouse('mousePressed', 300, 400, { button: 'left', buttons: 1, clickCount: 1 })
await a.mouse('mouseReleased', 300, 400, { button: 'left', buttons: 0, clickCount: 1 })
await waitFor(() => elements().some((e) => e.type === 'sticky-note' && e.text === 'hello collab'), 'sticky text in shared document', 10000)
await waitFor(async () => (await b.hash()) !== beforeSticky, 'sticky visible in second browser')
console.log('text create propagated')

const beforeDelete = await b.hash()
await a.click('[aria-label="Select"]')
await a.mouse('mousePressed', 1070, 620, { button: 'left', buttons: 1, clickCount: 1 })
await a.mouse('mouseReleased', 1070, 620, { button: 'left', buttons: 0, clickCount: 1 })
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 }, a.session)
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 }, a.session)
await waitFor(() => !elements().some((e) => e.text === 'hello collab'), 'sticky delete in shared document')
await waitFor(async () => (await b.hash()) !== beforeDelete, 'delete visible in second browser')
console.log('delete propagated')

// Let Hocuspocus' 2 s store debounce run, then prove a full page reload restores
// the shared snapshot/log rather than the stale Slice A localStorage copy.
await sleep(2500)
// Serif/text antialiasing can differ after a font reload, so compare only the
// region containing the moved rectangle. That region is empty in the legacy
// localStorage copy and can only be restored from the shared Yjs state.
const beforeReload = await b.regionHash(650, 500, 240, 180)
await b.reload()
await waitFor(async () => (await b.regionHash(650, 500, 240, 180)) === beforeReload, 'shared state after browser refresh', 10_000)
console.log('refresh restored shared state')

console.log('browser errors', a.errors, b.errors, events.filter(e => e.method === 'Runtime.exceptionThrown').map(e => e.params.exceptionDetails?.text))

observer.destroy()
observerDoc.destroy()
await a.close(); await b.close()
await send('Target.disposeBrowserContext', { browserContextId: contextA }).catch(() => undefined)
await send('Target.disposeBrowserContext', { browserContextId: contextB }).catch(() => undefined)
browser.close()
