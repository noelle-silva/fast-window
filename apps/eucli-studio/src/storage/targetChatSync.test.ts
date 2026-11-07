import { describe, expect, it, vi } from 'vitest'
import { createTargetChatSync, type TargetChatScope } from './targetChatSync'
import { writeChatListProjection } from '../domain/chatListProjection'
import type { ChatIndexSnapshot } from './splitProjectionCache'
import { createSessionWriteGuard } from './sessionWriteGuard'

function snapshot(revision: number, ids: string[], activeChatId = ''): ChatIndexSnapshot {
  return {
    scope: 'role:role-1',
    activeChatId,
    chatIds: ids,
    chatUpdatedAt: Object.fromEntries(ids.map((id, index) => [id, 1000 + index])),
    chatVersions: {},
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
      listAnchorAt: 1000 + index,
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
  getEpoch?: () => number
}

function makeHarness(options: HarnessOptions = {}) {
  const state = makeState()
  const sessionWrites = createSessionWriteGuard()
  const reloadChatBody = vi.fn(options.reload || (async () => options.body || null))
  const sync = createTargetChatSync({
    getState: () => state,
    reloadChatBody,
    upsertLoadedChat: (kind, targetId, chat) => {
      const box = kind === 'group' ? state.data.chatsByGroup[targetId] : state.data.chatsByRole[targetId]
      writeChatListProjection(box, { kind: 'upsert', chat, fallbackTitle: kind === 'group' ? '群聊' : '新聊天' })
      return chat
    },
    hasActiveRun: () => options.hasActiveRun === true,
    sessionWrites,
    getEpoch: options.getEpoch,
  })
  return { sync, state, reloadChatBody, sessionWrites }
}

const roleScope: TargetChatScope = { kind: 'role', targetId: 'role-1' }
const groupScope: TargetChatScope = { kind: 'group', targetId: 'group-1' }

describe('syncTargetChats', () => {
  it('列表事实来自索引：裁剪到索引里的会话，顺序以索引为准', async () => {
    const { sync, state } = makeHarness()
    writeChatListProjection(state.data.chatsByRole['role-1'], {
      kind: 'replace',
      chats: [
        { id: 'chat-2', updatedAt: 10, messages: [] },
        { id: 'chat-1', updatedAt: 10, messages: [] },
        { id: 'chat-gone', updatedAt: 10, messages: [] },
      ],
      chatMetas: [],
    })
    await sync.syncTargetChats(roleScope, snapshot(1, ['chat-1', 'chat-2'], 'chat-1'))
    expect(state.data.chatsByRole['role-1'].chats.map((chat: any) => chat.id)).toEqual(['chat-1', 'chat-2'])
    expect(state.data.chatsByRole['role-1'].activeChatId).toBe('chat-1')
  })

  // 回归：群聊对账必须重新取权威正文，而不是命中文案缓存。
  it('群聊 force 对账重新取正文（本地时间戳相同也不跳过）', async () => {
    const { sync, state, reloadChatBody } = makeHarness({
      body: { id: 'chat-1', title: '群聊会话', updatedAt: 1000, messages: [{ id: 'm1', content: '权威正文' }] },
    })
    writeChatListProjection(state.data.chatsByGroup['group-1'], {
      kind: 'replace',
      chats: [{ id: 'chat-1', updatedAt: 1000, messages: [] }],
      chatMetas: [],
    })

    await sync.syncTargetChats(groupScope, snapshot(1, ['chat-1'], 'chat-1'), { force: true })
    expect(reloadChatBody).toHaveBeenCalledWith(groupScope, 'chat-1', { authoritative: true })
    expect(state.data.chatsByGroup['group-1'].chats[0].messages[0].content).toBe('权威正文')
  })

  it('索引时间与本地不一致时以后台事实为准重取正文（不判断谁更新）', async () => {
    const { sync, state, reloadChatBody } = makeHarness({ body: { id: 'chat-1', messages: [] } })
    writeChatListProjection(state.data.chatsByRole['role-1'], {
      kind: 'replace',
      chats: [{ id: 'chat-1', updatedAt: 99999, messages: [] }],
      chatMetas: [],
    })

    await sync.syncTargetChats(roleScope, snapshot(1, ['chat-1'], 'chat-1'))
    expect(reloadChatBody).toHaveBeenCalledWith(roleScope, 'chat-1', { authoritative: true })
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
    expect(reloadChatBody).toHaveBeenCalledWith(groupScope, 'chat-1', { authoritative: true })
    expect(state.data.chatsByGroup['group-1'].chats[0].messages[0].content).toBe('新正文')
  })

  it('事件驱动的会话变更不因本地运行卡而跳过：后台落盘事实必须落地', async () => {
    const { sync, state, reloadChatBody } = makeHarness({
      hasActiveRun: true,
      body: { id: 'chat-1', updatedAt: 2, messages: [{ id: 'u1', content: '外部用户消息' }, { id: 'a1', parentMessageId: 'u1', content: '回复' }] },
    })
    expect(await sync.syncChatById(roleScope, 'chat-1')).toBe(true)
    expect(reloadChatBody).toHaveBeenCalledWith(roleScope, 'chat-1', { authoritative: true })
    expect(state.data.chatsByRole['role-1'].chats[0].messages.map((message: any) => message.id)).toEqual(['u1', 'a1'])
  })

  it('同一会话并发重取共享一次权威拉取', async () => {
    let release: (value: any) => void = () => {}
    const gate = new Promise((resolve) => { release = resolve })
    const { sync, reloadChatBody } = makeHarness({ reload: () => gate })

    const first = sync.syncChatById(roleScope, 'chat-1')
    const second = sync.syncChatById(roleScope, 'chat-1')
    release({ id: 'chat-1', updatedAt: 2, messages: [{ id: 'm1', content: '权威正文' }] })

    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(reloadChatBody).toHaveBeenCalledTimes(1)
  })

  it('正文重取期间会话被删除：旧正文不回填内存', async () => {
    let release: (value: any) => void = () => {}
    const gate = new Promise((resolve) => { release = resolve })
    const harness = makeHarness({ reload: () => gate })
    writeChatListProjection(harness.state.data.chatsByRole['role-1'], {
      kind: 'replace',
      chats: [{ id: 'chat-1', updatedAt: 1, messages: [] }],
      chatMetas: [],
    })

    const inFlight = harness.sync.syncChatById(roleScope, 'chat-1')
    harness.sessionWrites.invalidateSession('role', 'role-1', 'chat-1')
    release({ id: 'chat-1', updatedAt: 2, messages: [{ id: 'm-old', content: '旧正文' }] })

    expect(await inFlight).toBe(false)
    expect(harness.state.data.chatsByRole['role-1'].chats[0].messages).toEqual([])
  })

  it('正文重取期间连接换代：旧正文不回填内存', async () => {
    let release: (value: any) => void = () => {}
    const gate = new Promise((resolve) => { release = resolve })
    let epoch = 1
    const harness = makeHarness({ reload: () => gate, getEpoch: () => epoch })
    writeChatListProjection(harness.state.data.chatsByRole['role-1'], {
      kind: 'replace',
      chats: [{ id: 'chat-1', updatedAt: 1, messages: [] }],
      chatMetas: [],
    })

    const inFlight = harness.sync.syncChatById(roleScope, 'chat-1')
    epoch = 2
    release({ id: 'chat-1', updatedAt: 2, messages: [{ id: 'm-old', content: '旧正文' }] })

    expect(await inFlight).toBe(false)
    expect(harness.state.data.chatsByRole['role-1'].chats[0].messages).toEqual([])
  })
})
