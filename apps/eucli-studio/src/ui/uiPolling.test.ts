import { describe, expect, it, vi } from 'vitest'
import { createUiPolling } from './uiPolling'
import type { ChatIndexSnapshot } from '../storage/splitProjectionCache'

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

function makeState() {
  const chatsByRole: Record<string, { activeChatId: string; chatMetas: any[]; chats: any[] }> = {
    'role-1': { activeChatId: '', chatMetas: [], chats: [] },
  }
  return {
    loading: false,
    data: {
      ui: { activeRoleId: 'role-1', activeTargetKind: 'role', activeGroupId: '', activeWorkspaceId: '' },
      roles: [],
      chatsByRole,
      groups: [],
      chatsByGroup: {},
    },
    draft: { activeRoleId: 'role-1', activeGroupId: '', activeWorkspaceId: '', activeTargetKind: 'role' },
  }
}

function makePolling(options: { revisions: number[]; ids?: string[]; emitOnSubscribe?: (listener: (event: any) => void) => void; onReconnected?: (listener: () => void) => () => void }) {
  const state = makeState()
  let call = 0
  const loadChatIndex = vi.fn(async () => {
    const revision = options.revisions[Math.min(call, options.revisions.length - 1)]
    call += 1
    return snapshot(revision, options.ids || ['chat-1', 'chat-2'], 'chat-1')
  })
  // 版本确认必须绕过缓存：用一个独立的计数区分「轻量确认」与「命中缓存」。
  const refreshChatIndex = vi.fn(async () => loadChatIndex())
  const emit = vi.fn()
  const polling = createUiPolling({
    getState: () => state,
    loadSplitMeta: async () => null,
    getSplitMetaCache: () => ({ roleFolders: { 'role-1': '角色一' }, groupFolders: {} }),
    emit,
    subscribeDirectEvents: (listener) => {
      options.emitOnSubscribe?.(listener)
      return () => {}
    },
    onReconnected: options.onReconnected,
    activeTargetKind: () => 'role',
    activeChatFromData: () => null,
    syncActiveGroupChatsFromStorage: async () => {},
    loadChatIndex,
    refreshChatIndex,
    loadChatBody: async () => null,
  })
  return { polling, state, emit, loadChatIndex, refreshChatIndex }
}

