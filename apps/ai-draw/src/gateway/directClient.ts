import { AI_DRAW_DIRECT_METHOD, AI_DRAW_DIRECT_PROTOCOL_VERSION, type AiDrawDirectEvent, type AiDrawDirectResponse } from '../shared/protocol'

export type DirectAiDrawClient = {
  invoke<T = unknown>(method: string, params?: unknown, options?: { timeoutMs?: number }): Promise<T>
  subscribe(listener: (event: AiDrawDirectEvent) => void): () => void
  close(): void
}

export type AiDrawEndpointLoader = () => Promise<unknown>

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout> | null
}

const OPEN_TIMEOUT_MS = 15_000
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const RECONNECT_DELAY_MS = 300
const RESUME_GAP_MS = 45_000
const RESUME_CHECK_INTERVAL_MS = 10_000

function getBackgroundEndpoint(baseApi: unknown) {
  const background = (baseApi as any)?.background
  if (!background || typeof background.endpoint !== 'function') throw new Error('background.endpoint 不可用：当前宿主不支持 v4.5 direct 后台')
  return background.endpoint()
}

function normalizeEndpoint(raw: any) {
  const endpoint = raw && typeof raw === 'object' && raw.ipc && typeof raw.ipc === 'object' ? { ...raw.ipc, token: raw.token } : raw
  if (!endpoint || typeof endpoint !== 'object') throw new Error('后台 endpoint 返回值无效')
  if (endpoint.mode !== 'direct') throw new Error('后台 endpoint mode 不支持：需要 direct')
  if (endpoint.transport !== 'local-websocket') throw new Error('后台 endpoint transport 不支持：需要 local-websocket')
  if (Number(endpoint.protocolVersion) !== AI_DRAW_DIRECT_PROTOCOL_VERSION) throw new Error('后台 endpoint 协议版本不兼容')
  const url = String(endpoint.url || '').trim()
  const token = String(endpoint.token || '').trim()
  if (!url.startsWith('ws://127.0.0.1:')) throw new Error('后台 endpoint URL 无效')
  if (!token) throw new Error('后台 endpoint token 缺失')
  return { url, token }
}

function makeRequestId() {
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function endpointUrlWithToken(endpoint: { url: string; token: string }) {
  const separator = endpoint.url.includes('?') ? '&' : '?'
  return `${endpoint.url}${separator}token=${encodeURIComponent(endpoint.token)}`
}

function waitForOpen(ws: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket 连接超时')), OPEN_TIMEOUT_MS)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('WebSocket 连接失败'))
    }, { once: true })
  })
}

function installResumeTriggers(onResume: () => void) {
  let lastTick = Date.now()
  const checkResume = () => {
    const now = Date.now()
    if (now - lastTick > RESUME_GAP_MS) onResume()
    lastTick = now
  }
  const timer = window.setInterval(checkResume, RESUME_CHECK_INTERVAL_MS)
  const onVisible = () => { if (document.visibilityState === 'visible') checkResume() }
  const onFocus = () => checkResume()
  const onOnline = () => onResume()
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onFocus)
  window.addEventListener('online', onOnline)
  return () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('online', onOnline)
  }
}

class AiDrawDirectClient implements DirectAiDrawClient {
  private ws: WebSocket | null = null
  private connectPromise: Promise<void> | null = null
  private reconnectTimer: number | null = null
  private closed = false
  private readonly pending = new Map<string, PendingRequest>()
  private readonly listeners = new Set<(event: AiDrawDirectEvent) => void>()
  private readonly cleanupResumeTriggers: () => void

  constructor(private readonly loadEndpoint: AiDrawEndpointLoader) {
    this.cleanupResumeTriggers = installResumeTriggers(() => this.scheduleReconnect(true))
  }

  open = async (): Promise<void> => {
    await this.ensureConnected()
  }

  invoke = async <T = unknown,>(method: string, params?: unknown, options?: { timeoutMs?: number }): Promise<T> => {
    await this.ensureConnected()
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.markDisconnected(ws, new Error('WebSocket 连接已断开'))
      await this.ensureConnected()
    }

