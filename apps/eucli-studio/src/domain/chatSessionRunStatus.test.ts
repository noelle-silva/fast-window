import { describe, expect, it } from 'vitest'
import { registerEbRoleRunCard } from './activeRunCards'
import {
  chatSessionRunSummaryFromChat,
  readChatRunStatus,
  resolveChatRunStatusFact,
  resolveFirstTerminalStatusFact,
  writeChatRunStatus,
} from './chatSessionRunStatus'

function createState(): any {
  return {
    data: {},
    activeRunCards: [],
    settledRuns: {},
  }
}

const roleTarget = { targetKind: 'role' as const, targetId: 'role-1' }

function registerCard(state: any, patch: Record<string, unknown> = {}) {
  return registerEbRoleRunCard(state, {
    runId: 'run-1',
    roleId: 'role-1',
    sessionId: 'chat-1',
    status: 'running',
    ...patch,
  })
}

describe('chat.status 唯一写入口', () => {
  it('有活动运行卡时以卡片状态为准，忽略调用方的收尾状态', () => {
    const state = createState()
    registerCard(state, { status: 'queued' })
    const chat: any = { id: 'chat-1' }

    expect(writeChatRunStatus(state, chat, { fallbackStatus: 'completed', target: roleTarget })).toBe(true)
    expect(chat.status).toBe('queued')
  })

  it('没有活动运行卡时以调用方给出的权威状态收口', () => {
    const state = createState()
    const chat: any = { id: 'chat-1', status: 'running' }

    expect(writeChatRunStatus(state, chat, { fallbackStatus: 'completed', target: roleTarget })).toBe(true)
    expect(chat.status).toBe('completed')
  })

  it('状态没有变化时是幂等空操作', () => {
    const state = createState()
    const chat: any = { id: 'chat-1', status: 'running' }

    expect(writeChatRunStatus(state, chat, { fallbackStatus: 'running', target: roleTarget })).toBe(false)
    expect(chat.status).toBe('running')
  })

  it('没有目标范围时按会话 id 过滤活动卡', () => {
    const state = createState()
    registerCard(state, { status: 'waiting_confirmation', sessionId: 'chat-1' })
    registerCard(state, { runId: 'run-2', status: 'completed', sessionId: 'chat-2' })
    const chat: any = { id: 'chat-1' }

    expect(writeChatRunStatus(state, chat, { fallbackStatus: 'completed' })).toBe(true)
    expect(chat.status).toBe('waiting_confirmation')
  })

  it('缺少会话 id 或权威状态时不写入', () => {
    const state = createState()
    const withoutId: any = {}
    const chat: any = { id: 'chat-1' }

    expect(writeChatRunStatus(state, withoutId, { fallbackStatus: 'completed' })).toBe(false)
    expect(writeChatRunStatus(state, chat, { target: roleTarget })).toBe(false)
    expect(chat.status).toBeUndefined()
  })
})

describe('会话运行状态读取投影', () => {
  it('只认 chat.status，不再从消息的 assistantRun 二次推导', () => {
    const chat: any = {
      id: 'chat-1',
      status: 'idle',
      updatedAt: 100,
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: '完成',
          assistantRun: { generationId: 'run-1', status: 'succeeded', startedAt: 1, updatedAt: 2, finishedAt: 2 },
        },
      ],
    }

    expect(chatSessionRunSummaryFromChat(chat)).toEqual({ status: 'idle', changedAt: 100 })
  })

  it('把存储的原始状态映射为列表四态', () => {
    expect(chatSessionRunSummaryFromChat({ id: 'chat-1', status: 'waiting_confirmation' }).status).toBe('running')
    expect(chatSessionRunSummaryFromChat({ id: 'chat-1', status: 'completed' }).status).toBe('completed')
    expect(chatSessionRunSummaryFromChat({ id: 'chat-1', status: 'failed' }).status).toBe('interrupted')
    expect(chatSessionRunSummaryFromChat({ id: 'chat-1' }).status).toBe('idle')
  })

  it('读取语义统一做空白归一化', () => {
    expect(readChatRunStatus({ status: '  running  ' })).toBe('running')
    expect(readChatRunStatus(undefined)).toBe('')
  })
})

describe('chat.status 事实优先级', () => {
  it('运行期临时态压过服务端终态与本地旧值', () => {
    expect(resolveChatRunStatusFact({
      runtimeTransient: 'running',
      serverFact: 'completed',
      localProjection: 'idle',
    })).toBe('running')
  })

  it('没有运行期临时态时以服务端事实为准', () => {
    expect(resolveChatRunStatusFact({
      serverFact: 'failed',
      localProjection: 'running',
    })).toBe('failed')
  })

  it('所有来源为空时返回空串，不写兜底状态', () => {
    expect(resolveChatRunStatusFact({})).toBe('')
  })

  it('同一条 run 的第一条终态压过后到的不同措辞', () => {
    expect(resolveFirstTerminalStatusFact('completed', 'failed')).toBe('completed')
    expect(resolveFirstTerminalStatusFact('', 'failed')).toBe('failed')
    expect(resolveFirstTerminalStatusFact('', '')).toBe('')
  })
})
