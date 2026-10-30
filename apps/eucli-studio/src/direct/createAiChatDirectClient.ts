import { AI_CHAT_DIRECT_METHOD, AI_CHAT_DIRECT_PROTOCOL_VERSION, type AiChatDirectEvent } from '../protocol/aiChatProtocol'
import type { AiChatDirectResponse } from '../protocol/aiChatProtocol'
import { AiChatDirectError } from '../protocol/aiChatProtocolGuards'
import { DirectFailure, keepsPromiseAfterInteractionTimeout, replayClassFor, type ReplayClass } from '../protocol/directFailure'
import { applyTimeoutBudget, resolveTimeoutMs, type TimeoutBudget } from '../protocol/timeoutBudget'

export type AiChatDirectClient = {
  invoke<T = unknown>(method: string, params?: unknown, options?: { timeoutMs?: number }): Promise<T>
  subscribe(listener: (event: AiChatDirectEvent) => void): () => void
  // 连接重建成功（含首次连上之后的重连）：订阅者据此做一次权威对账。
  onReconnected(listener: () => void): () => void
  // 重新握手并刷新能力/预算：box 能力在 bootstrap 后才探测完成，必须能重读。
  refreshHealthCheck(): Promise<unknown>
  close(): void
  // healthCheck 的原始结果（含 features / timeoutBudget）：能力协商靠它，不靠协议版本。
  getHealthCheck(): unknown
}

export type AiChatEndpointLoader = () => Promise<unknown>

type PendingRequest = {
  id: string
  method: string
  params: unknown
  replay: ReplayClass
  // handshake：握手 / 探活请求。它不受「读类超时保留 promise」规则保护：
  // 连接卡住时 open()/resumeProbe 必须能结束，因此超时一律 reject 并换代。
  handshake: boolean
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout> | null
  // orphaned：连接已经断开，但请求语义仍可能完成。不 reject，等重连后按类别处理。
  orphaned: boolean
  // 已发出的尝试次数（含首次）。SERVER_BUSY 重试的唯一计数来源。
  attempts: number
  // 本次请求的绝对截止时刻：重试与超时共用同一个上界，绝不因为重试而无限延长。
  deadline: number
}

export type DirectTimeoutBudget = TimeoutBudget

const OPEN_TIMEOUT_MS = 15_000
// 导出给测试钉住握手超时语义：握手超时必须 reject，不能永久挂起。
export { OPEN_TIMEOUT_MS }
// 重连退避：300ms 起步，指数增长，上限 10s（design-5 第九节第 8 条）。
const RECONNECT_INITIAL_DELAY_MS = 300
const RECONNECT_MAX_DELAY_MS = 10_000
const RESUME_GAP_MS = 45_000
const RESUME_CHECK_INTERVAL_MS = 10_000

// SERVER_BUSY 是有界重试的唯一触发码：
// studio 在 dispatch 入道前就拒绝了这一帧，请求从未被执行，因此重试对所有类别都安全
// （不存在重复副作用）。重试次数与退避都有确定上界，绝不无界重试。
const SERVER_BUSY_CODE = 'SERVER_BUSY'
const SERVER_BUSY_MAX_ATTEMPTS = 4
const SERVER_BUSY_RETRY_INITIAL_DELAY_MS = 120
const SERVER_BUSY_RETRY_MAX_DELAY_MS = 1_200

function isServerBusy(error: unknown) {
  return String((error as any)?.code || '') === SERVER_BUSY_CODE
}

function getBackgroundEndpoint(baseApi: unknown) {
  const background = (baseApi as any)?.background
  if (!background || typeof background.endpoint !== 'function') {
    throw new Error('background.endpoint 不可用：当前宿主不支持 v4.5 direct 后台')
  }
  return background.endpoint()
}

