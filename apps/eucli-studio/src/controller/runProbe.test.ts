import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RUN_PROBE_MAX_BACKOFF_MS, RUN_PROBE_SILENCE_MS, createRunProbe } from './runProbe'
import type { EbRunState } from './ebRoleRun'

function runState(overrides: Partial<EbRunState> = {}): EbRunState {
  return {
    id: 'run-1',
    roleId: 'role-1',
    groupId: '',
    workspaceId: '',
    sessionId: 'chat-1',
    inputMessageId: 'm1',
    lastMessageId: 'm1',
    dependencyMessageIds: [],
    stream: true,
    status: 'running',
    reason: '',
    retry: null,
    error: null,
    ...overrides,
  }
}

function createHarness(responses: Array<Partial<EbRunState>>) {
  const requests: any[] = []
  let call = 0
  const netRequest = vi.fn(async (req: any) => {
    requests.push(req)
    const index = Math.min(call, responses.length - 1)
    call += 1
    return { status: 200, body: runState(responses[index]) }
  })
  let eventListener: ((event: any) => void) | null = null
  let reconnectListener: (() => void) | null = null
  const probe = createRunProbe({
    netRequest,
    subscribeDirectEvents: (listener) => {
      eventListener = listener
      return () => { eventListener = null }
    },
    onReconnected: (listener) => {
      reconnectListener = listener
      return () => { reconnectListener = null }
    },
  })
  return {
    probe,
    requests,
    netRequest,
    emitEvent: (payload: any) => eventListener?.({ name: 'eucliBox.run.event', payload }),
    emitReconnect: () => reconnectListener?.(),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('RunProbe 取代 450ms 轮询', () => {
  it('静默 10s 才探一次，绝不按 450ms 发请求', async () => {
    const harness = createHarness([{ status: 'running' }, { status: 'completed' }])
    const promise = harness.probe.track(runState())
    await vi.advanceTimersByTimeAsync(449)
    expect(harness.netRequest).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(RUN_PROBE_SILENCE_MS)
    expect(harness.netRequest).toHaveBeenCalledTimes(1)

    // 第一次探针仍是 running，按退避再等 20s 才收尾。
    await vi.advanceTimersByTimeAsync(20_000)
    await expect(promise).resolves.toMatchObject({ status: 'completed' })
  })

  it('退避 10s → 20s → 40s → 60s 封顶', async () => {
    const harness = createHarness([
      { status: 'running' },
      { status: 'running' },
      { status: 'running' },
      { status: 'running' },
      { status: 'running' },
      { status: 'completed' },
    ])
    const promise = harness.probe.track(runState())

    await vi.advanceTimersByTimeAsync(RUN_PROBE_SILENCE_MS)
    expect(harness.netRequest).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(20_000)
    expect(harness.netRequest).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(40_000)
    expect(harness.netRequest).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(RUN_PROBE_MAX_BACKOFF_MS)
    expect(harness.netRequest).toHaveBeenCalledTimes(4)

    await vi.advanceTimersByTimeAsync(RUN_PROBE_MAX_BACKOFF_MS)
    expect(harness.netRequest).toHaveBeenCalledTimes(5)

    await vi.advanceTimersByTimeAsync(RUN_PROBE_MAX_BACKOFF_MS)
    await expect(promise).resolves.toMatchObject({ status: 'completed' })
  })

  it('同一 runId 最多 1 个在途探针', async () => {
    const holder: { resolve: ((value: any) => void) | null } = { resolve: null }
    const netRequest = vi.fn(() => new Promise<any>((resolve) => {
      holder.resolve = resolve
    }))
    const probe = createRunProbe({ netRequest })
    void probe.track(runState())

    await vi.advanceTimersByTimeAsync(RUN_PROBE_SILENCE_MS)
    expect(netRequest).toHaveBeenCalledTimes(1)

    // 在途期间再触发探测：必须被合流，不能并发发第二条。
    probe.probeNow('run-1')
    probe.probeAll()
    await vi.advanceTimersByTimeAsync(RUN_PROBE_SILENCE_MS)
    expect(netRequest).toHaveBeenCalledTimes(1)

    holder.resolve?.({ status: 200, body: runState({ status: 'completed' }) })
  })

  it('同一 run 被多处等待时共用探针并一起收尾', async () => {
    const harness = createHarness([{ status: 'completed' }])
    const first = harness.probe.track(runState())
    const second = harness.probe.track(runState())
    expect(harness.probe.activeCount()).toBe(1)

    harness.emitEvent({ type: 'run_completed', runId: 'run-1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.netRequest).toHaveBeenCalledTimes(1)
    await expect(first).resolves.toMatchObject({ status: 'completed' })
    await expect(second).resolves.toMatchObject({ status: 'completed' })
  })

  it('事件到达重置静默计时与退避', async () => {
    const harness = createHarness([{ status: 'running' }, { status: 'running' }, { status: 'completed' }])
    const promise = harness.probe.track(runState())

    await vi.advanceTimersByTimeAsync(9_000)
    expect(harness.netRequest).not.toHaveBeenCalled()

    // 事件到达（信封 {type, runId, payload}）：静默计时重置。
    harness.emitEvent({ type: 'assistant_message_delta', runId: 'run-1', payload: { lastMessageId: 'm2' } })
    await vi.advanceTimersByTimeAsync(9_000)
    expect(harness.netRequest).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(harness.netRequest).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(RUN_PROBE_MAX_BACKOFF_MS)
    await promise
  })

  it('终态事件触发一次权威探测并收尾', async () => {
    const harness = createHarness([{ status: 'completed' }])
    const promise = harness.probe.track(runState())

    harness.emitEvent({ type: 'run_completed', runId: 'run-1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.netRequest).toHaveBeenCalledTimes(1)
    await expect(promise).resolves.toMatchObject({ status: 'completed' })
  })

  it('重连成功立刻确认全部在途 run', async () => {
    const harness = createHarness([{ status: 'completed' }])
    const promise = harness.probe.track(runState())

    harness.emitReconnect()
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.netRequest).toHaveBeenCalledTimes(1)
    await expect(promise).resolves.toMatchObject({ status: 'completed' })
  })

  it('探针失败不判 run 失败：保留状态并继续退避', async () => {
    let call = 0
    const netRequest = vi.fn(async () => {
      call += 1
      if (call === 1) throw new Error('network down')
      return { status: 200, body: runState({ status: 'completed' }) }
    })
    const probe = createRunProbe({ netRequest })
    const promise = probe.track(runState())

    await vi.advanceTimersByTimeAsync(RUN_PROBE_SILENCE_MS)
    expect(netRequest).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(20_000)
    expect(netRequest).toHaveBeenCalledTimes(2)
    await expect(promise).resolves.toMatchObject({ status: 'completed' })
  })

  it('已终态的初始状态不产生任何请求', async () => {
    const harness = createHarness([{ status: 'completed' }])
    const promise = harness.probe.track(runState({ status: 'completed' }))
    await expect(promise).resolves.toMatchObject({ status: 'completed' })
    expect(harness.netRequest).not.toHaveBeenCalled()
  })

  it('stop 结束本地等待，不 resolve 也不 reject', async () => {
    const harness = createHarness([{ status: 'running' }])
    let settled = false
    void harness.probe.track(runState()).then(() => { settled = true }, () => { settled = true })
    await vi.advanceTimersByTimeAsync(0)

    harness.probe.stop()
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    expect(harness.probe.activeCount()).toBe(0)
  })
})
