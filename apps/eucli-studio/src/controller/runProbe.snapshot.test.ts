import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRunProbe } from './runProbe'
import type { EbRunState } from './ebRoleRun'

// 回归：探针只允许把「自证身份的运行状态快照」合并进运行状态。
//
// 现场故障：探针把任意事件载荷整包展开进运行状态，`model_output`（载荷 id 是消息 id）
// 与 `tool_requested`（载荷 id 是工具计划 id）因此把运行 id 覆盖成别人的编号，
// 运行卡被建成幽灵卡，真实终态销不掉，停止按钮与占位永久残留。

const runId = 'run-1793460437472526500-17741'
const messageId = '01a192929b3001c78cc9db2263cbf862'
const planId = 'tool-plan-1793452072626493300-17230'

function runState(overrides: Partial<EbRunState> = {}): EbRunState {
  return {
    id: runId,
    roleId: 'role-1',
    groupId: '',
    workspaceId: '',
    sessionId: 'chat-1',
    inputMessageId: 'u1',
    lastMessageId: 'u1',
    dependencyMessageIds: [],
    stream: true,
    status: 'running',
    reason: '',
    retry: null,
    error: null,
    ...overrides,
  }
}

function createHarness() {
  const netRequest = vi.fn(async () => ({ status: 200, body: runState({ status: 'completed' }) }))
  let eventListener: ((event: any) => void) | null = null
  const probe = createRunProbe({
    netRequest,
    subscribeDirectEvents: (listener) => {
      eventListener = listener
      return () => {
        eventListener = null
      }
    },
  })
  const emit = (raw: any) => eventListener?.({ name: 'eucliBox.run.event', payload: raw })
  return { probe, netRequest, emit }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('RunProbe 只合并自证身份的状态快照', () => {
  it('model_output 的消息 id 不会污染运行身份', async () => {
    const harness = createHarness()
    const seen: EbRunState[] = []
    void harness.probe.track(runState(), (next) => seen.push(next))

    harness.emit({ type: 'model_output', runId, payload: { id: messageId, content: '回复正文' } })
    await vi.advanceTimersByTimeAsync(0)

    for (const state of seen) {
      expect(state.id).toBe(runId)
      expect(state.lastMessageId).toBe('u1')
      expect(state.status).toBe('running')
    }
    // 内容事件没有状态快照：一次 onUpdate 都不该产生。
    expect(seen).toHaveLength(0)
  })

  it('tool_requested 的工具计划 id 不会污染运行身份', async () => {
    const harness = createHarness()
    const seen: EbRunState[] = []
    void harness.probe.track(runState(), (next) => seen.push(next))

    harness.emit({ type: 'tool_requested', runId, payload: { id: planId, roleId: 'role-1', scope: { sessionId: 'chat-1' } } })
    await vi.advanceTimersByTimeAsync(0)

    expect(seen).toHaveLength(0)
  })

  it('run_started 的自证快照照常合并', async () => {
    const harness = createHarness()
    const seen: EbRunState[] = []
    void harness.probe.track(runState({ lastMessageId: 'u1' }), (next) => seen.push(next))

    harness.emit({
      type: 'run_started',
      runId,
      payload: { id: runId, roleId: 'role-1', sessionId: 'chat-1', inputMessageId: 'u1', lastMessageId: 'm2', status: 'running', stream: true },
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(seen).toHaveLength(1)
    expect(seen[0].id).toBe(runId)
    expect(seen[0].lastMessageId).toBe('m2')
  })

  it('终态事件仍然触发权威探测并收尾', async () => {
    const harness = createHarness()
    const promise = harness.probe.track(runState())

    harness.emit({ type: 'run_completed', runId, payload: { id: runId, status: 'completed', roleId: 'role-1', sessionId: 'chat-1', lastMessageId: 'm2' } })
    await vi.advanceTimersByTimeAsync(0)

    await expect(promise).resolves.toMatchObject({ id: runId, status: 'completed' })
    expect(harness.netRequest).toHaveBeenCalledTimes(1)
  })
})
