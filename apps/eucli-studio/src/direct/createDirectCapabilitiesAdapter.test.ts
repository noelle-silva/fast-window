// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDirectCapabilitiesAdapter } from './createDirectCapabilitiesAdapter'

// 审查偏差 D：能力协商不能在 bootstrap 之前快照。
//
//   studio.bootstrap 才触发 box 能力探测，首次 healthCheck 拿到的 features 是空集合。
//   若 sessionSwitch 在构造时快照 features，所有 gated 功能会永远关闭。

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

// flush 推进异步链：endpoint 加载、open、healthCheck 各占若干微任务。
async function flush(times = 8) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

// 建立一次连接：open socket、回应 healthCheck。
async function connect(features: string[]) {
  const opening = createDirectCapabilitiesAdapter({ background: { endpoint: async () => endpoint() } })
  await flush()
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  socket.open()
  await flush()
  const health = socket.requestsFor('aiChat.healthCheck')
  socket.respond(health[health.length - 1].id, { features })
  await flush()
  return { adapter: await opening, socket }
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.useFakeTimers()
  ;(globalThis as any).WebSocket = FakeWebSocket
})

afterEach(() => {
  vi.useRealTimers()
})

describe('能力协商的时序', () => {
  it('bootstrap 之后刷新 healthCheck，gated 功能才开启', async () => {
    // 首次 healthCheck：box 能力尚未探测，服务端只返回本地能力。
    const { adapter, socket } = await connect(['sessionIndex.get', 'storageGetMany'])

    expect(adapter.sessionSwitch.hasFeature('session.window')).toBe(false)
    // 本地能力始终可用。
    expect(adapter.sessionSwitch.hasFeature('sessionIndex.get')).toBe(true)

    // bootstrap 触发 box 探测完成 → 重新握手。
    const refresh = adapter.refreshCapabilities()
    await flush()
    const health = socket.requestsFor('aiChat.healthCheck')
    socket.respond(health[health.length - 1].id, { features: ['sessionIndex.get', 'session.window', 'session.get'] })
    await refresh

    // 动态读取：无需重建 client，判定立刻生效。
    expect(adapter.sessionSwitch.hasFeature('session.window')).toBe(true)
    expect(adapter.sessionSwitch.hasFeature('session.get')).toBe(true)
    expect(adapter.sessionSwitch.healthCheckFeatures).toContain('session.window')
  })

  it('能力集合是动态读取而非构造时快照', async () => {
    const { adapter, socket } = await connect(['sessionIndex.get'])

    // 取一次引用：它必须是「每次访问都最新」，而不是固定数组。
    const before = adapter.sessionSwitch.healthCheckFeatures
    expect(before).toEqual(expect.arrayContaining(['sessionIndex.get']))

    const refresh = adapter.refreshCapabilities()
    await flush()
    const health = socket.requestsFor('aiChat.healthCheck')
    socket.respond(health[health.length - 1].id, { features: ['sessionIndex.get', 'session.graph'] })
    await refresh

    expect(adapter.sessionSwitch.hasFeature('session.graph')).toBe(true)
    // 旧引用不应被原地改写（避免调用方持有过期视图时误判）。
    expect(before).not.toContain('session.graph')
  })

  it('刷新失败不影响已有能力集合', async () => {
    const { adapter, socket } = await connect(['session.window'])
    expect(adapter.sessionSwitch.hasFeature('session.window')).toBe(true)

    // 刷新失败（服务端返回错误）：不得清空已有判定。
    const refresh = adapter.refreshCapabilities()
    await flush()
    const health = socket.requestsFor('aiChat.healthCheck')
    socket.respondError(health[health.length - 1].id, 'BACKEND_ERROR', '握手失败')
    await expect(refresh).rejects.toBeTruthy()
    expect(adapter.sessionSwitch.hasFeature('session.window')).toBe(true)
  })
})
