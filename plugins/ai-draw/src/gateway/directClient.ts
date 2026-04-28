import { AI_DRAW_DIRECT_METHOD, AI_DRAW_DIRECT_PROTOCOL_VERSION, type AiDrawDirectEvent, type AiDrawDirectResponse } from '../shared/protocol'

export type DirectAiDrawClient = {
  invoke<T = unknown>(method: string, params?: unknown, options?: { timeoutMs?: number }): Promise<T>
  subscribe(listener: (event: AiDrawDirectEvent) => void): () => void
  close(): void
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout> | null
}

function getBackgroundEndpoint(baseApi: unknown) {
  const background = (baseApi as any)?.background
  if (!background || typeof background.endpoint !== 'function') throw new Error('background.endpoint 不可用：当前宿主不支持 v4.5 direct 后台')
  return background.endpoint()
}

function normalizeEndpoint(raw: any) {
  const endpoint = raw && typeof raw === 'object' && raw.ipc && typeof raw.ipc === 'object' ? { ...raw.ipc, token: raw.token } : raw
  if (!endpoint || typeof endpoint !== 'object') throw new Error('background.endpoint 返回值无效')
  if (endpoint.mode !== 'direct') throw new Error('background.endpoint mode 不支持：需要 direct')
  if (endpoint.transport !== 'local-websocket') throw new Error('background.endpoint transport 不支持：需要 local-websocket')
  if (Number(endpoint.protocolVersion) !== AI_DRAW_DIRECT_PROTOCOL_VERSION) throw new Error('background.endpoint 协议版本不兼容')
  const url = String(endpoint.url || '').trim()
  const token = String(endpoint.token || '').trim()
  if (!url.startsWith('ws://127.0.0.1:')) throw new Error('background.endpoint URL 无效')
  if (!token) throw new Error('background.endpoint token 缺失')
  return { url, token }
}

function makeRequestId() {
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export async function createDirectAiDrawClient(baseApi: unknown): Promise<DirectAiDrawClient> {
  const endpoint = normalizeEndpoint(await getBackgroundEndpoint(baseApi))
  const ws = new WebSocket(`${endpoint.url}?token=${encodeURIComponent(endpoint.token)}`)
  const pending = new Map<string, PendingRequest>()
  const listeners = new Set<(event: AiDrawDirectEvent) => void>()
  let closed = false

  function rejectPending(reason: unknown) {
    for (const item of pending.values()) {
      if (item.timer) clearTimeout(item.timer)
      item.reject(reason)
    }
    pending.clear()
  }

  function invoke<T = unknown>(method: string, params?: unknown, options?: { timeoutMs?: number }): Promise<T> {
    if (closed || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) return Promise.reject(new Error('WebSocket 连接已关闭'))
    const id = makeRequestId()
    const timeoutMs = Number(options?.timeoutMs || 30000)
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`请求超时：${method}`))
      }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000)
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      ws.send(JSON.stringify({ id, type: 'request', method, params: params ?? {} }))
    })
  }

  const opened = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket 连接超时')), 15000)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('WebSocket 连接失败'))
    }, { once: true })
  })

  ws.addEventListener('message', (event) => {
    let frame: any = null
    try {
      frame = JSON.parse(String(event.data || ''))
    } catch {
      return
    }

    if (frame?.type === 'response') {
      const response = frame as AiDrawDirectResponse
      const item = pending.get(response.id)
      if (!item) return
      pending.delete(response.id)
      if (item.timer) clearTimeout(item.timer)
      if (response.ok) item.resolve(response.result)
      else item.reject(new Error(response.error?.message || '请求失败'))
      return
    }

    if (frame?.type === 'event' && typeof frame.name === 'string') {
      for (const listener of listeners) listener(frame as AiDrawDirectEvent)
    }
  })

  ws.addEventListener('close', () => {
    closed = true
    rejectPending(new Error('WebSocket 连接已断开'))
  })
  ws.addEventListener('error', () => {
    rejectPending(new Error('WebSocket 连接错误'))
  })

  await opened
  await invoke(AI_DRAW_DIRECT_METHOD.protocolHello, { clientProtocolVersion: AI_DRAW_DIRECT_PROTOCOL_VERSION }, { timeoutMs: 15000 })

  return {
    invoke,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() {
      closed = true
      listeners.clear()
      rejectPending(new Error('Direct client 已关闭'))
      ws.close()
    },
  }
}
