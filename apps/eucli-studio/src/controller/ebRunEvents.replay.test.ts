// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEbRunEventConsumer } from './ebRunEvents'
import { activeEbRunCardsForTarget } from '../domain/activeRunCards'
import { ASSISTANT_RUNNING_CONTENT, isAssistantGenerating } from '../domain/assistantRunState'

// 回归：真实事件序列回放。
//
// 事件序列取自 dev 实例现场抓包（一条正常完成的消息）：
//   run_started → assistant_message_delta → model_output → assistant_message_update
//   → assistant_message_update → run_completed
//
// 其中 model_output 的载荷 id 是消息/响应编号，tool_requested 的载荷 id 是工具计划编号。
// 二者都不是运行身份。回放后必须满足：运行卡清零、终态台账只有真 runId、
// 正文完整保留。这一条测试锁死「幽灵卡」不再产生。

const runId = 'run-1793460437472526500-17741'
const modelResponseId = '01a192929b3001c78cc9db2263cbf862'
const planId = 'tool-plan-1793452072626493300-17230'
const userMessageId = 'message-1793460437483209000-17743'
const assistantMessageId = 'message-1793460445487972300-17745'

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
  const consumer = createEbRunEventConsumer({
    getState: () => state,
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
    listener?.({ name: 'eucliBox.run.event', payload: { type, runId, payload } })
  }
  return { state, consumer, send }
}

const flushFrames = async () => {
  await new Promise((resolve) => setTimeout(resolve, 32))
}

function cardsOf(harness: ReturnType<typeof createHarness>) {
  return activeEbRunCardsForTarget(harness.state, 'role', 'role-1', 'chat-1')
}

beforeEach(() => {
  vi.useRealTimers()
})

describe('真实事件序列回放', () => {
  it('模型输出与工具计划事件的载荷 id 不会生成幽灵运行卡', async () => {
    const harness = createHarness()

    harness.send('run_started', {
      id: runId,
      roleId: 'role-1',
      sessionId: 'chat-1',
      inputMessageId: userMessageId,
      lastMessageId: userMessageId,
      status: 'running',
      stream: true,
    })
    await flushFrames()
    expect(cardsOf(harness).map((card) => card.runId)).toEqual([runId])

    harness.send('assistant_message_delta', {
      runId,
      roleId: 'role-1',
      sessionId: 'chat-1',
      messageId: assistantMessageId,
      parentMessageId: userMessageId,
      messageType: 'assistant',
      messageCreatedAt: Date.now(),
      contentDelta: 'OK',
      stream: true,
    })
    // 毒源一：模型输出，载荷 id 是模型响应编号。
    harness.send('model_output', {
      id: modelResponseId,
      content: 'OK',
      reasoning: '',
    })
    // 毒源二：工具计划，载荷 id 是工具计划编号。
    harness.send('tool_requested', {
      id: planId,
      roleId: 'role-1',
      scope: { roleId: 'role-1', sessionId: 'chat-1' },
      action: { id: 'intent-1', toolName: 'shell_command' },
      planStatus: 'ready',
    })
    await flushFrames()

    // 内容事件的载荷编号绝不进入运行卡集合。
    expect(cardsOf(harness).map((card) => card.runId)).toEqual([runId])

    harness.send('assistant_message_update', {
      runId,
      roleId: 'role-1',
      sessionId: 'chat-1',
      stream: true,
      status: 'completed',
      message: {
        id: assistantMessageId,
        type: 'assistant',
        content: 'OK',
        parentMessageId: userMessageId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    })
    harness.send('run_completed', {
      id: runId,
      roleId: 'role-1',
      sessionId: 'chat-1',
      inputMessageId: userMessageId,
      lastMessageId: assistantMessageId,
      status: 'completed',
    })
    await flushFrames()

    // 终态后：无卡、台账只有真 runId、正文保留且不再生成。
    expect(cardsOf(harness)).toEqual([])
    expect(Object.keys(harness.state.settledRuns)).toEqual([runId])

    const chat = harness.state.data.chatsByRole['role-1'].chats[0]
    const message = chat.messages.find((item: any) => item.id === assistantMessageId)
    expect(message.content).toBe('OK')
    expect(message.content).not.toBe(ASSISTANT_RUNNING_CONTENT)
    expect(isAssistantGenerating(message)).toBe(false)
    expect(chat.status).toBe('completed')
  })

  it('终态先到、内容事件后到，也不会复活幽灵卡', async () => {
    const harness = createHarness()

    harness.send('run_started', {
      id: runId,
      roleId: 'role-1',
      sessionId: 'chat-1',
      inputMessageId: userMessageId,
      lastMessageId: userMessageId,
      status: 'running',
      stream: true,
    })
    harness.send('run_completed', {
      id: runId,
      roleId: 'role-1',
      sessionId: 'chat-1',
      inputMessageId: userMessageId,
      lastMessageId: assistantMessageId,
      status: 'completed',
    })
    await flushFrames()

    // 乱序到达的内容事件（含毒源载荷）。
    harness.send('model_output', { id: modelResponseId, content: 'OK' })
    harness.send('tool_requested', { id: planId, roleId: 'role-1', scope: { sessionId: 'chat-1' } })
    harness.send('assistant_message_delta', {
      runId,
      roleId: 'role-1',
      sessionId: 'chat-1',
      messageId: assistantMessageId,
      parentMessageId: userMessageId,
      messageType: 'assistant',
      messageCreatedAt: Date.now(),
      contentDelta: '迟到的片段',
    })
    await flushFrames()

    expect(cardsOf(harness)).toEqual([])
    expect(Object.keys(harness.state.settledRuns)).toEqual([runId])
  })
})
