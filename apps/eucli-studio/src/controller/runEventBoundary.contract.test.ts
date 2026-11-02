// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { createEbRunEventConsumer } from './ebRunEvents'
import { activeEbRunCardsForTarget } from '../domain/activeRunCards'
import { ASSISTANT_RUNNING_CONTENT, isAssistantGenerating } from '../domain/assistantRunState'
import { activeBranchHeadMid } from '../domain/branching'
import {
  ASSISTANT_MESSAGE_ID,
  BOUNDARY_CHAT_ID,
  BOUNDARY_ROLE_ID,
  RUN_ID,
  USER_MESSAGE_ID,
  realRunEventSequence,
} from '../testing/boundaryFixtures'

// 边界三：事件 → 投影。
//
// applyRunEvent 是事件分发的唯一入口。契约：
//   - 运行身份只来自信封 runId；model_output / tool_requested 的载荷 id
//     不能生成幽灵运行卡；
//   - 终态事件本身就是收敛点：摘卡、关掉消息生成标记、保留最终正文，
//     不依赖后续 update；
//   - 终态之后迟到的运行中事件不能复活卡片、不能追加正文、不能回退分支头。

function createHarness() {
  const state: any = {
    data: {
      roles: [{ id: BOUNDARY_ROLE_ID, name: '角色 A' }],
      groups: [],
      workspaces: [],
      chatsByRole: {},
      chatsByGroup: {},
      chatsByWorkspace: {},
    },
    activeRunCards: [],
    settledRuns: {},
  }
  const consumer = createEbRunEventConsumer({
    getState: () => state,
    emit: vi.fn(),
    emitScope: () => {},
  })
  return { state, consumer }
}

function cardsOf(state: any) {
  return activeEbRunCardsForTarget(state, 'role', BOUNDARY_ROLE_ID, BOUNDARY_CHAT_ID)
}

function chatOf(state: any) {
  return state.data.chatsByRole[BOUNDARY_ROLE_ID].chats[0]
}

function messageOf(state: any, messageId: string) {
  return chatOf(state).messages.find((message: any) => message.id === messageId)
}

describe('契约·边界三：事件 → 投影', () => {
  it('真实事件序列回放：载荷 id 不生成幽灵卡，终态收敛正文与分支头', () => {
    const { state, consumer } = createHarness()

    for (const event of realRunEventSequence()) consumer.applyRunEvent(event)

    expect(cardsOf(state)).toEqual([])
    expect(Object.keys(state.settledRuns)).toEqual([RUN_ID])

    const message = messageOf(state, ASSISTANT_MESSAGE_ID)
    expect(message?.content).toBe('OK')
    expect(message?.content).not.toBe(ASSISTANT_RUNNING_CONTENT)
    expect(isAssistantGenerating(message)).toBe(false)
    expect(chatOf(state).status).toBe('completed')
    expect(activeBranchHeadMid(chatOf(state))).toBe(ASSISTANT_MESSAGE_ID)

    consumer.stop()
  })

  it('只有终态事件、没有后续 update 时，最终正文不丢失且生成标记关闭', () => {
    const { state, consumer } = createHarness()
    const withoutUpdate = realRunEventSequence().filter((event) => event.type !== 'assistant_message_update')

    for (const event of withoutUpdate) consumer.applyRunEvent(event)

    expect(cardsOf(state)).toEqual([])
    expect(Object.keys(state.settledRuns)).toEqual([RUN_ID])

    const message = messageOf(state, ASSISTANT_MESSAGE_ID)
    expect(message?.content).toBe('OK')
    expect(message?.content).not.toBe(ASSISTANT_RUNNING_CONTENT)
    expect(isAssistantGenerating(message)).toBe(false)
    expect(chatOf(state).status).toBe('completed')

    consumer.stop()
  })

  it('终态之后迟到的运行中事件不会复活卡片、追加正文或回退分支头', () => {
    const { state, consumer } = createHarness()
    for (const event of realRunEventSequence()) consumer.applyRunEvent(event)

    const headBefore = activeBranchHeadMid(chatOf(state))
    const contentBefore = messageOf(state, ASSISTANT_MESSAGE_ID)?.content

    // 背压后重放 / 乱序到达的旧事件。
    consumer.applyRunEvent({
      id: '',
      runId: RUN_ID,
      type: 'run_started',
      payload: {
        id: RUN_ID,
        roleId: BOUNDARY_ROLE_ID,
        sessionId: BOUNDARY_CHAT_ID,
        inputMessageId: USER_MESSAGE_ID,
        lastMessageId: ASSISTANT_MESSAGE_ID,
        status: 'running',
      },
    })
    consumer.applyRunEvent({
      id: '',
      runId: RUN_ID,
      type: 'run_retrying',
      payload: {
        id: RUN_ID,
        roleId: BOUNDARY_ROLE_ID,
        sessionId: BOUNDARY_CHAT_ID,
        lastMessageId: ASSISTANT_MESSAGE_ID,
        status: 'running',
      },
    })
    consumer.applyRunEvent({
      id: '',
      runId: RUN_ID,
      type: 'assistant_message_delta',
      payload: {
        runId: RUN_ID,
        roleId: BOUNDARY_ROLE_ID,
        sessionId: BOUNDARY_CHAT_ID,
        messageId: ASSISTANT_MESSAGE_ID,
        parentMessageId: USER_MESSAGE_ID,
        messageType: 'assistant',
        messageCreatedAt: 1793460500000,
        contentDelta: '迟到的片段',
      },
    })

    expect(cardsOf(state)).toEqual([])
    expect(Object.keys(state.settledRuns)).toEqual([RUN_ID])
    expect(messageOf(state, ASSISTANT_MESSAGE_ID)?.content).toBe(contentBefore)
    expect(activeBranchHeadMid(chatOf(state))).toBe(headBefore)

    consumer.stop()
  })
})