    const active = this.ws
    if (!active || active.readyState !== WebSocket.OPEN) throw new Error('WebSocket 连接已关闭')
    return this.send<T>(active, method, params, options)
  }

  subscribe = (listener: (event: AiDrawDirectEvent) => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close = () => {
    this.closed = true
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer)
    this.cleanupResumeTriggers()
    this.listeners.clear()
    this.rejectPending(new Error('Direct client 已关闭'))
    const ws = this.ws
    this.ws = null
    if (ws && ws.readyState !== WebSocket.CLOSED) ws.close()
  }

  private async ensureConnected(): Promise<void> {
    if (this.closed) throw new Error('Direct client 已关闭')
    if (this.ws?.readyState === WebSocket.OPEN) return
    if (this.connectPromise) return this.connectPromise
    this.connectPromise = this.connect()
    try { await this.connectPromise } finally { this.connectPromise = null }
  }

  private async connect(): Promise<void> {
    const endpoint = normalizeEndpoint(await this.loadEndpoint())
    const ws = new WebSocket(endpointUrlWithToken(endpoint))
    this.ws = ws
    ws.addEventListener('message', event => this.handleMessage(event))
    ws.addEventListener('close', () => this.markDisconnected(ws, new Error('WebSocket 连接已断开')))
    ws.addEventListener('error', () => this.markDisconnected(ws, new Error('WebSocket 连接错误')))
    try {
      await waitForOpen(ws)
      if (this.closed || this.ws !== ws) throw new Error('Direct client 已关闭')
      await this.send(ws, AI_DRAW_DIRECT_METHOD.protocolHello, { clientProtocolVersion: AI_DRAW_DIRECT_PROTOCOL_VERSION }, { timeoutMs: OPEN_TIMEOUT_MS })
    } catch (error) {
      if (this.ws === ws) this.ws = null
      if (ws.readyState !== WebSocket.CLOSED) ws.close()
      throw error
    }
  }

  private send<T = unknown>(ws: WebSocket, method: string, params?: unknown, options?: { timeoutMs?: number }): Promise<T> {
    const id = makeRequestId()
    const rawTimeout = Number(options?.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS)
    const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_REQUEST_TIMEOUT_MS
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`请求超时：${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      try {
        ws.send(JSON.stringify({ id, type: 'request', method, params: params ?? {} }))
      } catch {
        this.pending.delete(id)
        clearTimeout(timer)
        this.markDisconnected(ws, new Error('WebSocket 连接已断开'))
        reject(new Error('WebSocket 连接已关闭'))
      }
    })
  }

  private handleMessage(event: MessageEvent) {
    let frame: any = null
    try { frame = JSON.parse(String(event.data || '')) } catch { return }

    if (frame?.type === 'response') {
      const response = frame as AiDrawDirectResponse
      const item = this.pending.get(response.id)
      if (!item) return
      this.pending.delete(response.id)
      if (item.timer) clearTimeout(item.timer)
      if (response.ok) item.resolve(response.result)
      else item.reject(new Error(response.error?.message || '请求失败'))
      return
    }

    if (frame?.type === 'event' && typeof frame.name === 'string') {
      for (const listener of this.listeners) listener(frame as AiDrawDirectEvent)
    }
  }

  private markDisconnected(ws: WebSocket | null, reason: Error) {
    if (ws && this.ws !== ws) return
    this.ws = null
    this.rejectPending(reason)
    if (ws && ws.readyState !== WebSocket.CLOSED) ws.close()
    if (!this.closed) this.scheduleReconnect(false)
  }

  private scheduleReconnect(force: boolean) {
    if (this.closed || this.reconnectTimer) return
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      void this.reconnect(force).catch(() => {})
    }, RECONNECT_DELAY_MS)
  }

  private async reconnect(force: boolean) {
    if (this.closed) return
    if (force && this.ws) {
      const ws = this.ws
      this.ws = null
      this.rejectPending(new Error('WebSocket 连接刷新中'))
      if (ws.readyState !== WebSocket.CLOSED) ws.close()
    }
    await this.ensureConnected()
  }

  private rejectPending(reason: unknown) {
    for (const item of this.pending.values()) {
      if (item.timer) clearTimeout(item.timer)
      item.reject(reason)
    }
    this.pending.clear()
  }
}

export async function createDirectAiDrawClientWithEndpointLoader(loadEndpoint: AiDrawEndpointLoader): Promise<DirectAiDrawClient> {
  const client = new AiDrawDirectClient(loadEndpoint)
  try {
    await client.open()
    return client
  } catch (error) {
    client.close()
    throw error
  }
}

export async function createDirectAiDrawClient(baseApi: unknown): Promise<DirectAiDrawClient> {
  return createDirectAiDrawClientWithEndpointLoader(() => getBackgroundEndpoint(baseApi))
}
