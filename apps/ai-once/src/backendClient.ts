import { invoke } from '@tauri-apps/api/core'
import type { BackendEndpoint, DirectClient } from './types'

type PendingRequest = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

const OPEN_TIMEOUT_MS = 15_000
const REQUEST_TIMEOUT_MS = 75_000
const RECONNECT_DELAY_MS = 300
const RESUME_GAP_MS = 45_000
const RESUME_CHECK_INTERVAL_MS = 10_000

function endpointUrlWithToken(endpoint: BackendEndpoint): string {
  if (endpoint.mode !== 'direct') throw new Error('后台 endpoint mode 必须是 direct')
  if (endpoint.transport !== 'local-websocket') throw new Error('后台 endpoint transport 必须是 local-websocket')
  if (endpoint.protocolVersion !== 1) throw new Error('后台 endpoint protocolVersion 必须是 1')
  if (!endpoint.url.startsWith('ws://127.0.0.1:')) throw new Error('后台 endpoint 必须绑定 127.0.0.1')
  if (!endpoint.token) throw new Error('后台 endpoint token 缺失')
  return `${endpoint.url}${endpoint.url.includes('?') ? '&' : '?'}token=${encodeURIComponent(endpoint.token)}`
}

function waitForOpen(ws: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('后台连接超时')), OPEN_TIMEOUT_MS)
    ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('后台连接失败')) }, { once: true })
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

class AiOnceDirectClient implements DirectClient {
  private ws: WebSocket | null = null
  private connectPromise: Promise<void> | null = null
  private reconnectTimer: number | null = null
  private seq = 0
  private closed = false
  private readonly pending = new Map<string, PendingRequest>()
  private readonly cleanupResumeTriggers: () => void

  constructor() {
    this.cleanupResumeTriggers = installResumeTriggers(() => this.scheduleReconnect(true))
  }

  open = async (): Promise<void> => {
    await this.ensureConnected()
  }

  request = async <T,>(method: string, params?: unknown): Promise<T> => {
    await this.ensureConnected()
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.markDisconnected(ws, new Error('后台连接已关闭'))
      await this.ensureConnected()
    }

    const active = this.ws
    if (!active || active.readyState !== WebSocket.OPEN) throw new Error('后台未连接')
    const id = `ai-once-${Date.now()}-${++this.seq}`
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('后台请求超时')) }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      try {
        active.send(JSON.stringify({ id, type: 'request', method, params: params ?? {} }))
      } catch {
        this.pending.delete(id)
        clearTimeout(timer)
        this.markDisconnected(active, new Error('后台连接已关闭'))
        reject(new Error('后台连接已关闭'))
      }
    })
  }

  close = () => {
    this.closed = true
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer)
    this.cleanupResumeTriggers()
    this.rejectPending(new Error('后台连接已关闭'))
    const ws = this.ws
    this.ws = null
    if (ws && ws.readyState !== WebSocket.CLOSED) ws.close()
  }

  private async ensureConnected(): Promise<void> {
    if (this.closed) throw new Error('后台连接已关闭')
    if (this.ws?.readyState === WebSocket.OPEN) return
    if (this.connectPromise) return this.connectPromise
    this.connectPromise = this.connect()
    try { await this.connectPromise } finally { this.connectPromise = null }
  }

  private async connect(): Promise<void> {
    const endpoint = await invoke<BackendEndpoint>('backend_endpoint')
    const ws = new WebSocket(endpointUrlWithToken(endpoint))
    this.ws = ws
    ws.addEventListener('message', event => this.handleMessage(event))
    ws.addEventListener('close', () => this.markDisconnected(ws, new Error('后台连接已关闭')))
    ws.addEventListener('error', () => this.markDisconnected(ws, new Error('后台连接异常')))
    try {
      await waitForOpen(ws)
    } catch (error) {
      if (this.ws === ws) this.ws = null
      if (ws.readyState !== WebSocket.CLOSED) ws.close()
      throw error
    }
    if (this.closed || this.ws !== ws) {
      ws.close()
      throw new Error('后台连接已关闭')
    }
  }

  private handleMessage(event: MessageEvent) {
    let frame: any = null
    try { frame = JSON.parse(String(event.data)) } catch { return }
    if (!frame || frame.type !== 'response') return
    const id = String(frame.id || '')
    const entry = this.pending.get(id)
    if (!entry) return
    this.pending.delete(id)
    clearTimeout(entry.timer)
    if (frame.ok) entry.resolve(frame.result)
    else entry.reject(new Error(String(frame.error?.message || '后台请求失败')))
  }

  private markDisconnected(ws: WebSocket | null, error: Error) {
    if (ws && this.ws !== ws) return
    this.ws = null
    this.rejectPending(error)
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
      this.rejectPending(new Error('后台连接刷新中'))
      if (ws.readyState !== WebSocket.CLOSED) ws.close()
    }
    await this.ensureConnected()
  }

  private rejectPending(error: Error) {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error) }
    this.pending.clear()
  }
}

export async function createDirectClient(): Promise<DirectClient> {
  const client = new AiOnceDirectClient()
  await client.open()
  return client
}
