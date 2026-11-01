import { describe, expect, it, vi } from 'vitest'
import { createTargetChatSync, type TargetChatScope } from './targetChatSync'
import { chatMetaFromChat, upsertChatMeta } from '../domain/chatMeta'
import type { ChatIndexSnapshot } from './splitProjectionCache'

function snapshot(revision: number, ids: string[], activeChatId = ''): ChatIndexSnapshot {
  return {
    scope: 'role:role-1',
    activeChatId,
    chatIds: ids,
    chatUpdatedAt: Object.fromEntries(ids.map((id, index) => [id, 1000 + index])),
    chatMetas: ids.map((id, index) => ({
      id,
      title: `会话${id}`,
      createdAt: 1000 + index,
      updatedAt: 1000 + index,
      lastMessagePreview: '',
      messageCount: 0,
      hasPending: false,
      runStatus: 'idle',
      runStatusChangedAt: 0,
    })),
    updatedAt: 5000,
    revision,
  }
}

function makeState(): any {
  return {
    activeRunCards: [],
    data: {
      chatsByRole: { 'role-1': { activeChatId: '', chatMetas: [], chats: [] } },
      chatsByGroup: { 'group-1': { activeChatId: '', chatMetas: [], chats: [] } },
    },
  }
}

type HarnessOptions = {
  body?: any
  hasActiveRun?: boolean
  reload?: (scope: TargetChatScope, chatId: string) => Promise<any>
}

function makeHarness(options: HarnessOptions = {}) {
  const state = makeState()
  const reloadChatBody = vi.fn(options.reload || (async () => options.body || null))
  const sync = createTargetChatSync({
    getState: () => state,
    reloadChatBody,
    upsertLoadedChat: (kind, targetId, chat) => {
      const box = kind === 'group' ? state.data.chatsByGroup[targetId] : state.data.chatsByRole[targetId]
      const index = box.chats.findIndex((item: any) => String(item?.id || '') === String(chat?.id || ''))
      if (index >= 0) box.chats[index] = chat
      else box.chats.push(chat)
      box.chatMetas = upsertChatMeta(box.chatMetas, chatMetaFromChat(chat, kind === 'group' ? '群聊' : '新聊天'), '新聊天')
      return chat
    },
    hasActiveRun: () => options.hasActiveRun === true,
  })
  return { sync, state, reloadChatBody }
}

const roleScope: TargetChatScope = { kind: 'role', targetId: 'role-1' }
const groupScope: TargetChatScope = { kind: 'group', targetId: 'group-1' }

describe('syncTargetChats', () => {
  it('列表事实来自索引：裁剪到索引里的会话，顺序以索引为准', async () => {
    const { sync, state } = makeHarness()
    state.data.chatsByRole['role-1'].chats = [
      { id: 'chat-2', updatedAt: 10, messages: [] },
      { id: 'chat-1', updatedAt: 10, messages: [] },
      { id: 'chat-gone', updatedAt: 10, messages: [] },
    ]
    await sync.syncTargetChats(roleScope, snapshot(1, ['chat-1', 'chat-2'], 'chat-1'))
    expect(state.data.chatsByRole['role-1'].chats.map((chat: any) => chat.id)).toEqual(['chat-1', 'chat-2'])
    expect(state.data.chatsByRole['role-1'].activeChatId).toBe('chat-1')
  })

  // 回归：群聊对账必须重新取权威正文，而不是命中文案缓存。
  it('群聊 force 对账重新取正文（本地时间戳相同也不跳过）', async () => {
    const { sync, state, reloadChatBody } = makeHarness({
      body: { id: 'chat-1', title: '群聊会话', updatedAt: 1000, messages: [{ id: 'm1', content: '权威正文' }] },
    })
    state.data.chatsByGroup['group-1'].chats = [{ id: 'chat-1', updatedAt: 1000, messages: [] }]

    await sync.syncTargetChats(groupScope, snapshot(1, ['chat-1'], 'chat-1'), { force: true })
    expect(reloadChatBody).toHaveBeenCalledWith(groupScope, 'chat-1')
    expect(state.data.chatsByGroup['group-1'].chats[0].messages[0].content).toBe('权威正文')
  })

  it('非 force 且索引时间戳没有更新时不重取正文', async () => {
    const { sync, state, reloadChatBody } = makeHarness({ body: { id: 'chat-1', messages: [] } })
    state.data.chatsByRole['role-1'].chats = [{ id: 'chat-1', updatedAt: 99999, messages: [] }]

    await sync.syncTargetChats(roleScope, snapshot(1, ['chat-1'], 'chat-1'))
    expect(reloadChatBody).not.toHaveBeenCalled()
  })

  it('运行中的会话不被对账覆盖', async () => {
    const { sync, reloadChatBody } = makeHarness({ hasActiveRun: true, body: { id: 'chat-1', messages: [] } })
    await sync.syncTargetChats(roleScope, snapshot(1, ['chat-1'], 'chat-1'), { force: true })
    expect(reloadChatBody).not.toHaveBeenCalled()
  })

  it('同一 scope 并发对账：第二次被挡下并返回 false（调用方不推进版本门）', async () => {
    let release: (value: any) => void = () => {}
    const gate = new Promise((resolve) => { release = resolve })
    const { sync } = makeHarness({ reload: () => gate })

    const first = sync.syncTargetChats(roleScope, snapshot(1, ['chat-1'], 'chat-1'), { force: true })
    const second = await sync.syncTargetChats(roleScope, snapshot(1, ['chat-1'], 'chat-1'), { force: true })
    expect(second).toBe(false)

    release({ id: 'chat-1', messages: [] })
    expect(await first).toBe(true)
  })
})

describe('syncChatById', () => {
  it('角色 / 群聊共用同一实现，都走权威正文重取', async () => {
    const { sync, state, reloadChatBody } = makeHarness({
      body: { id: 'chat-1', title: '会话', updatedAt: 1, messages: [{ id: 'm1', content: '新正文' }] },
    })
    await sync.syncChatById(groupScope, 'chat-1')
    expect(reloadChatBody).toHaveBeenCalledWith(groupScope, 'chat-1')
    expect(state.data.chatsByGroup['group-1'].chats[0].messages[0].content).toBe('新正文')
  })

  it('运行中的会话不重取', async () => {
    const { sync, reloadChatBody } = makeHarness({ hasActiveRun: true, body: { id: 'chat-1', messages: [] } })
    expect(await sync.syncChatById(roleScope, 'chat-1')).toBe(false)
    expect(reloadChatBody).not.toHaveBeenCalled()
  })
})
