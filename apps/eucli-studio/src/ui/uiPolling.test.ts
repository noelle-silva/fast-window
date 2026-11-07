import { describe, expect, it, vi } from 'vitest'
import { createUiPolling } from './uiPolling'
import { createIndexRevisionGate } from './indexRevisionGate'
import { writeChatListProjection } from '../domain/chatListProjection'
import { projectionScopeKey, type ChatIndexSnapshot, type ProjectionScope } from '../storage/splitProjectionCache'
import { writeActiveChatSelection } from '../domain/activeChatSelection'
import { AI_CHAT_DIRECT_EVENT } from '../protocol/aiChatProtocol'

function snapshot(
  revision: number,
  ids: string[],
  activeChatId = '',
  scopeKey = 'role:role-1',
  versions: Record<string, number> = {},
): ChatIndexSnapshot {
  return {
    scope: scopeKey,
    activeChatId,
    chatIds: ids,
    chatUpdatedAt: Object.fromEntries(ids.map((id, index) => [id, 1000 + index])),
    chatVersions: versions,
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

function makeState(kind: 'role' | 'group' = 'role'): any {
  return {
    loading: false,
    data: {
      ui: { activeRoleId: 'role-1', activeTargetKind: kind, activeGroupId: kind === 'group' ? 'group-1' : '', activeWorkspaceId: '' },
      roles: [],
      chatsByRole: { 'role-1': { activeChatId: '', chatMetas: [], chats: [] } },
      groups: [],
      chatsByGroup: kind === 'group' ? { 'group-1': { activeChatId: '', chatMetas: [], chats: [] } } : {},
    },
    draft: {
      activeRoleId: 'role-1',
      activeGroupId: kind === 'group' ? 'group-1' : '',
      activeWorkspaceId: '',
      activeTargetKind: kind,
    },
  }
}

function upsertIntoState(state: any, kind: 'role' | 'group', targetId: string, chat: any) {
  const root = kind === 'group' ? 'chatsByGroup' : 'chatsByRole'
  const box = (state.data[root][targetId] ||= { activeChatId: '', chatMetas: [], chats: [] })
  writeChatListProjection(box, { kind: 'upsert', chat, fallbackTitle: kind === 'group' ? '群聊' : '新聊天' })
  return chat
}

type HarnessOptions = {
  kind?: 'role' | 'group'
  revisions: number[]
  ids?: string[]
  // 索引摘要携带的会话版本：断线恢复只比较它，不猜时间。
  versions?: Record<string, number>
  // 每次 refresh 之后 epoch 取这个函数的值（模拟服务端换代）。
  epoch?: () => number
  bodies?: Record<string, any>
  onReconnected?: (listener: () => void) => () => void
  emitOnSubscribe?: (listener: (event: any) => void) => void
  isChatIndexSnapshotCurrent?: (scope: ProjectionScope, snapshot: ChatIndexSnapshot | null) => boolean
}

function makeHarness(options: HarnessOptions) {
  const kind = options.kind || 'role'
  const targetId = kind === 'group' ? 'group-1' : 'role-1'
  const scope: ProjectionScope = { kind, targetId }
  const scopeKey = projectionScopeKey(scope)
  const state = makeState(kind)
  let call = 0
  const refreshChatIndex = vi.fn(async () => {
    const revision = options.revisions[Math.min(call, options.revisions.length - 1)]
    call += 1
    return snapshot(revision, options.ids || ['chat-1', 'chat-2'], 'chat-1', scopeKey, options.versions || {})
  })
  const reloadChatBody = vi.fn(async (requested: ProjectionScope, chatId: string) => {
    const body = options.bodies?.[chatId]
    if (!body) return null
    return { ...body, id: chatId }
  })
  const upsertLoadedChat = vi.fn((loadedKind: 'role' | 'group', tid: string, chat: any) => upsertIntoState(state, loadedKind, tid, chat))
  const emit = vi.fn()
  const polling = createUiPolling({
    getState: () => state,
    emitScope: emit,
    subscribeDirectEvents: (listener) => {
      options.emitOnSubscribe?.(listener)
      return () => {}
    },
    onReconnected: options.onReconnected,
    activeTargetKind: () => kind,
    activeChatFromData: () => {
      const root = kind === 'group' ? 'chatsByGroup' : 'chatsByRole'
      const box = (state.data as any)[root][targetId]
      const id = String(box?.activeChatId || '')
      return box?.chats?.find((item: any) => String(item?.id || '') === id) || null
    },
    refreshChatIndex,
    isChatIndexSnapshotCurrent: options.isChatIndexSnapshotCurrent,
    reloadChatBody,
    upsertLoadedChat,
    syncWorkspaceChatById: vi.fn(async () => false),
    refreshWorkspaceChats: vi.fn(async () => null),
    getEpoch: options.epoch,
  })
  return { polling, state, scope, emit, refreshChatIndex, reloadChatBody, upsertLoadedChat }
}

describe('uiPolling 版本门', () => {
  it('不再创建定时器：startUiPollers 后空闲不产生任何请求', async () => {
    const { polling, refreshChatIndex } = makeHarness({ revisions: [7] })
    polling.startUiPollers()
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(refreshChatIndex).not.toHaveBeenCalled()
    polling.stopUiPollers()
  })

  it('revision 未变时不重算、不 emit', async () => {
    const { polling, emit } = makeHarness({ revisions: [7, 7, 7] })
    await polling.uiPollTick()
    emit.mockClear()

    await polling.uiPollTick()
    await polling.uiPollTick()
    expect(emit).not.toHaveBeenCalled()
  })

  it('读取期间失效的旧索引快照不驱动对账、不推进版本门', async () => {
    const { polling, state, emit, upsertLoadedChat } = makeHarness({
      revisions: [7, 7],
      ids: ['chat-stale'],
      isChatIndexSnapshotCurrent: () => false,
    })
    await polling.uiPollTick()
    expect(upsertLoadedChat).not.toHaveBeenCalled()
    expect(state.data.chatsByRole['role-1'].chatMetas).toEqual([])
    expect(emit).not.toHaveBeenCalled()
  })

  it('revision 变化时按 target/session 通知，不广播 global', async () => {
    const { polling, emit } = makeHarness({ revisions: [7, 8, 8] })
    await polling.uiPollTick()
    emit.mockClear()

    await polling.uiPollTick()
    const scopes = emit.mock.calls.map((call: any[]) => call[0])
    expect(scopes).toContain('chatList:role:role-1')
    expect(scopes).toContain('session:role:role-1:chat-1')
    expect(scopes).not.toContain('global')
    const count = emit.mock.calls.length
    await polling.uiPollTick()
    expect(emit).toHaveBeenCalledTimes(count)
  })

  it('同步后本地会话列表来自索引快照（而非 meta）', async () => {
    const { polling, state } = makeHarness({ revisions: [3], ids: ['chat-a', 'chat-b'] })
    await polling.uiPollTick()
    expect(state.data.chatsByRole['role-1'].chatMetas.map((meta: any) => meta.id)).toEqual(['chat-a', 'chat-b'])
    expect(state.data.chatsByRole['role-1'].activeChatId).toBe('chat-a')
  })

  it('版本门必须绕过缓存：每次都调用 refreshChatIndex', async () => {
    const { polling, refreshChatIndex } = makeHarness({ revisions: [9, 9] })
    await polling.uiPollTick()
    const before = refreshChatIndex.mock.calls.length
    await polling.uiPollTick()
    expect(refreshChatIndex.mock.calls.length).toBeGreaterThan(before)
  })

  it('已应用版本按 scope 区分：切换 target 后各自重新对账', async () => {
    const { polling, state, emit } = makeHarness({ revisions: [7] })
    await polling.uiPollTick()
    emit.mockClear()

    state.data.ui.activeRoleId = 'role-2'
    state.draft.activeRoleId = 'role-2'
    state.data.chatsByRole['role-2'] = { activeChatId: '', chatMetas: [], chats: [] }
    await polling.uiPollTick()
    expect(emit.mock.calls.length).toBeGreaterThan(0)

    emit.mockClear()
    state.data.ui.activeRoleId = 'role-1'
    state.draft.activeRoleId = 'role-1'
    await polling.uiPollTick()
    expect(emit).not.toHaveBeenCalled()
  })

  it('重连成功强制对账一次（忽略版本门）', async () => {
    let reconnectListener: (() => void) | null = null
    const { polling, emit } = makeHarness({
      revisions: [7],
      onReconnected: (listener) => {
        reconnectListener = listener
        return () => { reconnectListener = null }
      },
    })
    polling.startUiPollers()
    await polling.uiPollTick()
    emit.mockClear()

    await polling.uiPollTick()
    expect(emit).not.toHaveBeenCalled()

    reconnectListener!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(emit.mock.calls.map((call: any[]) => call[0])).toContain('chatList:role:role-1')
    polling.stopUiPollers()
  })

  // 回归 1：服务端重建后 revision 可能与上一代相同，只记 revision 会永久跳过。
  it('epoch 换代后即使 revision 相同也重新对账', async () => {
    let epoch = 1
    const { polling, emit } = makeHarness({ revisions: [7], epoch: () => epoch })
    await polling.uiPollTick()
    emit.mockClear()

    // 同一代、同一 revision：版本门挡住。
    await polling.uiPollTick()
    expect(emit).not.toHaveBeenCalled()

    // 换代（服务端重建），revision 仍然是 7：必须重新生效。
    epoch = 2
    await polling.uiPollTick()
    expect(emit.mock.calls.map((call: any[]) => call[0])).toContain('chatList:role:role-1')
  })
})

describe('uiPolling 对账取回权威正文', () => {
  // 回归 2：群聊强制对账过去走缓存正文，本地时间戳没变就永远读不到新正文。
  it('群聊强制对账必须重新取正文（不看本地时间戳）', async () => {
    const { polling, state, reloadChatBody } = makeHarness({
      kind: 'group',
      revisions: [7, 7],
      bodies: { 'chat-1': { title: '群聊会话', messages: [{ id: 'm1', content: '权威正文' }], updatedAt: 1000 } },
    })
    // 本地已有一条同 updatedAt 的会话：普通对账不会重取。
    upsertIntoState(state, 'group', 'group-1', { id: 'chat-1', title: '旧标题', messages: [], updatedAt: 1000 })

    await polling.uiPollTick()
    reloadChatBody.mockClear()

    await polling.uiPollTick({ force: true })
    expect(reloadChatBody).toHaveBeenCalledTimes(1)
    const box = state.data.chatsByGroup['group-1']
    const chat = box.chats.find((item: any) => item.id === 'chat-1')
    expect(chat.messages[0].content).toBe('权威正文')
  })

  it('角色强制对账同样走权威重取', async () => {
    const { polling, state, reloadChatBody } = makeHarness({
      revisions: [7, 7],
      bodies: { 'chat-1': { title: '角色会话', messages: [{ id: 'm1', content: '新正文' }], updatedAt: 1000 } },
    })
    upsertIntoState(state, 'role', 'role-1', { id: 'chat-1', title: '旧标题', messages: [], updatedAt: 1000 })

    await polling.uiPollTick()
    reloadChatBody.mockClear()

    await polling.uiPollTick({ force: true })
    expect(reloadChatBody).toHaveBeenCalledTimes(1)
    const chat = state.data.chatsByRole['role-1'].chats.find((item: any) => item.id === 'chat-1')
    expect(chat.messages[0].content).toBe('新正文')
  })

  it('普通对账在索引时间戳更新时也重取正文', async () => {
    const { polling, reloadChatBody } = makeHarness({
      revisions: [7],
      bodies: { 'chat-1': { title: '会话', messages: [{ id: 'm1', content: '新正文' }], updatedAt: 1000 } },
    })
    await polling.uiPollTick()
    // 索引里 chat-1 的 updatedAt 是 1000，本地没有会话 → 必须取回正文。
    expect(reloadChatBody).toHaveBeenCalledWith({ kind: 'role', targetId: 'role-1' }, 'chat-1', { authoritative: true })
  })

  it('运行中的会话不被对账覆盖', async () => {
    const { polling, state, reloadChatBody } = makeHarness({ revisions: [7, 7] })
    writeActiveChatSelection(state.data.chatsByRole['role-1'], 'chat-1')
    ;(state as any).activeRunCards = [{ kind: 'eb-role-run', runId: 'r1', roleId: 'role-1', groupId: '', workspaceId: '', sessionId: 'chat-1', status: 'running' }]

    await polling.uiPollTick({ force: true })
    expect(reloadChatBody).not.toHaveBeenCalled()
  })
})

describe('uiPolling notice 对账', () => {
  it('没有携带通知时不再回读 runtime storage', async () => {
    const { polling } = makeHarness({ revisions: [1] })
    const rtGet = vi.fn(async () => ({ id: 'notice-1' }))
    ;(polling as any).rtStorage = { get: rtGet }
    await polling.applyChatUpdatedNoticeOnce()
    expect(rtGet).not.toHaveBeenCalled()
  })

  it('事件携带的通知只应用一次', async () => {
    const { polling, state } = makeHarness({ revisions: [1] })
    const roleBox = (state.data.chatsByRole as any)['role-1']
    writeChatListProjection(roleBox, {
      kind: 'replace',
      chats: [{ id: 'chat-1', updatedAt: 1 }],
      chatMetas: [
        { id: 'chat-1', updatedAt: 1 },
        { id: 'chat-2', updatedAt: 1 },
      ],
    })
    writeActiveChatSelection(roleBox, 'chat-1')
    const notice = { id: 'n1', targetKind: 'role', targetId: 'role-1', chatId: 'chat-2', updatedAt: 9 }

    const first = await polling.applyChatUpdatedNoticeOnce(notice)
    const second = await polling.applyChatUpdatedNoticeOnce(notice)
    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(roleBox.chatMetas[1].updatedAt).toBe(9)
  })

  it('非当前会话的通知只更新列表，不重载当前正文', async () => {
    const { polling, state, reloadChatBody } = makeHarness({
      revisions: [1],
      bodies: { 'chat-1': { title: '当前会话', messages: [{ id: 'm1', content: '当前正文' }], updatedAt: 9000 } },
    })
    const roleBox = state.data.chatsByRole['role-1']
    writeActiveChatSelection(roleBox, 'chat-1')
    writeChatListProjection(roleBox, {
      kind: 'replace',
      chats: [{ id: 'chat-1', title: '当前会话', updatedAt: 1, messages: [{ id: 'm1', content: '当前正文' }] }],
      chatMetas: [
        { id: 'chat-1', title: '当前会话', updatedAt: 1 },
        { id: 'chat-2', title: '旧标题', updatedAt: 1 },
      ],
    })
    reloadChatBody.mockClear()

    const applied = await polling.applyChatUpdatedNoticeOnce({
      id: 'n-other',
      targetKind: 'role',
      targetId: 'role-1',
      chatId: 'chat-2',
      updatedAt: 77,
    })

    expect(applied).toBe(true)
    expect(reloadChatBody).not.toHaveBeenCalled()
    expect(roleBox.chatMetas.find((meta: any) => meta.id === 'chat-2').updatedAt).toBe(77)
    expect(roleBox.chats[0].messages[0].content).toBe('当前正文')
  })

  it('事件里的非当前会话通知只发 chatList，不发 session/global', async () => {
    let listener: ((event: any) => void) | null = null
    const harness = makeHarness({
      revisions: [7],
      emitOnSubscribe: (fn) => { listener = fn },
    })
    const roleBox = harness.state.data.chatsByRole['role-1']
    writeChatListProjection(roleBox, {
      kind: 'replace',
      chats: [{ id: 'chat-1', updatedAt: 1 }],
      chatMetas: [
        { id: 'chat-1', updatedAt: 1 },
        { id: 'chat-2', updatedAt: 1 },
      ],
    })
    writeActiveChatSelection(roleBox, 'chat-1')
    await harness.polling.uiPollTick()
    harness.emit.mockClear()
    harness.polling.startUiPollers()

    listener!({
      name: AI_CHAT_DIRECT_EVENT.chatUpdated,
      payload: { id: 'n-other', targetKind: 'role', targetId: 'role-1', chatId: 'chat-2', updatedAt: 77 },
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    const scopes = harness.emit.mock.calls.map((call: any[]) => call[0])
    expect(scopes).toContain('chatList:role:role-1')
    expect(scopes).not.toContain('session:role:role-1:chat-2')
    expect(scopes).not.toContain('global')
    harness.polling.stopUiPollers()
  })

  it('事件里的当前会话通知发 session，且不广播 global', async () => {
    let listener: ((event: any) => void) | null = null
    const harness = makeHarness({
      revisions: [7],
      bodies: { 'chat-1': { title: '会话', messages: [{ id: 'm1', content: '通知后的正文' }], updatedAt: 9000 } },
      emitOnSubscribe: (fn) => { listener = fn },
    })
    const roleBox = harness.state.data.chatsByRole['role-1']
    writeChatListProjection(roleBox, {
      kind: 'replace',
      chats: [{ id: 'chat-1', updatedAt: 1, messages: [] }],
      chatMetas: [{ id: 'chat-1', updatedAt: 1 }],
    })
    writeActiveChatSelection(roleBox, 'chat-1')
    await harness.polling.uiPollTick()
    roleBox.chats[0].updatedAt = 1
    harness.emit.mockClear()
    harness.polling.startUiPollers()

    listener!({
      name: AI_CHAT_DIRECT_EVENT.chatUpdated,
      payload: { id: 'n-current', targetKind: 'role', targetId: 'role-1', chatId: 'chat-1', updatedAt: 9000 },
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    const scopes = harness.emit.mock.calls.map((call: any[]) => call[0])
    expect(scopes).toContain('session:role:role-1:chat-1')
    expect(scopes).not.toContain('global')
    harness.polling.stopUiPollers()
  })

  it('当前会话的通知走权威重取正文', async () => {
    const { polling, state, reloadChatBody } = makeHarness({
      revisions: [1],
      bodies: { 'chat-1': { title: '会话', messages: [{ id: 'm1', content: '通知后的正文' }], updatedAt: 9000 } },
    })
    const roleBox = state.data.chatsByRole['role-1']
    writeActiveChatSelection(roleBox, 'chat-1')
    writeChatListProjection(roleBox, {
      kind: 'replace',
      chats: [{ id: 'chat-1', updatedAt: 1, messages: [] }],
      chatMetas: [{ id: 'chat-1', updatedAt: 1 }],
    })

    const applied = await polling.applyChatUpdatedNoticeOnce({ id: 'n1', targetKind: 'role', targetId: 'role-1', chatId: 'chat-1', updatedAt: 9000 })
    expect(applied).toBe(true)
    expect(reloadChatBody).toHaveBeenCalledWith({ kind: 'role', targetId: 'role-1' }, 'chat-1', { authoritative: true })
    expect(roleBox.chats[0].messages[0].content).toBe('通知后的正文')
  })
})

function sessionChangePayload(overrides: Record<string, any> = {}) {
  return {
    targetKind: 'message',
    location: { kind: 'role', roleId: 'role-1', groupId: '', workspaceId: '', sessionId: 'chat-1' },
    changeType: 'message_added',
    version: 3,
    occurredAt: '2026-06-03T10:00:00.000Z',
    ...overrides,
  }
}

function emitSessionChange(listener: (event: any) => void, overrides: Record<string, any> = {}) {
  listener({ name: AI_CHAT_DIRECT_EVENT.eucliBoxSessionChange, payload: sessionChangePayload(overrides) })
}

function seedLoadedChat(harness: ReturnType<typeof makeHarness>, chat: any) {
  const box = harness.state.data.chatsByRole['role-1']
  writeChatListProjection(box, {
    kind: 'replace',
    chats: [chat],
    chatMetas: [{ id: chat.id, title: chat.title || '会话', updatedAt: Number(chat.updatedAt || 0) }],
  })
  writeActiveChatSelection(box, chat.id)
  return box
}

describe('uiPolling 会话变更广播', () => {
  it('版本更高时按事件指向权威重取对应会话', async () => {
    let listener: ((event: any) => void) | null = null
    const harness = makeHarness({
      revisions: [7],
      bodies: { 'chat-1': { title: '会话', version: 3, messages: [{ id: 'm1', content: '新正文' }], updatedAt: 3000 } },
      emitOnSubscribe: (fn) => { listener = fn },
    })
    const box = seedLoadedChat(harness, { id: 'chat-1', title: '会话', updatedAt: 1000, sessionVersion: 2, messages: [] })
    harness.polling.startUiPollers()

    emitSessionChange(listener!, { version: 3 })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(harness.reloadChatBody).toHaveBeenCalledWith({ kind: 'role', targetId: 'role-1' }, 'chat-1', { authoritative: true })
    expect(box.chats[0].messages[0].content).toBe('新正文')
    expect(box.chats[0].sessionVersion).toBe(3)
    expect(harness.emit.mock.calls.map((call: any[]) => call[0])).toContain('session:role:role-1:chat-1')
    harness.polling.stopUiPollers()
  })

  it('版本不高于本地已知版本时忽略，不使视图倒退', async () => {
    let listener: ((event: any) => void) | null = null
    const harness = makeHarness({
      revisions: [7],
      bodies: { 'chat-1': { title: '会话', version: 2, messages: [{ id: 'm1', content: '旧正文' }], updatedAt: 1000 } },
      emitOnSubscribe: (fn) => { listener = fn },
    })
    seedLoadedChat(harness, { id: 'chat-1', title: '会话', updatedAt: 2000, sessionVersion: 5, messages: [] })
    harness.polling.startUiPollers()

    emitSessionChange(listener!, { version: 5 })
    emitSessionChange(listener!, { version: 4 })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(harness.reloadChatBody).not.toHaveBeenCalled()
    expect(harness.emit).not.toHaveBeenCalled()
    harness.polling.stopUiPollers()
  })

  it('推送在拉取期间继续到达时只追加一次最新版本拉取', async () => {
    let listener: ((event: any) => void) | null = null
    const harness = makeHarness({
      revisions: [7],
      bodies: { 'chat-1': { title: '会话', version: 2, messages: [{ id: 'm1', content: '正文' }], updatedAt: 2000 } },
      emitOnSubscribe: (fn) => { listener = fn },
    })
    seedLoadedChat(harness, { id: 'chat-1', title: '会话', updatedAt: 1000, sessionVersion: 1, messages: [] })
    let pulls = 0
    harness.reloadChatBody.mockImplementation(async (_scope: ProjectionScope, chatId: string) => {
      pulls += 1
      return {
        id: chatId,
        title: '会话',
        version: pulls === 1 ? 2 : 3,
        messages: [{ id: `m${pulls}`, content: '正文' }],
        updatedAt: 2000 + pulls,
      }
    })
    harness.polling.startUiPollers()

    emitSessionChange(listener!, { version: 2 })
    emitSessionChange(listener!, { version: 3 })
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(harness.reloadChatBody.mock.calls.length).toBeLessThanOrEqual(2)
    expect(harness.state.data.chatsByRole['role-1'].chats[0].sessionVersion).toBe(3)
    harness.polling.stopUiPollers()
  })

  it('其他视窗的会话变更不影响当前视窗', async () => {
    let listener: ((event: any) => void) | null = null
    const harness = makeHarness({
      revisions: [7],
      bodies: { 'chat-1': { title: '会话', version: 9, messages: [], updatedAt: 3000 } },
      emitOnSubscribe: (fn) => { listener = fn },
    })
    seedLoadedChat(harness, { id: 'chat-1', title: '会话', updatedAt: 1000, sessionVersion: 1, messages: [] })
    harness.polling.startUiPollers()

    emitSessionChange(listener!, {
      location: { kind: 'group', roleId: '', groupId: 'group-1', workspaceId: '', sessionId: 'chat-1' },
      version: 9,
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(harness.reloadChatBody).not.toHaveBeenCalled()
    harness.polling.stopUiPollers()
  })

  it('非当前目标但已加载的会话静默刷新，不打扰当前视窗', async () => {
    let listener: ((event: any) => void) | null = null
    const harness = makeHarness({
      revisions: [7],
      bodies: { 'chat-g': { title: '群聊会话', version: 4, messages: [{ id: 'm1', content: '后台新正文' }], updatedAt: 4000 } },
      emitOnSubscribe: (fn) => { listener = fn },
    })
    const groupBox = (harness.state.data.chatsByGroup['group-1'] ||= { activeChatId: 'chat-g', chatMetas: [], chats: [] })
    writeChatListProjection(groupBox, {
      kind: 'replace',
      chats: [{ id: 'chat-g', title: '群聊会话', updatedAt: 1000, sessionVersion: 3, messages: [] }],
      chatMetas: [{ id: 'chat-g', title: '群聊会话', updatedAt: 1000 }],
    })
    harness.polling.startUiPollers()

    emitSessionChange(listener!, {
      location: { kind: 'group', roleId: '', groupId: 'group-1', workspaceId: '', sessionId: 'chat-g' },
      version: 4,
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(harness.reloadChatBody).toHaveBeenCalledWith({ kind: 'group', targetId: 'group-1' }, 'chat-g', { authoritative: true })
    expect(groupBox.chats[0].sessionVersion).toBe(4)
    expect(harness.emit).not.toHaveBeenCalled()
    harness.polling.stopUiPollers()
  })
})

function makeWorkspaceHarness() {
  const state: any = {
    loading: false,
    data: {
      ui: { activeTargetKind: 'workspace', activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: 'ws-1' },
      chatsByWorkspace: {
        'ws-1::role-1': {
          activeChatId: 'chat-1',
          chatMetas: [{ id: 'chat-1', title: '工作区会话', createdAt: 1000, updatedAt: 1000 }],
          chats: [{ id: 'chat-1', title: '工作区会话', createdAt: 1000, updatedAt: 1000, sessionVersion: 3, messages: [{ id: 'm1', content: '旧正文' }] }],
        },
      },
    },
    draft: { activeTargetKind: 'workspace', activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: 'ws-1' },
  }
  let listener: ((event: any) => void) | null = null
  const syncWorkspaceChatById = vi.fn(async (_workspaceId: string, _roleId: string, chatId: string) => {
    const box = state.data.chatsByWorkspace['ws-1::role-1']
    writeChatListProjection(box, {
      kind: 'upsert',
      chat: { id: chatId, title: '工作区会话', updatedAt: 4000, messages: [{ id: 'm1', content: '外部编辑后的正文' }] },
      fallbackTitle: '工作区会话',
    })
    box.chats[0].sessionVersion = 4
    return true
  })
  const emit = vi.fn()
  const polling = createUiPolling({
    getState: () => state,
    emitScope: emit,
    subscribeDirectEvents: (next) => {
      listener = next
      return () => {}
    },
    activeTargetKind: () => 'workspace',
    activeChatFromData: () => state.data.chatsByWorkspace['ws-1::role-1'].chats[0] || null,
    refreshChatIndex: vi.fn(async () => null),
    reloadChatBody: vi.fn(async () => null),
    upsertLoadedChat: vi.fn(),
    syncWorkspaceChatById,
    refreshWorkspaceChats: vi.fn(async () => ({ chatVersions: {} })),
  })
  return { polling, state, emit, syncWorkspaceChatById, emitEvent: (event: any) => listener!(event) }
}

describe('uiPolling 工作区会话变更广播', () => {
  function workspaceChange(version: number) {
    return {
      name: AI_CHAT_DIRECT_EVENT.eucliBoxSessionChange,
      payload: {
        targetKind: 'message',
        location: { kind: 'workspace', roleId: 'role-1', groupId: '', workspaceId: 'ws-1', sessionId: 'chat-1' },
        changeType: 'message_edited',
        version,
        occurredAt: '2026-06-03T10:00:00.000Z',
      },
    }
  }

  it('外部编辑后按版本权威重取工作区会话并实时刷新当前视窗', async () => {
    const harness = makeWorkspaceHarness()
    harness.polling.startUiPollers()

    harness.emitEvent(workspaceChange(4))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(harness.syncWorkspaceChatById).toHaveBeenCalledWith('ws-1', 'role-1', 'chat-1')
    const chat = harness.state.data.chatsByWorkspace['ws-1::role-1'].chats[0]
    expect(chat.messages[0].content).toBe('外部编辑后的正文')
    expect(chat.sessionVersion).toBe(4)
    expect(harness.emit.mock.calls.map((call: any[]) => call[0])).toContain('session:workspace:ws-1::role-1:chat-1')
    harness.polling.stopUiPollers()
  })

  it('版本不高于本地已知版本时忽略工作区会话变更', async () => {
    const harness = makeWorkspaceHarness()
    harness.polling.startUiPollers()

    harness.emitEvent(workspaceChange(3))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(harness.syncWorkspaceChatById).not.toHaveBeenCalled()
    expect(harness.emit).not.toHaveBeenCalled()
    harness.polling.stopUiPollers()
  })
})

describe('uiPolling 工作区断线恢复版本核对', () => {
  function makeWorkspaceReconnectHarness(options: {
    localVersion: number
    serverVersion: number
    messages?: any[]
  }) {
    let reconnectListener: (() => void) | null = null
    const state: any = {
      loading: false,
      data: {
        ui: { activeTargetKind: 'workspace', activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: 'ws-1' },
        chatsByWorkspace: {
          'ws-1::role-1': {
            activeChatId: 'chat-1',
            chatMetas: [{ id: 'chat-1', title: '工作区会话', createdAt: 1000, updatedAt: 1000 }],
            chats: [{ id: 'chat-1', title: '工作区会话', createdAt: 1000, updatedAt: 1000, sessionVersion: options.localVersion, messages: [{ id: 'm1', content: '旧正文' }] }],
          },
        },
      },
      draft: { activeTargetKind: 'workspace', activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: 'ws-1' },
    }
    const refreshWorkspaceChats = vi.fn(async () => ({
      chatVersions: { 'chat-1': options.serverVersion },
    }))
    const syncWorkspaceChatById = vi.fn(async (_workspaceId: string, _roleId: string, chatId: string) => {
      const box = state.data.chatsByWorkspace['ws-1::role-1']
      writeChatListProjection(box, {
        kind: 'upsert',
        chat: {
          id: chatId,
          title: '工作区会话',
          updatedAt: 4000,
          version: options.serverVersion,
          messages: options.messages || [],
        },
        fallbackTitle: '工作区会话',
      })
      box.chats[0].sessionVersion = options.serverVersion
      return true
    })
    const emit = vi.fn()
    const polling = createUiPolling({
      getState: () => state,
      emitScope: emit,
      subscribeDirectEvents: () => () => {},
      onReconnected: (listener) => {
        reconnectListener = listener
        return () => { reconnectListener = null }
      },
      activeTargetKind: () => 'workspace',
      activeChatFromData: () => state.data.chatsByWorkspace['ws-1::role-1'].chats[0] || null,
      refreshChatIndex: vi.fn(async () => null),
      reloadChatBody: vi.fn(async () => null),
      upsertLoadedChat: vi.fn(),
      syncWorkspaceChatById,
      refreshWorkspaceChats,
    })
    return { polling, state, emit, refreshWorkspaceChats, syncWorkspaceChatById, reconnect: () => reconnectListener!() }
  }

  it('重连后按摘要版本拉回工作区正文，外部新增与删除一起收敛', async () => {
    const harness = makeWorkspaceReconnectHarness({
      localVersion: 3,
      serverVersion: 4,
      messages: [{ id: 'm2', content: '外部新增的正文' }],
    })
    harness.polling.startUiPollers()

    harness.reconnect()
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(harness.refreshWorkspaceChats).toHaveBeenCalledWith('ws-1', 'role-1')
    expect(harness.syncWorkspaceChatById).toHaveBeenCalledTimes(1)
    expect(harness.syncWorkspaceChatById).toHaveBeenCalledWith('ws-1', 'role-1', 'chat-1')
    const chat = harness.state.data.chatsByWorkspace['ws-1::role-1'].chats[0]
    expect(chat.messages.map((message: any) => message.id)).toEqual(['m2'])
    expect(chat.sessionVersion).toBe(4)
    const scopes = harness.emit.mock.calls.map((call: any[]) => call[0])
    expect(scopes).toContain('chatList:workspace:ws-1::role-1')
    expect(scopes).toContain('session:workspace:ws-1::role-1:chat-1')
    harness.polling.stopUiPollers()
  })

  it('摘要版本与本地一致时不重复拉取工作区正文，但列表仍按权威事实收敛', async () => {
    const harness = makeWorkspaceReconnectHarness({ localVersion: 4, serverVersion: 4 })
    harness.polling.startUiPollers()

    harness.reconnect()
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(harness.refreshWorkspaceChats).toHaveBeenCalledTimes(1)
    expect(harness.syncWorkspaceChatById).not.toHaveBeenCalled()
    expect(harness.emit.mock.calls.map((call: any[]) => call[0])).toContain('chatList:workspace:ws-1::role-1')
    harness.polling.stopUiPollers()
  })

  it('多个工作区恢复信号合并为一条核对链，不并发重取', async () => {
    const harness = makeWorkspaceReconnectHarness({
      localVersion: 3,
      serverVersion: 4,
      messages: [{ id: 'm2', content: '外部新增的正文' }],
    })
    harness.polling.startUiPollers()

    harness.reconnect()
    harness.reconnect()
    harness.reconnect()
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(harness.syncWorkspaceChatById).toHaveBeenCalledTimes(1)
    harness.polling.stopUiPollers()
  })
})

describe('uiPolling 断线恢复版本核对', () => {
  function makeReconnectHarness(options: { localVersion: number; serverVersion: number }) {
    let listener: (() => void) | null = null
    const harness = makeHarness({
      revisions: [7],
      versions: { 'chat-1': options.serverVersion },
      bodies: { 'chat-1': { title: '会话', version: options.serverVersion, messages: [{ id: 'm1', content: '权威正文' }], updatedAt: 3000 } },
      onReconnected: (fn) => {
        listener = fn
        return () => { listener = null }
      },
    })
    seedLoadedChat(harness, {
      id: 'chat-1',
      title: '会话',
      updatedAt: 3000,
      sessionVersion: options.localVersion,
      messages: [{ id: 'm0', content: '本地正文' }],
    })
    harness.polling.startUiPollers()
    return { harness, reconnect: () => listener!() }
  }

  it('索引版本更高时发起一次权威拉取并整体替换视图', async () => {
    const { harness, reconnect } = makeReconnectHarness({ localVersion: 2, serverVersion: 3 })
    reconnect()
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(harness.reloadChatBody).toHaveBeenCalledTimes(1)
    const chat = harness.state.data.chatsByRole['role-1'].chats[0]
    expect(chat.messages[0].content).toBe('权威正文')
    expect(chat.sessionVersion).toBe(3)
    expect(harness.emit.mock.calls.map((call: any[]) => call[0])).toContain('chatList:role:role-1')
    harness.polling.stopUiPollers()
  })

  it('索引版本与本地一致时不重复拉取正文', async () => {
    const { harness, reconnect } = makeReconnectHarness({ localVersion: 3, serverVersion: 3 })
    reconnect()
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(harness.reloadChatBody).not.toHaveBeenCalled()
    expect(harness.refreshChatIndex).toHaveBeenCalledTimes(1)
    expect(harness.emit.mock.calls.map((call: any[]) => call[0])).toContain('chatList:role:role-1')
    harness.polling.stopUiPollers()
  })

  it('多个恢复信号合并为一条核对链，不重复拉取', async () => {
    let signal: (() => void) | null = null
    const harness = makeHarness({
      revisions: [7],
      versions: { 'chat-1': 3 },
      bodies: { 'chat-1': { title: '会话', version: 3, messages: [{ id: 'm1', content: '权威正文' }], updatedAt: 3000 } },
      onReconnected: (fn) => {
        signal = fn
        return () => { signal = null }
      },
    })
    seedLoadedChat(harness, { id: 'chat-1', title: '会话', updatedAt: 3000, sessionVersion: 2, messages: [] })
    harness.polling.startUiPollers()

    signal!()
    signal!()
    signal!()
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(harness.reloadChatBody).toHaveBeenCalledTimes(1)
    harness.polling.stopUiPollers()
  })
})

describe('createIndexRevisionGate', () => {
  it('revision 非正时永远允许对账（旧后端没有版本语义）', () => {
    const gate = createIndexRevisionGate()
    expect(gate.shouldApply('role:r1', 1, 0)).toBe(true)
    gate.markApplied('role:r1', 1, 0)
    expect(gate.shouldApply('role:r1', 1, 0)).toBe(true)
  })

  it('同代同 revision 被挡住，换代后重新允许', () => {
    const gate = createIndexRevisionGate()
    gate.markApplied('role:r1', 1, 7)
    expect(gate.shouldApply('role:r1', 1, 7)).toBe(false)
    expect(gate.shouldApply('role:r1', 2, 7)).toBe(true)
    expect(gate.shouldApply('role:r1', 1, 8)).toBe(true)
  })

  it('版本门按 scope 独立记录', () => {
    const gate = createIndexRevisionGate()
    gate.markApplied('role:r1', 1, 7)
    expect(gate.shouldApply('role:r2', 1, 7)).toBe(true)
  })
})
