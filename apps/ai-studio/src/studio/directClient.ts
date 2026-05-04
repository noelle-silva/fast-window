export type DirectEndpoint = {
  url: string
  token: string
}

export type DirectClient = {
  invoke<T = unknown>(method: string, params?: unknown, options?: { timeoutMs?: number }): Promise<T>
  close(): void
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout> | null
}

function makeRequestId() {
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export async function createDirectClient(endpoint: DirectEndpoint): Promise<DirectClient> {
  const url = String(endpoint.url || '').trim()
  const token = String(endpoint.token || '').trim()
  if (!url.startsWith('ws://127.0.0.1:')) throw new Error('后台地址无效')
  if (!token) throw new Error('后台 token 缺失')

  const ws = new WebSocket(`${url}?token=${encodeURIComponent(token)}`)
  const pending = new Map<string, PendingRequest>()
  let closed = false

  function rejectPending(reason: unknown) {
    for (const item of pending.values()) {
      if (item.timer) clearTimeout(item.timer)
      item.reject(reason)
    }
    pending.clear()
  }

  function invoke<T = unknown>(method: string, params?: unknown, options?: { timeoutMs?: number }): Promise<T> {
    if (closed || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      return Promise.reject(new Error('后台连接已关闭'))
    }
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
    const timer = setTimeout(() => reject(new Error('后台连接超时')), 15000)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('后台连接失败'))
    }, { once: true })
  })

  ws.addEventListener('message', event => {
    let frame: any = null
    try {
      frame = JSON.parse(String(event.data || ''))
    } catch {
      return
    }
    if (frame?.type !== 'response') return
    const item = pending.get(frame.id)
    if (!item) return
    pending.delete(frame.id)
    if (item.timer) clearTimeout(item.timer)
    if (frame.ok) item.resolve(frame.result)
    else item.reject(new Error(frame.error?.message || '请求失败'))
  })

  ws.addEventListener('close', () => {
    closed = true
    rejectPending(new Error('后台连接已断开'))
  })
  ws.addEventListener('error', () => {
    rejectPending(new Error('后台连接错误'))
  })

  await opened

  return {
    invoke,
    close() {
      closed = true
      rejectPending(new Error('后台连接已关闭'))
      ws.close()
    },
  }
}
