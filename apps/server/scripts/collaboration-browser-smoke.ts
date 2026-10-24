import WebSocket from 'ws'
import * as Y from 'yjs'
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from '@hocuspocus/provider'
import { createBoardDocument, projectElements } from '../../web/src/collab/document.ts'

const APP_URL = 'http://localhost:5173'
const API_URL = 'http://localhost:4000'
const WS_URL = 'ws://localhost:4001'
const PASSWORD = 'correct-horse-battery'
const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

interface ApiResult<T> {
  ok: boolean
  status: number
  body: T
}

interface AuthResponse {
  user: { id: string; name: string; email: string }
  csrfToken: string
}

interface BoardResponse {
  board: { id: string; title: string; role: 'owner' | 'editor' }
}

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
  csrf = ''
  errors: string[] = []
  constructor(public contextId: string, public label: string) {}

  async open() {
    const target = await send('Target.createTarget', {
      url: `${APP_URL}/`,
      browserContextId: this.contextId,
    })
    this.targetId = target.targetId
    this.session = (await send('Target.attachToTarget', { targetId: this.targetId, flatten: true })).sessionId
    await send('Runtime.enable', {}, this.session)
    // Keep the drawing coordinates deterministic regardless of the browser's
    // startup window size.
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    }, this.session)
    await send('Page.enable', {}, this.session)
    await waitFor(async () => (await this.eval<string>('document.readyState')) === 'complete', 'landing page load')
  }

  async eval<T>(expression: string): Promise<T> {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, this.session)
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result?.value as T
  }

  async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const request = {
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body,
      credentials: 'include',
    }
    const expression = `(async () => {
      const response = await fetch(${JSON.stringify(`${API_URL}${path}`)}, ${JSON.stringify(request)})
      const text = await response.text()
      let body = null
      try { body = text ? JSON.parse(text) : null } catch { body = { error: text } }
      return { ok: response.ok, status: response.status, body }
    })()`
    const result = await this.eval<ApiResult<T>>(expression)
    if (!result.ok) {
      const message = (result.body as { error?: string } | null)?.error ?? `HTTP ${result.status}`
      throw new Error(`${this.label} API ${path} failed: ${message}`)
    }
    return result.body
  }

  async register(email: string, name: string) {
    const body = await this.api<AuthResponse>('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password: PASSWORD }),
    })
    this.csrf = body.csrfToken
  }

  async createBoard(title: string): Promise<string> {
    const body = await this.api<BoardResponse>('/api/boards', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': this.csrf,
      },
      body: JSON.stringify({ title }),
    })
    return body.board.id
  }

  async joinBoard(boardId: string) {
    await this.api<BoardResponse>('/api/boards/join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': this.csrf,
      },
      body: JSON.stringify({ boardId }),
    })
  }

  async sessionCookie(): Promise<string> {
    const result = await send('Storage.getCookies', { browserContextId: this.contextId })
    const cookie = result.cookies.find((item: { name: string }) => item.name === 'confluo_session')
    if (!cookie) throw new Error(`${this.label} has no session cookie`)
    return `confluo_session=${cookie.value}`
  }

  async navigateToBoard(boardId: string) {
    await send('Page.navigate', { url: `${APP_URL}/board/${boardId}` }, this.session)
    await waitFor(
      async () =>
        (await this.eval<string>('document.querySelector(".connection-status")?.innerText ?? ""').catch(() => '')).includes('Live · server sync'),
      `${this.label} board sync`,
      20_000,
    )
    const status = await this.eval<string>('document.querySelector(".connection-status")?.innerText ?? ""')
    const errorText = await this.eval<string>('document.body.innerText.slice(0, 300)')
    if (!status.includes('Live · server sync')) {
      throw new Error(`${this.label} did not sync: ${status}\n${errorText}`)
    }
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
const a = new Page(contextA, 'browser A')
const b = new Page(contextB, 'browser B')
await a.open()
await b.open()
await a.register(`alice-${suffix}@example.test`, 'Alice Smoke')
await b.register(`bob-${suffix}@example.test`, 'Bob Smoke')

const boardId = await a.createBoard(`Smoke ${suffix}`)
await b.joinBoard(boardId)
console.log('board created and joined', boardId)

await a.navigateToBoard(boardId)
await b.navigateToBoard(boardId)
console.log('both browsers synced')

const cookie = await a.sessionCookie()
class CookieWebSocket extends WebSocket {
  constructor(address: string, protocols?: string | string[]) {
    super(address, protocols, {
      headers: { Cookie: cookie, Origin: APP_URL },
    })
  }
}

const observerDoc = new Y.Doc()
let observerSynced = false
const observerWebsocket = new HocuspocusProviderWebsocket({
  url: WS_URL,
  WebSocketPolyfill: CookieWebSocket as unknown as typeof globalThis.WebSocket,
})
const observer = new HocuspocusProvider({
  websocketProvider: observerWebsocket,
  name: `confluo.board.${boardId}`,
  document: observerDoc,
  onSynced: ({ state }) => { if (state) observerSynced = true },
  onAuthenticationFailed: ({ reason }) => { throw new Error(reason) },
})
observer.attach()
await waitFor(() => observerSynced, 'observer sync')
const boardDocument = createBoardDocument(boardId, observerDoc)
const elements = () => projectElements(boardDocument)
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

// Repeat the check in the opposite direction: B moves the element and A must
// observe it. This proves propagation is not one-way.
const beforeReverseMove = await a.hash()
await b.click('[aria-label="Select"]')
await b.drag(760, 585, 760, 480)
await waitFor(() => elements().some((e) => e.type === 'rectangle' && e.y < 500), 'reverse move in shared document')
await waitFor(async () => (await a.hash()) !== beforeReverseMove, 'reverse move visible in first browser')
console.log('reverse move propagated')

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

// Clear B's selection outline before comparing pixels across a reload.
await b.mouse('mousePressed', 1200, 700, { button: 'left', buttons: 1, clickCount: 1 })
await b.mouse('mouseReleased', 1200, 700, { button: 'left', buttons: 0, clickCount: 1 })

// Let Hocuspocus' store debounce run, then prove a full page reload restores
// the shared snapshot/log rather than a browser-local copy.
await sleep(2500)
const beforeReload = await b.regionHash(650, 500, 240, 180)
await b.reload()
await waitFor(async () => (await b.regionHash(650, 500, 240, 180)) === beforeReload, 'shared state after browser refresh', 10_000)
console.log('refresh restored shared state')

const pageErrors = events
  .filter((event) => event.method === 'Runtime.exceptionThrown')
  .map((event) => event.params.exceptionDetails?.text)
console.log('page errors', pageErrors)

observer.destroy()
observerWebsocket.destroy()
observerDoc.destroy()
await a.close(); await b.close()
await send('Target.disposeBrowserContext', { browserContextId: contextA }).catch(() => undefined)
await send('Target.disposeBrowserContext', { browserContextId: contextB }).catch(() => undefined)
browser.close()
