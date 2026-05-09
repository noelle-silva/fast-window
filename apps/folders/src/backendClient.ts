import { invoke } from '@tauri-apps/api/core'
import type { BackendEndpoint, DirectClient, PendingRequest } from './types'

const OPEN_TIMEOUT_MS = 15_000
const REQUEST_TIMEOUT_MS = 30_000

function endpointUrlWithToken(endpoint: BackendEndpoint): string {
  if (endpoint.mode !== 'direct') throw new Error('后台 endpoint mode 必须是 direct')
  if (endpoint.transport !== 'local-websocket') throw new Error('后台 endpoint transport 必须是 local-websocket')
  if (endpoint.protocolVersion !== 1) throw new Error('后台 endpoint protocolVersion 必须是 1')
  if (!endpoint.url.startsWith('ws://127.0.0.1:')) throw new Error('后台 endpoint 必须绑定 127.0.0.1')
  if (!endpoint.token) throw new Error('后台 endpoint token 缺失')
  return `${endpoint.url}${endpoint.url.includes('?') ? '&' : '?'}token=${encodeURIComponent(endpoint.token)}`
}

function assetUrlWithToken(endpoint: BackendEndpoint, assetId: string): string {
  const base = new URL(endpoint.url.replace(/^ws:/, 'http:'))
  base.pathname = `/assets/${assetId.split('/').map(encodeURIComponent).join('/')}`
  base.searchParams.set('token', endpoint.token)
  return base.toString()
}

function waitForOpen(ws: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('后台连接超时')), OPEN_TIMEOUT_MS)
    ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('后台连接失败')) }, { once: true })
  })
}

export async function createDirectClient(): Promise<DirectClient> {
  const endpoint = await invoke<BackendEndpoint>('backend_endpoint')
  const ws = new WebSocket(endpointUrlWithToken(endpoint))
  await waitForOpen(ws)
  let seq = 0
  const pending = new Map<string, PendingRequest>()
  const rejectPending = (error: Error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    pending.clear()
  }

  ws.addEventListener('message', event => {
    let frame: any = null
    try { frame = JSON.parse(String(event.data)) } catch { return }
    if (!frame || frame.type !== 'response') return
    const entry = pending.get(String(frame.id || ''))
    if (!entry) return
    pending.delete(String(frame.id || ''))
    clearTimeout(entry.timer)
    if (frame.ok) entry.resolve(frame.result)
    else entry.reject(new Error(String(frame.error?.message || '后台请求失败')))
  })
  ws.addEventListener('close', () => rejectPending(new Error('后台连接已关闭')))
  ws.addEventListener('error', () => rejectPending(new Error('后台连接异常')))

  return {
    request<T>(method: string, params?: unknown): Promise<T> {
      if (ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('后台未连接'))
      const id = `folders-${Date.now()}-${++seq}`
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('后台请求超时')) }, REQUEST_TIMEOUT_MS)
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
        ws.send(JSON.stringify({ id, type: 'request', method, params: params ?? {} }))
      })
    },
    assetUrl(assetId: string): string { return assetUrlWithToken(endpoint, assetId) },
    close() { rejectPending(new Error('后台连接已关闭')); ws.close() },
  }
}
