// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OPEN_TIMEOUT_MS, createAiChatDirectClientWithEndpointLoader } from './createAiChatDirectClient'
import { DirectFailure } from '../protocol/directFailure'

// 这里用一个最小的 WebSocket 假件，验证「断线 ≠ 关闭」与「交互超时只停止等待」。

type Frame = { id: string; type: string; method: string; params: any }

class FakeWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static instances: FakeWebSocket[] = []

  readyState = 0
  sent: Frame[] = []
  private listeners = new Map<string, Array<(event: any) => void>>()

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }

  addEventListener(name: string, listener: (event: any) => void) {
    const list = this.listeners.get(name) || []
    list.push(listener)
    this.listeners.set(name, list)
  }

  emit(name: string, event?: any) {
    for (const listener of this.listeners.get(name) || []) listener(event || {})
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.emit('open')
  }

  send(raw: string) {
    this.sent.push(JSON.parse(raw))
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.emit('close')
  }

  respond(id: string, result: unknown) {
    this.emit('message', { data: JSON.stringify({ id, type: 'response', ok: true, result }) })
  }

  respondError(id: string, code: string, message: string) {
    this.emit('message', { data: JSON.stringify({ id, type: 'response', ok: false, error: { code, message } }) })
  }

  requestsFor(method: string) {
    return this.sent.filter((frame) => frame.method === method)
  }
}

function endpoint() {
  return { ipc: { mode: 'direct', transport: 'local-websocket', protocolVersion: 2, url: 'ws://127.0.0.1:1234' }, token: 't' }
}

// 预算必须保持「交互 < 后台」：测试里只调交互档时，后台档自动抬高，
// 避免为了测试便利而伪造一个倒挂预算（那正是本轮要消灭的结构性问题）。
async function connectClient(options?: { interactionMs?: number; backgroundMs?: number }) {
  const interactionMs = options?.interactionMs ?? 20_000
  const backgroundMs = options?.backgroundMs ?? Math.max(interactionMs + 1_000, 45_000)
  const opening = createAiChatDirectClientWithEndpointLoader(async () => endpoint())
  // 连接建立：open + healthCheck。
  await Promise.resolve()
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  socket.open()
  await Promise.resolve()
  const health = socket.requestsFor('aiChat.healthCheck')[0]
  socket.respond(health.id, {
    features: [],
    timeoutBudget: { interactionMs, backgroundMs },
  })
  const client = await opening
  return { client, socket }
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.useFakeTimers()
  ;(globalThis as any).WebSocket = FakeWebSocket
})

afterEach(() => {
  vi.useRealTimers()
})