describe('uiPolling 版本门', () => {
  it('不再创建定时器：startUiPollers 后空闲不产生任何请求', async () => {
    const { polling, loadChatIndex } = makePolling({ revisions: [7] })
    polling.startUiPollers()
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(loadChatIndex).not.toHaveBeenCalled()
    polling.stopUiPollers()
  })

  it('revision 未变时不重算、不 emit', async () => {
    const { polling, emit } = makePolling({ revisions: [7, 7, 7] })
    await polling.uiPollTick()
    emit.mockClear()

    await polling.uiPollTick()
    await polling.uiPollTick()
    expect(emit).not.toHaveBeenCalled()
  })

  it('revision 变化时同步并 emit 一次', async () => {
    const { polling, emit } = makePolling({ revisions: [7, 8, 8] })
    await polling.uiPollTick()
    emit.mockClear()

    await polling.uiPollTick()
    expect(emit).toHaveBeenCalledTimes(1)
    await polling.uiPollTick()
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('同步后本地会话列表来自索引快照（而非 meta）', async () => {
    const { polling, state } = makePolling({ revisions: [3], ids: ['chat-a', 'chat-b'] })
    await polling.uiPollTick()
    expect(state.data.chatsByRole['role-1'].chatMetas.map((meta: any) => meta.id)).toEqual(['chat-a', 'chat-b'])
    expect(state.data.chatsByRole['role-1'].activeChatId).toBe('chat-a')
  })

  it('meta 的 updatedAt 不参与新鲜度判定：索引 revision 相同即视为无变化', async () => {
    const { polling, emit, refreshChatIndex } = makePolling({ revisions: [9, 9] })
    await polling.uiPollTick()
    emit.mockClear()
    const before = refreshChatIndex.mock.calls.length

    await polling.uiPollTick()
    expect(emit).not.toHaveBeenCalled()
    // 版本门必须做一次轻量确认（缓存命中也要问服务端），但 revision 没变就不同步。
    expect(refreshChatIndex.mock.calls.length).toBeGreaterThan(before)
  })

  // 审查偏差 B：版本门比较的必须是「服务端最新 revision」，而不是缓存里的旧值。
  it('版本门绕过缓存：命中缓存也要确认服务端最新 revision', async () => {
    const { polling, emit, refreshChatIndex } = makePolling({ revisions: [7, 8] })
    await polling.uiPollTick()
    emit.mockClear()

    await polling.uiPollTick()
    // 若版本门读到缓存（仍是 7），这里就永远不会触发；必须能观察到 8。
    expect(emit).toHaveBeenCalledTimes(1)
    expect(refreshChatIndex).toHaveBeenCalled()
  })

  // 审查偏差 B：revision 必须按 scope 记录，不能是全局单值。
  it('已应用版本按 scope 区分：切换 target 后各自重新对账', async () => {
    const { polling, state, emit } = makePolling({ revisions: [7] })
    await polling.uiPollTick()
    emit.mockClear()

    // 切到另一个角色：它的已应用版本是「未知」，必须对账一次。
    state.data.ui.activeRoleId = 'role-2'
    state.draft.activeRoleId = 'role-2'
    state.data.chatsByRole['role-2'] = { activeChatId: '', chatMetas: [], chats: [] }
    await polling.uiPollTick()
    expect(emit).toHaveBeenCalledTimes(1)

    // 再切回来：role-1 的版本仍是 7，且服务端也还是 7 → 不再对账。
    emit.mockClear()
    state.data.ui.activeRoleId = 'role-1'
    state.draft.activeRoleId = 'role-1'
    await polling.uiPollTick()
    expect(emit).not.toHaveBeenCalled()
  })

  // 审查偏差 B：断线重连 / 页面恢复必须强制对账（版本门会挡住缺口补齐）。
  it('重连成功强制对账一次（忽略版本门）', async () => {
    let reconnectListener: (() => void) | null = null
    const { polling, emit } = makePolling({
      revisions: [7],
      onReconnected: (listener) => {
        reconnectListener = listener
        return () => { reconnectListener = null }
      },
    })
    polling.startUiPollers()
    await polling.uiPollTick()
    emit.mockClear()

    // 版本没变，普通 tick 不会对账。
    await polling.uiPollTick()
    expect(emit).not.toHaveBeenCalled()

    // 重连：强制对账。
    reconnectListener!()
    // 强制对账是异步的（读快照 → 同步 → emit），用宏任务等待链尾。
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(emit).toHaveBeenCalledTimes(1)
    polling.stopUiPollers()
  })
})

describe('uiPolling notice 对账', () => {
  it('没有携带通知时不再回读 runtime storage', async () => {
    const rtGet = vi.fn(async () => ({ id: 'notice-1' }))
    const state = makeState()
    const polling = createUiPolling({
      getState: () => state,
      loadSplitMeta: async () => null,
      getSplitMetaCache: () => ({ roleFolders: { 'role-1': '角色一' }, groupFolders: {} }),
      emit: () => {},
      activeTargetKind: () => 'role',
      activeChatFromData: () => null,
      syncActiveGroupChatsFromStorage: async () => {},
      loadChatIndex: async () => null,
      loadChatBody: async () => null,
      // 旧实现会通过 rtStorage 轮询一个 studio 侧根本不存在的键。
      ...({ rtStorage: { get: rtGet } } as any),
    })
    await polling.applyChatUpdatedNoticeOnce()
    expect(rtGet).not.toHaveBeenCalled()
  })

  it('事件携带的通知只应用一次', async () => {
    const { polling, state } = makePolling({ revisions: [1] })
    const roleBox = (state.data.chatsByRole as any)['role-1']
    roleBox.chatMetas = [
      { id: 'chat-1', updatedAt: 1 },
      { id: 'chat-2', updatedAt: 1 },
    ]
    roleBox.chats = [{ id: 'chat-1', updatedAt: 1 }]
    roleBox.activeChatId = 'chat-1'
    // 非当前会话的通知走「只更新列表元数据」这条路径，不触发正文重读。
    const notice = { id: 'n1', targetKind: 'role', targetId: 'role-1', chatId: 'chat-2', updatedAt: 9 }

    const first = await polling.applyChatUpdatedNoticeOnce(notice)
    const second = await polling.applyChatUpdatedNoticeOnce(notice)
    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(roleBox.chatMetas[1].updatedAt).toBe(9)
  })
})
