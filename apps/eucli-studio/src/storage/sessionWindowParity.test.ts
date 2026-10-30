import { describe, expect, it } from 'vitest'
import { createSessionWindowLoader, mergeWindowPage, SESSION_WINDOW_DEFAULT_LIMIT } from './sessionWindowLoader'
import { buildSessionMessages, fixtureByName, messageId } from './switchFixtures'
import type { SessionScope, SessionSwitchClient } from '../protocol/sessionSwitchProtocol'

// parity 测试（design-4 P0 验收项：parity.diff = 0）。
//
// 同一份会话，两条路径：
//   旧：整份会话（一次拿完）
//   新：窗口分页（首窗 + 反复 loadOlder）
// 拼出来的消息集合必须**完全一致**（id 序列与内容都一致）。
//
// 这不是「差不多就行」：分页只要漏一条或多一条，树视图与首屏就会分叉。

const scope: SessionScope = { kind: 'role', targetId: 'role-1' }

function windowClient(fullMessages: any[], pageSize: number): SessionSwitchClient {
  // 模拟业务端的窗口语义：从最新往回切，head 必含，cursor 指向前一窗的锚点。
  return {
    healthCheckFeatures: ['session.window'],
    hasFeature: (feature: string) => feature === 'session.window',
    sessionIndexGet: async () => {
      throw new Error('未使用')
    },
    sessionSummaryList: async () => {
      throw new Error('未使用')
    },
    sessionGet: async () => {
      throw new Error('未使用')
    },
    sessionGraph: async () => {
      throw new Error('未使用')
    },
    setSessionView: async () => ({}),
    setActiveChat: async () => ({ applied: true, preferenceRevision: 1, activeChatId: '' }),
    sessionWindow: async (_scope: any, chatId: string, options: any) => {
      if (options?.cursor) {
        const cursorIndex = fullMessages.findIndex((message) => message.id === options.cursor)
        const start = Math.max(0, cursorIndex - pageSize)
        const page = fullMessages.slice(start, cursorIndex)
        return { id: chatId, messages: page, nextCursor: start > 0 ? fullMessages[start].id : '' }
      }
      const start = Math.max(0, fullMessages.length - pageSize)
      const page = fullMessages.slice(start)
      return { id: chatId, messages: page, nextCursor: start > 0 ? fullMessages[start].id : '' }
    },
  } as any
}

async function loadAllViaWindow(client: SessionSwitchClient, chatId: string, maxPages = 500) {
  const loader = createSessionWindowLoader({ sessionSwitch: client })
  let chat = await loader.load(scope, chatId)
  for (let page = 0; page < maxPages; page++) {
    const before = Array.isArray(chat?.messages) ? chat.messages.length : 0
    const next = await loader.loadOlder(scope, chatId)
    const after = Array.isArray(next?.messages) ? next.messages.length : before
    chat = next || chat
    if (after <= before) break
  }
  return chat
}

describe('parity：整份会话 vs 窗口分页', () => {
  it('长会话（600 条）分页拼装与整份完全一致', async () => {
    const fixture = fixtureByName('long-session')
    const full = buildSessionMessages(fixture, 0, 0)
    const client = windowClient(full, SESSION_WINDOW_DEFAULT_LIMIT)

    const paged = await loadAllViaWindow(client, 'chat-1')

    expect(paged.messages.map((m: any) => m.id)).toEqual(full.map((m: any) => m.id))
    expect(paged.messages.map((m: any) => m.content)).toEqual(full.map((m: any) => m.content))
  })

  it('短会话（少于 limit）一次加载即完整，且包含无父根消息', async () => {
    const fixture = fixtureByName('many-roles')
    const full = buildSessionMessages(fixture, 0, 0) // 12 条 < 24
    const client = windowClient(full, SESSION_WINDOW_DEFAULT_LIMIT)

    const paged = await loadAllViaWindow(client, 'chat-1')

    expect(paged.messages).toHaveLength(full.length)
    expect(paged.messages[0].id).toBe(messageId(0, 0, 0))
    // 根消息必须无父（契约允许），且必须被包含。
    expect(paged.messages[0].parentMessageId).toBe('')
  })

  it('同一 createdAt 的会话排序与整份一致（(createdAt,id) 稳定）', async () => {
    const fixture = fixtureByName('same-timestamp')
    const full = buildSessionMessages(fixture, 0, 0)
    const client = windowClient(full, SESSION_WINDOW_DEFAULT_LIMIT)

    const paged = await loadAllViaWindow(client, 'chat-1')

    expect(paged.messages.map((m: any) => m.id)).toEqual(full.map((m: any) => m.id))
  })

  it('分页边界不产生重复消息', async () => {
    const fixture = fixtureByName('long-session')
    const full = buildSessionMessages(fixture, 0, 0)
    const client = windowClient(full, 7) // 故意用非 24 的页长

    const paged = await loadAllViaWindow(client, 'chat-1')

    const ids = paged.messages.map((m: any) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('不同页长得到同一份结果（页长不影响正确性）', async () => {
    const fixture = fixtureByName('long-session')
    const full = buildSessionMessages(fixture, 0, 0)

    const results: string[][] = []
    for (const pageSize of [5, 17, 24, 100]) {
      const paged = await loadAllViaWindow(windowClient(full, pageSize), 'chat-1')
      results.push(paged.messages.map((m: any) => m.id))
    }

    for (const ids of results) expect(ids).toEqual(results[0])
  })

  it('mergeWindowPage 对同一批消息幂等（重复合并不变）', () => {
    const fixture = fixtureByName('many-roles')
    const full = buildSessionMessages(fixture, 0, 0)
    const once = mergeWindowPage({ messages: [] }, { messages: full })
    const twice = mergeWindowPage(once, { messages: full })
    expect(twice.messages.map((m: any) => m.id)).toEqual(once.messages.map((m: any) => m.id))
  })
})