describe('交互超时的语义分流', () => {
  it('读请求超时后保留 promise，等真实响应再 settle', async () => {
    const { client, socket } = await connectClient({ interactionMs: 1000 })
    const promise = client.invoke('aiChat.storageGet', { key: 'roles/a/role' })
    await vi.advanceTimersByTimeAsync(0)

    const request = socket.requestsFor('aiChat.storageGet')[0]
    await vi.advanceTimersByTimeAsync(1000)
    // 读请求不 reject：即使超时也继续等。
    let settled = false
    promise.then(() => { settled = true }, () => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    socket.respond(request.id, { ok: true })
    await expect(promise).resolves.toEqual({ ok: true })
  })

  it('写请求超时后 reject 为 indeterminate，并发出 cancel 帧', async () => {
    // 新契约（design-5 契约 2）：写请求走「后台」预算，超时点由预算决定，
    // 不再由调用方散落的 timeoutMs 决定。这里把后台档压到 2s。
    const { client, socket } = await connectClient({ interactionMs: 1000, backgroundMs: 2000 })
    const promise = client.invoke('aiChat.storageSet', { key: 'meta/index', value: {} })
    const outcome: Promise<{ value?: unknown; error?: unknown }> = promise.then((value) => ({ value }), (error) => ({ error }))
    await vi.advanceTimersByTimeAsync(0)

    const request = socket.requestsFor('aiChat.storageSet')[0]
    // 未到后台预算：必须仍在等待（外层不允许比预算更早放弃）。
    await vi.advanceTimersByTimeAsync(1500)
    let early = false
    promise.then(() => { early = true }, () => { early = true })
    await Promise.resolve()
    expect(early).toBe(false)

    // 越过后台预算：丢弃 promise 并标 indeterminate。
    await vi.advanceTimersByTimeAsync(600)
    const settled = await outcome
    expect(settled.error).toBeInstanceOf(DirectFailure)
    expect((settled.error as DirectFailure).kind).toBe('indeterminate')
    const cancel = socket.sent.find((frame) => frame.method === 'aiChat.cancelRequest')
    expect(cancel?.params).toEqual({ requestId: request.id })
  })

  it('命令超时同样禁止自动重试：不重发原请求', async () => {
    // 透传写命令同样归后台类：超时点 = 后台预算。
    const { client, socket } = await connectClient({ interactionMs: 1000, backgroundMs: 2000 })
    const promise = client.invoke('aiChat.netRequest', { method: 'POST', path: '/api/runs' })
    const outcome: Promise<{ value?: unknown; error?: unknown }> = promise.then((value) => ({ value }), (error) => ({ error }))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2100)
    const settled = await outcome
    expect(settled.error).toBeInstanceOf(DirectFailure)
    expect((settled.error as DirectFailure).kind).toBe('indeterminate')
    expect(socket.requestsFor('aiChat.netRequest')).toHaveLength(1)
  })

  // 审查偏差 2 的核心回归：散落的 timeoutMs 不再能缩短外层预算。
  // 旧行为是「前端 15s 先放弃、studio 40s / box 30s 继续写」→ timeout_after_complete。
  it('调用方传入的 timeoutMs 不能把外层预算缩短到内层之下', async () => {
    const { client, socket } = await connectClient({ interactionMs: 20_000, backgroundMs: 45_000 })
    // 模拟历史硬编码：写请求带 timeoutMs: 15000（< studio 40s / box 30s）。
    const promise = client.invoke('aiChat.storageSet', { key: 'meta/index', value: {} }, { timeoutMs: 15_000 })
    const outcome: Promise<{ value?: unknown; error?: unknown }> = promise.then((value) => ({ value }), (error) => ({ error }))
    await vi.advanceTimersByTimeAsync(0)

    // 越过 15s 仍在等待：外层必须活到后台预算，绝不允许先于内层放弃。
    await vi.advanceTimersByTimeAsync(16_000)
    let settledEarly = false
    promise.then(() => { settledEarly = true }, () => { settledEarly = true })
    await Promise.resolve()
    expect(settledEarly).toBe(false)

    // 到后台预算才丢弃。
    await vi.advanceTimersByTimeAsync(30_000)
    const settled = await outcome
    expect(settled.error).toBeInstanceOf(DirectFailure)
    expect((settled.error as DirectFailure).kind).toBe('indeterminate')
    void socket
  })
})

describe('握手 / 探活超时', () => {
  it('open 阶段 healthCheck 卡住时必须超时 reject，不能永久挂起', async () => {
    const opening = createAiChatDirectClientWithEndpointLoader(async () => endpoint())
    await Promise.resolve()
    const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
    socket.open()
    await Promise.resolve()
    // healthCheck 已发出但服务端永不响应。
    expect(socket.requestsFor('aiChat.healthCheck')).toHaveLength(1)

    const outcome: Promise<{ value?: unknown; error?: unknown }> = opening.then((value) => ({ value }), (error) => ({ error }))
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS + 1)
    const settled = await outcome
    expect(settled.error).toBeInstanceOf(DirectFailure)
    expect((settled.error as DirectFailure).kind).toBe('timeout')
    expect((settled.error as DirectFailure).method).toBe('aiChat.healthCheck')
  })

  it('探活（refreshHealthCheck）卡住时同样超时 reject', async () => {
    const { client, socket } = await connectClient({ interactionMs: 60_000 })
    // 让下一次 healthCheck 永不响应。
    const promise = client.refreshHealthCheck()
    const outcome: Promise<{ value?: unknown; error?: unknown }> = promise.then((value) => ({ value }), (error) => ({ error }))
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS + 1)
    const settled = await outcome
    expect(settled.error).toBeInstanceOf(DirectFailure)
    expect((settled.error as DirectFailure).kind).toBe('timeout')
    void socket
  })

  it('普通读请求仍然保留 promise（握手语义不外溢）', async () => {
    const { client, socket } = await connectClient({ interactionMs: 1000 })
    const promise = client.invoke('aiChat.storageGet', { key: 'roles/a/role' })
    await vi.advanceTimersByTimeAsync(0)
    const request = socket.requestsFor('aiChat.storageGet')[0]
    await vi.advanceTimersByTimeAsync(1000)
    let settled = false
    promise.then(() => { settled = true }, () => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    socket.respond(request.id, { ok: true })
    await expect(promise).resolves.toEqual({ ok: true })
  })
})

