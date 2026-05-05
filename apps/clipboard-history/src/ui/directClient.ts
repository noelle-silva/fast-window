export type DirectBackgroundClient = {
  invoke<T = unknown>(method: string, params?: unknown): Promise<T>
  onEvent(listener: (event: DirectBackgroundEvent) => void): () => void
  close(): void
}

export type DirectBackgroundEvent = {
  type: string
  [key: string]: unknown
}

const OPEN_TIMEOUT_MS = 15_000
const REQUEST_TIMEOUT_MS = 30_000

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

function validateEndpoint(endpoint: any) {
  if (!endpoint || typeof endpoint !== 'object') throw new Error('剪贴板历史后台 endpoint 不完整')
  const url = String(endpoint.url || '')
  const token = String(endpoint.token || '')
  if (!url || !token) throw new Error('剪贴板历史后台 endpoint 不完整')
  if (!/^ws:\/\/127\.0\.0\.1:\d+$/i.test(url)) throw new Error('剪贴板历史后台地址必须是本机 WebSocket')
  return { url, token }
}

function waitForOpen(ws: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('剪贴板历史后台连接超时')), OPEN_TIMEOUT_MS)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('剪贴板历史后台连接失败'))
    }, { once: true })
  })
}

export async function createDirectBackgroundClient(endpoint: any): Promise<DirectBackgroundClient> {
  const { url, token } = validateEndpoint(endpoint)
  const ws = new WebSocket(`${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`)
  await waitForOpen(ws)

  let seq = 0
  const pending = new Map<string, PendingRequest>()
  const listeners = new Set<(event: DirectBackgroundEvent) => void>()

  function rejectPending(error: Error) {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    pending.clear()
  }

  ws.addEventListener('message', event => {
    let frame: any = null
    try {
      frame = JSON.parse(String(event.data))
    } catch {
      return
    }
    if (!frame) return
    if (frame.type === 'event') {
      for (const listener of listeners) listener(frame)
      return
    }
    if (frame.type !== 'response') return
    const id = String(frame.id || '')
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    clearTimeout(entry.timer)
    if (frame.ok) entry.resolve(frame.result)
    else entry.reject(new Error(String(frame.error?.message || '剪贴板历史后台请求失败')))
  })

  ws.addEventListener('close', () => rejectPending(new Error('剪贴板历史后台连接已关闭')))
  ws.addEventListener('error', () => rejectPending(new Error('剪贴板历史后台连接异常')))

  return {
    invoke<T = unknown>(method: string, params?: unknown): Promise<T> {
      if (ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('剪贴板历史后台未连接'))
      const id = `ch-${Date.now()}-${++seq}`
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error('剪贴板历史后台请求超时'))
        }, REQUEST_TIMEOUT_MS)
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
        ws.send(JSON.stringify({ id, type: 'request', method, params: params ?? {} }))
      })
    },
    onEvent(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() {
      rejectPending(new Error('剪贴板历史后台连接已关闭'))
      listeners.clear()
      ws.close()
    },
  }
}
