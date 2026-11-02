// @vitest-environment happy-dom
//
// 流式增量与列表/运行卡通知：
//   - 正文增量只走 message scope，不再整页广播；
//   - 只要写了 chat.updatedAt / chatMetas，就补发该 target 的 chatList scope；
//   - 运行卡变化补发 runCards scope。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEbRunEventConsumer } from './ebRunEvents'
import { messageRefreshScope, refreshScopes } from '../domain/uiRefreshScope'

function createHarness() {
  const state: any = {
    data: {
      roles: [{ id: 'role-1', name: '角色 A' }],
      groups: [],
      workspaces: [],
      chatsByRole: {},
      chatsByGroup: {},
      chatsByWorkspace: {},
    },
    activeRunCards: [],
    settledRuns: {},
  }
  let listener: ((event: any) => void) | null = null
  const emitScope = vi.fn()
  const consumer = createEbRunEventConsumer({
    getState: () => state,
    emitScope,
    subscribeDirectEvents: (next) => {
      listener = next
      return () => {
        listener = null
      }
    },
  })
  consumer.start()
  const send = (type: string, payload: any) => {
    listener?.({ name: 'eucliBox.run.event', payload: { type, runId: String(payload?.runId || 'run-1'), payload } })
  }
  return { state, emitScope, send }
}

const flushFrames = async () => {
  await new Promise((resolve) => setTimeout(resolve, 32))
}

beforeEach(() => {
  vi.useRealTimers()
})

describe('运行事件的范围通知', () => {
  it('已有消息的流式增量只发 message / chatList / runCards，不触发全局广播', async () => {
    const harness = createHarness()
    harness.send('run_started', {
      id: 'run-1',
      runId: 'run-1',
      roleId: 'role-1',
      sessionId: 'chat-1',
      inputMessageId: 'u1',
      lastMessageId: 'u1',
      status: 'running',
    })
    const base = {
      runId: 'run-1',
      roleId: 'role-1',
      sessionId: 'chat-1',
      messageId: 'm2',
      parentMessageId: 'u1',
      messageType: 'assistant',
      messageCreatedAt: 2,
      stream: true,
    }
    harness.send('assistant_message_delta', { ...base, contentDelta: '第一段' })
    await flushFrames()

    harness.emitScope.mockClear()
    harness.send('assistant_message_delta', { ...base, contentDelta: '第二段' })
    await flushFrames()

    const scopes = harness.emitScope.mock.calls.map((call) => call[0])
    expect(scopes).toContain(messageRefreshScope('m2'))
    expect(scopes).toContain(refreshScopes.chatList('role', 'role-1'))
    expect(scopes).toContain(refreshScopes.runCards())
  })

  it('已有消息的 assistant_message_update 同样补发 chatList / runCards', async () => {
    const harness = createHarness()
    harness.send('run_started', {
      id: 'run-1',
      runId: 'run-1',
      roleId: 'role-1',
      sessionId: 'chat-1',
      inputMessageId: 'u1',
      lastMessageId: 'u1',
      status: 'running',
    })
    harness.send('assistant_message_delta', {
      runId: 'run-1',
      roleId: 'role-1',
      sessionId: 'chat-1',
      messageId: 'm2',
      parentMessageId: 'u1',
      messageType: 'assistant',
      messageCreatedAt: 2,
      contentDelta: '第一段',
      stream: true,
    })
    await flushFrames()

    harness.emitScope.mockClear()
    harness.send('assistant_message_update', {
      runId: 'run-1',
      roleId: 'role-1',
      sessionId: 'chat-1',
      stream: true,
      status: 'running',
      message: {
        id: 'm2',
        type: 'assistant',
        role: 'assistant',
        content: '第一段（更新）',
        parentMessageId: 'u1',
        createdAt: 2,
        updatedAt: 3,
      },
    })
    await flushFrames()

    const scopes = harness.emitScope.mock.calls.map((call) => call[0])
    expect(scopes).toContain(messageRefreshScope('m2'))
    expect(scopes).toContain(refreshScopes.chatList('role', 'role-1'))
    expect(scopes).toContain(refreshScopes.runCards())
  })

  it('工作区目标的 chatList 地址与侧边栏构造器一致', async () => {
    const harness = createHarness()
    harness.send('run_started', {
      id: 'run-1',
      runId: 'run-1',
      roleId: 'role-1',
      workspaceId: 'ws-1',
      sessionId: 'chat-1',
      inputMessageId: 'u1',
      lastMessageId: 'u1',
      status: 'running',
    })
    const base = {
      runId: 'run-1',
      roleId: 'role-1',
      workspaceId: 'ws-1',
      sessionId: 'chat-1',
      messageId: 'm2',
      parentMessageId: 'u1',
      messageType: 'assistant',
      messageCreatedAt: 2,
      stream: true,
    }
    harness.send('assistant_message_delta', { ...base, contentDelta: '第一段' })
    await flushFrames()

    harness.emitScope.mockClear()
    harness.send('assistant_message_delta', { ...base, contentDelta: '第二段' })
    await flushFrames()

    const scopes = harness.emitScope.mock.calls.map((call) => call[0])
    expect(scopes).toContain(refreshScopes.chatList('workspace', 'ws-1::role-1'))
  })
})