function normalizeEndpoint(raw: any) {
  const endpoint = raw && typeof raw === 'object' && raw.ipc && typeof raw.ipc === 'object'
    ? { ...raw.ipc, token: raw.token }
    : raw
  if (!endpoint || typeof endpoint !== 'object') throw new Error('background.endpoint 返回值无效')
  if (endpoint.mode !== 'direct') throw new Error('background.endpoint mode 不支持：需要 direct')
  if (endpoint.transport !== 'local-websocket') throw new Error('background.endpoint transport 不支持：需要 local-websocket')
  if (Number(endpoint.protocolVersion) !== AI_CHAT_DIRECT_PROTOCOL_VERSION) {
    throw new Error('background.endpoint 协议版本不兼容')
  }
  const url = String(endpoint.url || '').trim()
  const token = String(endpoint.token || '').trim()
  if (!url.startsWith('ws://127.0.0.1:')) throw new Error('background.endpoint URL 无效')
  if (!token) throw new Error('background.endpoint token 缺失')
  return { url, token }
}

function makeRequestId() {
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

// readTimeoutBudget 把 healthCheck 签发的预算落到统一模块：
// 服务端是唯一权威，前端任何地方都不再自编数字。
function readTimeoutBudget(healthCheck: unknown): DirectTimeoutBudget {
  return applyTimeoutBudget((healthCheck as any)?.timeoutBudget)
}

export async function createAiChatDirectClient(baseApi: unknown): Promise<AiChatDirectClient> {
  return createAiChatDirectClientWithEndpointLoader(() => getBackgroundEndpoint(baseApi))
}

export async function createAiChatDirectClientWithEndpointLoader(loadEndpoint: AiChatEndpointLoader): Promise<AiChatDirectClient> {
  const client = new AiChatReconnectableDirectClient(loadEndpoint)
  try {
    await client.open()
    return client
  } catch (error) {
    client.close()
    throw error
  }
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

class AiChatReconnectableDirectClient implements AiChatDirectClient {
  private ws: WebSocket | null = null
  private connectPromise: Promise<void> | null = null
  private reconnectTimer: number | null = null
  private reconnectDelayMs = RECONNECT_INITIAL_DELAY_MS
  private closed = false
  private readonly pending = new Map<string, PendingRequest>()
  private readonly listeners = new Set<(event: AiChatDirectEvent) => void>()
  private readonly reconnectListeners = new Set<() => void>()
  private readonly cleanupResumeTriggers: () => void
  private healthCheckResult: unknown = null
  private hasConnectedOnce = false

  constructor(private readonly loadEndpoint: AiChatEndpointLoader) {
    this.cleanupResumeTriggers = installResumeTriggers(() => void this.resumeProbe())
  }

  open = async (): Promise<void> => {
    await this.ensureConnected()
  }

  invoke = async <T = unknown,>(method: string, params?: unknown, options?: { timeoutMs?: number }): Promise<T> => {
    const replay = replayClassFor(method, params)
    await this.ensureConnected()
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.markDisconnected(ws, '连接已断开')
      await this.ensureConnected()
    }

    const active = this.ws
    if (!active || active.readyState !== WebSocket.OPEN) throw new DirectFailure('transport', method, replay)
    return this.send<T>(active, method, params, replay, options)
  }

  subscribe = (listener: (event: AiChatDirectEvent) => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onReconnected = (listener: () => void) => {
    this.reconnectListeners.add(listener)
    return () => this.reconnectListeners.delete(listener)
  }

  getHealthCheck = () => this.healthCheckResult

  // refreshHealthCheck 重新握手：box 能力在 studio.bootstrap 之后才探测完成，
  // 因此能力协商必须能在探测结束后重读一次，而不是永远用首次快照。
  refreshHealthCheck = async (): Promise<unknown> => {
    await this.ensureConnected()
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new DirectFailure('transport', 'aiChat.healthCheck', 'idempotent-read')
    this.healthCheckResult = await this.send(ws, 'aiChat.healthCheck', {}, 'idempotent-read', { timeoutMs: OPEN_TIMEOUT_MS, handshake: true })
    readTimeoutBudget(this.healthCheckResult)
    return this.healthCheckResult
  }

  close = () => {
    this.closed = true
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer)
    this.cleanupResumeTriggers()
    this.listeners.clear()
    this.reconnectListeners.clear()
    // 只有 close() 才 reject：断线 ≠ 关闭。
    this.rejectPending(new DirectFailure('transport', '', 'non-idempotent', 'Direct client 已关闭'))
    const ws = this.ws
    this.ws = null
    if (ws && ws.readyState !== WebSocket.CLOSED) ws.close()
  }

  private async ensureConnected(): Promise<void> {
    if (this.closed) throw new DirectFailure('transport', '', 'non-idempotent', 'Direct client 已关闭')
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
    ws.addEventListener('close', () => this.markDisconnected(ws, '连接已断开'))
    ws.addEventListener('error', () => this.markDisconnected(ws, '连接错误'))
    try {
      await waitForOpen(ws)
      if (this.closed || this.ws !== ws) throw new DirectFailure('transport', 'aiChat.healthCheck', 'idempotent-read')
      this.healthCheckResult = await this.send(ws, 'aiChat.healthCheck', {}, 'idempotent-read', { timeoutMs: OPEN_TIMEOUT_MS, handshake: true })
      readTimeoutBudget(this.healthCheckResult)
      this.reconnectDelayMs = RECONNECT_INITIAL_DELAY_MS
      this.replayOrphaned()
      // 首次连接不算「重连」：只有真正重建过才需要让上层重新对账。
      if (this.hasConnectedOnce) this.notifyReconnected()
      this.hasConnectedOnce = true
    } catch (error) {
      if (this.ws === ws) this.ws = null
      if (ws.readyState !== WebSocket.CLOSED) ws.close()
      throw error
    }
  }

  // timeoutFor 是前端唯一的超时解析入口。
  //
  // 握手 / 探活是例外：它不属于「业务请求」，而是「建立连接」本身，
  // 必须用固定的握手预算（OPEN_TIMEOUT_MS），否则连接卡住时会跟着业务预算一起变长。
  private timeoutFor(method: string, params: unknown, options?: { timeoutMs?: number; handshake?: boolean }) {
    if (options?.handshake) {
      const explicit = Number(options.timeoutMs)
      return Number.isFinite(explicit) && explicit > 0 ? explicit : OPEN_TIMEOUT_MS
    }
    return resolveTimeoutMs(method, params, options?.timeoutMs)
  }

  private send<T = unknown>(ws: WebSocket, method: string, params: unknown, replay: ReplayClass, options?: { timeoutMs?: number; handshake?: boolean }): Promise<T> {
    const id = makeRequestId()
    const timeoutMs = this.timeoutFor(method, params, options)
    return new Promise<T>((resolve, reject) => {
      const item: PendingRequest = {
        id,
        method,
        params,
        replay,
        handshake: !!options?.handshake,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer: null,
        orphaned: false,
        attempts: 1,
        deadline: Date.now() + timeoutMs,
      }
      item.timer = setTimeout(() => this.onInteractionTimeout(item, timeoutMs), timeoutMs)
      this.pending.set(id, item)
      try {
        ws.send(JSON.stringify({ id, type: 'request', method, params: params ?? {} }))
      } catch {
        this.pending.delete(id)
        clearTimeout(item.timer!)
        this.markDisconnected(ws, '连接已断开')
        reject(new DirectFailure('transport', method, replay))
      }
    })
  }

  // retryAfterServerBusy 是 SERVER_BUSY 的唯一处置点：
  // 这一帧在入道前就被拒绝、从未执行，因此重试对任何类别都安全（无重复副作用）。
  // 上界由「次数」与「原始预算截止时刻」双重约束：绝不无界重试，也绝不越过预算。
  private retryAfterServerBusy(item: PendingRequest): boolean {
    if (item.attempts >= SERVER_BUSY_MAX_ATTEMPTS) return false
    const remaining = item.deadline - Date.now()
    if (remaining <= 0) return false
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return false

    item.attempts += 1
    const backoff = Math.min(
      SERVER_BUSY_RETRY_INITIAL_DELAY_MS * 2 ** (item.attempts - 2),
      SERVER_BUSY_RETRY_MAX_DELAY_MS,
    )
    const delay = Math.min(backoff, Math.max(0, remaining - 1))
    if (item.timer) clearTimeout(item.timer)
    item.timer = setTimeout(() => {
      item.timer = null
      if (this.pending.get(item.id) !== item) return
      const active = this.ws
      if (!active || active.readyState !== WebSocket.OPEN) {
        this.pending.delete(item.id)
        item.reject(new DirectFailure('transport', item.method, item.replay))
        return
      }
      // 重试沿用同一 id：服务端已拒绝过该帧，不存在 id 冲突；
      // 预算上界沿用原始截止时刻（这里重新计算剩余量），重试绝不把等待延长。
      const left = item.deadline - Date.now()
      if (left <= 0) {
        this.pending.delete(item.id)
        item.reject(new DirectFailure('timeout', item.method, item.replay, `请求超时：${item.method}`))
        return
      }
      item.timer = setTimeout(() => this.onInteractionTimeout(item, left), left)
      try {
        active.send(JSON.stringify({ id: item.id, type: 'request', method: item.method, params: item.params ?? {} }))
      } catch {
        this.pending.delete(item.id)
        if (item.timer) clearTimeout(item.timer)
        item.timer = null
        this.markDisconnected(active, '连接已断开')
        item.reject(new DirectFailure('transport', item.method, item.replay))
      }
    }, delay)
    return true
  }

  // 超时语义按请求类别分三档（design-5 P5）：
  //   handshake（握手 / 探活）→ 超时即 reject 并换代：连接卡住必须能结束；
  //   read                   → 保留 promise 至自然完成，结果仍然进内容缓存；
  //   write / command        → 丢弃 promise，标记 indeterminate，由 reconcile 收敛。
  private onInteractionTimeout(item: PendingRequest, timeoutMs: number) {
    const current = this.pending.get(item.id)
    if (!current) return
    if (current.handshake) {
      // 握手超时：连接已不可信。reject + 关闭连接，让上层（open / resumeProbe）走换代路径。
      this.pending.delete(current.id)
      current.timer = null
      current.reject(new DirectFailure('timeout', current.method, current.replay, `握手超时（${timeoutMs}ms）：${current.method}`))
      this.markDisconnected(this.ws, '握手超时')
      return
    }
    if (keepsPromiseAfterInteractionTimeout(current.replay)) {
      // 读请求继续等待：清掉计时器，等真实响应到达时再 settle。
      current.timer = null
      return
    }
    this.pending.delete(item.id)
    current.timer = null
    // 平面 A：停止等待。平面 B（真正停止工作）永远不由超时自动触发。
    this.requestCancel(current.id)
    current.reject(new DirectFailure('indeterminate', current.method, current.replay, `请求超时且结果未知（${timeoutMs}ms）：${current.method}`))
  }

  private requestCancel(targetId: string) {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    try {
      ws.send(JSON.stringify({ id: makeRequestId(), type: 'request', method: AI_CHAT_DIRECT_METHOD.cancelRequest, params: { requestId: targetId } }))
    } catch {
      // 取消是尽力而为的传输平面动作：发送失败不影响已经做出的本地判定。
    }
  }

  private handleMessage(event: MessageEvent) {
    let frame: any = null
    try { frame = JSON.parse(String(event.data || '')) } catch { return }

    if (frame?.type === 'response') {
      const response = frame as AiChatDirectResponse
      const item = this.pending.get(response.id)
      if (!item) return
      if (!response.ok && isServerBusy(response.error)) {
        // 请求在入道前被拒、从未执行：有界重试；上界耗尽才把错误交回上层。
        if (this.retryAfterServerBusy(item)) return
      }
      this.pending.delete(response.id)
      if (item.timer) clearTimeout(item.timer)
      item.timer = null
      if (response.ok) item.resolve(response.result)
      else if (response.error) item.reject(new AiChatDirectError(response.error.code, response.error.message || '请求失败', response.error.details, response.error.system, response.error.cause, response.error.causes))
      else item.reject(new AiChatDirectError('DIRECT_ERROR', '请求失败'))
      return
    }

    if (frame?.type === 'event' && typeof frame.name === 'string') {
      for (const listener of this.listeners) listener(frame as AiChatDirectEvent)
    }
  }

  private markDisconnected(ws: WebSocket | null, reason: string) {
    if (ws && this.ws !== ws) return
    this.ws = null
    // 断线 ≠ 关闭：pending 只标记 orphaned，不 reject。
    for (const item of this.pending.values()) item.orphaned = true
    if (ws && ws.readyState !== WebSocket.CLOSED) ws.close()
    if (!this.closed) this.scheduleReconnect()
    void reason
  }

  // replayOrphaned 在重连成功后按 replay class 处置悬挂请求：
  //   idempotent-read   → 原样重放，结果照常 resolve；
  //   non-idempotent    → 无法判定是否已执行，返回 RECONNECTED_UNKNOWN，交给 reconcile。
  private replayOrphaned() {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    for (const item of Array.from(this.pending.values())) {
      if (!item.orphaned) continue
      if (item.replay === 'idempotent-read') {
        item.orphaned = false
        try {
          ws.send(JSON.stringify({ id: item.id, type: 'request', method: item.method, params: item.params ?? {} }))
        } catch {
          item.orphaned = true
          return
        }
        continue
      }
      this.pending.delete(item.id)
      if (item.timer) clearTimeout(item.timer)
      item.reject(new DirectFailure('reconnectedUnknown', item.method, item.replay))
    }
  }

  // resumeProbe 是「45s 后台恢复」的新语义：先探活，失败才换代。
  // 探活成功意味着旧连接仍然健康，不需要关闭任何东西，也不 reject 任何 pending。
  private async resumeProbe() {
    if (this.closed) return
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.scheduleReconnect(true)
      return
    }
    try {
      this.healthCheckResult = await this.send(ws, 'aiChat.healthCheck', {}, 'idempotent-read', { timeoutMs: OPEN_TIMEOUT_MS, handshake: true })
      readTimeoutBudget(this.healthCheckResult)
    } catch {
      // 探活失败（含超时）才换代：这时旧连接已不可信，重连语义成立。
      this.markDisconnected(ws, '探活失败')
      this.scheduleReconnect(true)
    }
  }

  private scheduleReconnect(force = false) {
    if (this.closed || this.reconnectTimer) return
    const delay = this.reconnectDelayMs
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, RECONNECT_MAX_DELAY_MS)
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      void this.reconnect(force).catch(() => {})
    }, delay)
  }

  private async reconnect(force: boolean) {
    if (this.closed) return
    if (force && this.ws) {
      const ws = this.ws
      this.ws = null
      if (ws.readyState !== WebSocket.CLOSED) ws.close()
    }
    await this.ensureConnected()
  }

  private notifyReconnected() {
    for (const listener of Array.from(this.reconnectListeners)) {
      try {
        listener()
      } catch {
        // 对账回调的失败属于上层语义，不能影响连接本身。
      }
    }
  }

  private rejectPending(reason: unknown) {
    for (const item of this.pending.values()) {
      if (item.timer) clearTimeout(item.timer)
      item.reject(reason)
    }
    this.pending.clear()
  }
}