describe('断线重连的 pending 处置', () => {
  it('断线不 reject：pending 标记 orphan，重连后读请求自动重放', async () => {
    const { client, socket } = await connectClient({ interactionMs: 60_000 })
    const promise = client.invoke('aiChat.storageGet', { key: 'roles/a/role' })
    await vi.advanceTimersByTimeAsync(0)
    const original = socket.requestsFor('aiChat.storageGet')[0]

    socket.close()
    let settled = false
    promise.then(() => { settled = true }, () => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    // 退避后重连：新 socket 建立并完成 healthCheck。
    await vi.advanceTimersByTimeAsync(400)
    const next = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
    next.open()
    await vi.advanceTimersByTimeAsync(0)
    const health = next.requestsFor('aiChat.healthCheck')[0]
    next.respond(health.id, { features: [] })
    await vi.advanceTimersByTimeAsync(0)

    // 读请求以同一 id 重放。
    const replay = next.requestsFor('aiChat.storageGet')
    expect(replay).toHaveLength(1)
    expect(replay[0].id).toBe(original.id)
    next.respond(replay[0].id, { replayed: true })
    await expect(promise).resolves.toEqual({ replayed: true })
  })

  it('断线后写请求返回 RECONNECTED_UNKNOWN，不自动重放', async () => {
    const { client, socket } = await connectClient({ interactionMs: 60_000 })
    const promise = client.invoke('aiChat.storageSet', { key: 'meta/index', value: {} })
    const outcome: Promise<{ value?: unknown; error?: unknown }> = promise.then((value) => ({ value }), (error) => ({ error }))
    await vi.advanceTimersByTimeAsync(0)

    socket.close()
    await vi.advanceTimersByTimeAsync(400)
    const next = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
    next.open()
    await vi.advanceTimersByTimeAsync(0)
    const health = next.requestsFor('aiChat.healthCheck')[0]
    next.respond(health.id, { features: [] })
    await vi.advanceTimersByTimeAsync(0)

    const settled = await outcome
    expect(settled.error).toBeInstanceOf(DirectFailure)
    expect((settled.error as DirectFailure).kind).toBe('reconnectedUnknown')
    expect((settled.error as DirectFailure).code).toBe('RECONNECTED_UNKNOWN')
    expect(next.requestsFor('aiChat.storageSet')).toHaveLength(0)
  })

  it('只有 close() 才 reject 全部 pending', async () => {
    const { client } = await connectClient({ interactionMs: 60_000 })
    const promise = client.invoke('aiChat.storageGet', { key: 'roles/a/role' })
    await vi.advanceTimersByTimeAsync(0)

    client.close()
    await expect(promise).rejects.toMatchObject({ kind: 'transport' })
  })

  it('重连成功后通知 onReconnected 订阅者（首次连接不通知）', async () => {
    const { client, socket } = await connectClient({ interactionMs: 60_000 })
    const listener = vi.fn()
    client.onReconnected(listener)
    expect(listener).not.toHaveBeenCalled()

    socket.close()
    await vi.advanceTimersByTimeAsync(400)
    const next = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
    next.open()
    await vi.advanceTimersByTimeAsync(0)
    const health = next.requestsFor('aiChat.healthCheck')[0]
    next.respond(health.id, { features: [] })
    await vi.advanceTimersByTimeAsync(0)

    expect(listener).toHaveBeenCalledTimes(1)
  })
})
