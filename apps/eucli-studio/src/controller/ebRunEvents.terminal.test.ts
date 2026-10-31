// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEbRunEventConsumer } from './ebRunEvents'
import { activeEbRunCardsForTarget } from '../domain/activeRunCards'
import { ASSISTANT_RUNNING_CONTENT, isAssistantGenerating } from '../domain/assistantRunState'

// 回归：真实事件链路上的终态收敛。
//
// 现场故障：AI 回复完成后停止按钮不消失、回复消失、只剩一直旋转的占位。
// 事件队列只按「顶层 type」判定终态，`assistant_message_update` 不属于终态事件，
// 背压下允许被丢弃。因此终态事件本身必须同时收敛 run 卡与该消息的生成标记，
// 不能依赖后续 update 事件。

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
  }
  let listener: ((event: any) => void) | null = null
  const emit = vi.fn()
  const consumer = createEbRunEventConsumer({
    getState: () => state,
    emit,
    emitScope: () => {},
    subscribeDirectEvents: (next) => {
      listener = next
      return () => {
        listener = null
      }
    },
  })
  consumer.start()
  const send = (type: string, payload: any) => {
    listener?.({ name: 'eucliBox.run.event', payload: { type, runId: payload?.runId || 'run-1', payload } })
  }
  return { state, emit, consumer, send }
}

const flushFrames = async () => {
  await new Promise((resolve) => setTimeout(resolve, 32))
}

beforeEach(() => {
  vi.useRealTimers()
})

describe('事件链路的运行终态收敛', () => {
  it('终态事件同时摘卡并关闭消息生成标记（不依赖 update 事件）', async () => {
    const harness = createHarness()
    harness.send('run_started', {
      id: 'run-1',
      runId: 'run-1',
      roleId: 'role-1',
      sessionId: 'chat-1',
      inputMessageId: 'u1',
      lastMessageId: 'u1',
      status: 'running',
      stream: true,
    })
    harness.send('assistant_message_delta', {
      runId: 'run-1',
      roleId: 'role-1',
      sessionId: 'chat-1',
      messageId: 'm2',
      parentMessageId: 'u1',
      messageType: 'assistant',
      messageCreatedAt: 2,
      contentDelta: '完整回复',
      stream: true,
    })
    await flushFrames()

    const chat = harness.state.data.chatsByRole['role-1'].chats[0]
    const message = chat.messages.find((m: any) => m.id === 'm2')
    expect(isAssistantGenerating(message)).toBe(true)
    expect(activeEbRunCardsForTarget(harness.state, 'role', 'role-1', 'chat-1')).toHaveLength(1)

    // 只有终态事件；没有后续 assistant_message_update。
    harness.send('run_completed', {
      id: 'run-1',
      runId: 'run-1',
      roleId: 'role-1',
      sessionId: 'chat-1',
      inputMessageId: 'u1',
      lastMessageId: 'm2',
      status: 'completed',
    })
    await flushFrames()

    expect(activeEbRunCardsForTarget(harness.state, 'role', 'role-1', 'chat-1')).toHaveLength(0)
    expect(isAssistantGenerating(message)).toBe(false)
    expect(message.content).toBe('完整回复')
  })

  it('终态之后迟到的运行中事件不会复活卡片或消息', async () => {
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
      contentDelta: '完整回复',
    })
    harness.send('run_completed', {
      id: 'run-1',
      runId: 'run-1',
      roleId: 'role-1',
      sessionId: 'chat-1',
      lastMessageId: 'm2',
      status: 'completed',
    })
    await flushFrames()

    // 背压后重放 / 乱序到达的旧事件。
    harness.send('run_started', {
      id: 'run-1',
      runId: 'run-1',
      roleId: 'role-1',
      sessionId: 'chat-1',
      lastMessageId: 'm2',
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
      contentDelta: '迟到的片段',
    })
    await flushFrames()

    expect(activeEbRunCardsForTarget(harness.state, 'role', 'role-1', 'chat-1')).toHaveLength(0)
    const chat = harness.state.data.chatsByRole['role-1'].chats[0]
    const message = chat.messages.find((m: any) => m.id === 'm2')
    expect(isAssistantGenerating(message)).toBe(false)
    expect(message.content).not.toContain('迟到的片段')
  })

  it('占位文案不会成为最终正文', async () => {
    const harness = createHarness()
    harness.send('assistant_message_delta', {
      runId: 'run-1',
      roleId: 'role-1',
      sessionId: 'chat-1',
      messageId: 'm2',
      parentMessageId: 'u1',
      messageType: 'assistant',
      messageCreatedAt: 2,
    })
    harness.send('run_completed', {
      id: 'run-1',
      runId: 'run-1',
      roleId: 'role-1',
      sessionId: 'chat-1',
      lastMessageId: 'm2',
      status: 'completed',
    })
    await flushFrames()

    const chat = harness.state.data.chatsByRole['role-1'].chats[0]
    const message = chat.messages.find((m: any) => m.id === 'm2')
    expect(message.content).not.toBe(ASSISTANT_RUNNING_CONTENT)
    expect(isAssistantGenerating(message)).toBe(false)
  })
})
