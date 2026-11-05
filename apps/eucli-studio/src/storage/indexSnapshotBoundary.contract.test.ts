import { describe, expect, it, vi } from 'vitest'
import { createLazyChatStore } from './lazyChatStore'
import { normalizeChatIndexSnapshot } from './splitProjectionCache'
import { createTargetChatSync, type TargetChatScope } from './targetChatSync'
import {
  BOUNDARY_CHAT_ID,
  BOUNDARY_ROLE_ID,
  SECOND_ASSISTANT_MESSAGE_ID,
  SECOND_CHAT_ID,
  SECOND_USER_MESSAGE_ID,
  rawSessionDocument,
  rawSessionIndexSnapshot,
} from '../testing/boundaryFixtures'

// 边界四：索引快照 → 列表。
//
// syncTargetChats 是「索引快照 → UI 状态」的唯一入口。契约：
//   - 列表事实来自索引快照：顺序、标题、时间都按快照收敛；
//   - 快照里不存在的本地会话必须离开列表（离线删除不复活、常驻幽灵不残留）；
//   - 用户已保存的当前选中不会被服务端索引偏好覆盖；
//   - 选中会话的正文更新必须真正进入状态（新消息不消失）。

const roleScope: TargetChatScope = { kind: 'role', targetId: BOUNDARY_ROLE_ID }

function createHarness(options?: { bodies?: Record<string, any> }) {
  const state: any = {
    data: {
      chatsByRole: { [BOUNDARY_ROLE_ID]: { activeChatId: '', chatMetas: [], chats: [] } },
      chatsByGroup: {},
    },
  }
  const store = createLazyChatStore({
    storage: { get: vi.fn(async () => null), set: vi.fn(async () => {}) },
    getState: () => state,
    loadSplitMeta: vi.fn(async () => ({})),
    loadChatIndex: vi.fn(async () => null),
  })
  const reloadChatBody = vi.fn(async (_scope: any, chatId: string) => options?.bodies?.[chatId] ?? null)
  const sync = createTargetChatSync({
    getState: () => state,
    reloadChatBody,
    upsertLoadedChat: store.upsertLoadedChat,
    hasActiveRun: () => false,
  })
  return { state, sync, reloadChatBody }
}

function seedChats(state: any, chats: any[], activeChatId = '') {
  const box = state.data.chatsByRole[BOUNDARY_ROLE_ID]
  box.chats = chats
  box.chatMetas = []
  box.activeChatId = activeChatId
}

function snapshot() {
  const normalized = normalizeChatIndexSnapshot(rawSessionIndexSnapshot(), roleScope)
  if (!normalized) throw new Error('索引快照夹具无效')
  return normalized
}

describe('契约·边界四：索引快照 → 列表', () => {
  it('列表按索引快照收敛：顺序、标题来自索引，本地幽灵会话被移除', async () => {
    const { state, sync, reloadChatBody } = createHarness()
    seedChats(
      state,
      [
        { id: BOUNDARY_CHAT_ID, title: '本地旧标题 A', updatedAt: 1793460520000, messages: [] },
        { id: SECOND_CHAT_ID, title: '本地旧标题 B', updatedAt: 1793460600000, messages: [] },
        { id: 'chat-ghost', title: '幽灵会话', updatedAt: 1, messages: [] },
      ],
      BOUNDARY_CHAT_ID,
    )

    await sync.syncTargetChats(roleScope, snapshot())

    const box = state.data.chatsByRole[BOUNDARY_ROLE_ID]
    expect(box.chats.map((chat: any) => chat.id)).toEqual([SECOND_CHAT_ID, BOUNDARY_CHAT_ID])
    expect(box.chatMetas.map((meta: any) => meta.id)).toEqual([SECOND_CHAT_ID, BOUNDARY_CHAT_ID])
    expect(box.chatMetas.find((meta: any) => meta.id === SECOND_CHAT_ID)?.title).toBe('会话 B')
    expect(box.chatMetas.some((meta: any) => meta.id === 'chat-ghost')).toBe(false)
    // 本窗口用户选中的 A 是用户意图，服务端索引偏好 B 不能把它抢走。
    expect(box.activeChatId).toBe(BOUNDARY_CHAT_ID)
    // 索引时间与本地一致：后台没有新事实，不需要重复取正文。
    expect(reloadChatBody).not.toHaveBeenCalled()
  })

  it('离线期间已删除的会话不会被本地旧列表复活，选中回落服务端索引', async () => {
    const { state, sync, reloadChatBody } = createHarness()
    seedChats(
      state,
      [{ id: 'chat-offline-deleted', title: '离线删除', updatedAt: 1, messages: [] }],
      'chat-offline-deleted',
    )

    await sync.syncTargetChats(roleScope, snapshot())

    const box = state.data.chatsByRole[BOUNDARY_ROLE_ID]
    expect(box.chats.some((chat: any) => chat.id === 'chat-offline-deleted')).toBe(false)
    expect(box.chatMetas.some((meta: any) => meta.id === 'chat-offline-deleted')).toBe(false)
    expect(box.activeChatId).toBe(SECOND_CHAT_ID)
    // 索引没有这条会话：不得为了一个已删除的选中项重新取正文。
    expect(reloadChatBody).not.toHaveBeenCalled()
  })

  it('索引时间戳推进时重取权威正文，新消息与父子链进入状态', async () => {
    const { state, sync, reloadChatBody } = createHarness({
      bodies: { [BOUNDARY_CHAT_ID]: rawSessionDocument() },
    })
    seedChats(
      state,
      [{ id: BOUNDARY_CHAT_ID, title: '会话 A', updatedAt: 1, messages: [] }],
      BOUNDARY_CHAT_ID,
    )

    await sync.syncTargetChats(roleScope, snapshot())

    expect(reloadChatBody).toHaveBeenCalledWith(roleScope, BOUNDARY_CHAT_ID, { authoritative: true })
    const chat = state.data.chatsByRole[BOUNDARY_ROLE_ID].chats.find((item: any) => item.id === BOUNDARY_CHAT_ID)
    expect(chat.messages.find((message: any) => message.id === SECOND_USER_MESSAGE_ID)?.parentMid).toBe(
      'message-1793460445487972300-17745',
    )
    expect(chat.messages.find((message: any) => message.id === SECOND_ASSISTANT_MESSAGE_ID)?.parentMid).toBe(
      SECOND_USER_MESSAGE_ID,
    )
    expect(typeof chat.updatedAt).toBe('number')
    expect(state.data.chatsByRole[BOUNDARY_ROLE_ID].activeChatId).toBe(BOUNDARY_CHAT_ID)
  })
})
