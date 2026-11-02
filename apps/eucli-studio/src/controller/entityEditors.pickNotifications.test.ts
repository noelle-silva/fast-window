import { describe, expect, it, vi } from 'vitest'
import { refreshScopes } from '../domain/uiRefreshScope'
import { createEntityEditors } from './entityEditors'

function createChatBox() {
  return {
    activeChatId: 'chat-a',
    chatMetas: [{ id: 'chat-a' }, { id: 'chat-b' }],
    chats: [{ id: 'chat-a' }, { id: 'chat-b' }],
  }
}

function createHarness(options: { loadError?: Error } = {}) {
  const state: any = {
    data: {
      roles: [{ id: 'role-a' }],
      groups: [{ id: 'group-a' }],
      chatsByRole: { 'role-a': createChatBox() },
      chatsByGroup: { 'group-a': createChatBox() },
      chatsByWorkspace: {},
      ui: { activeTargetKind: 'role', activeRoleId: 'role-a', activeGroupId: '', activeWorkspaceId: '' },
    },
    draft: { activeTargetKind: 'role', activeRoleId: 'role-a', activeGroupId: '', activeWorkspaceId: '' },
  }
  const render = vi.fn()
  const emitScope = vi.fn()
  const showToast = vi.fn()
  const editors = createEntityEditors({
    getState: () => state,
    save: async () => {},
    render,
    emitScope,
    closeModal: () => {},
    showToast,
    filesImages: {},
    ensureChatLoaded: async () => {
      if (options.loadError) throw options.loadError
      return { id: 'chat-b', messages: [] }
    },
    ensureGroupChatLoaded: async () => {
      if (options.loadError) throw options.loadError
      return { id: 'chat-b', messages: [] }
    },
    cleanupFavoriteRefsForTarget: () => {},
    cleanupFavoriteRefsForChat: () => {},
  })
  return { state, render, emitScope, showToast, editors }
}

describe('会话选择通知', () => {
  it('角色会话选中时发 navigation / composer / chatList，正文到达后发 session / chatList', async () => {
    const harness = createHarness()

    await harness.editors.pickChatForActiveRole('chat-b')
    await vi.waitFor(() => {
      expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.session('role', 'role-a', 'chat-b'))
    })

    expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.navigation())
    expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.composer())
    expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.chatList('role', 'role-a'))
    expect(harness.render).not.toHaveBeenCalled()
  })

  it('群组会话选中时使用群组地址，不产生全局广播', async () => {
    const harness = createHarness()
    harness.state.draft.activeTargetKind = 'group'
    harness.state.draft.activeGroupId = 'group-a'

    await harness.editors.pickChatForActiveGroup('chat-b')
    await vi.waitFor(() => {
      expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.session('group', 'group-a', 'chat-b'))
    })

    expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.navigation())
    expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.chatList('group', 'group-a'))
    expect(harness.render).not.toHaveBeenCalled()
  })

  it('正文加载失败时仍只通知当前会话，不把整页拉回全局广播', async () => {
    const harness = createHarness({ loadError: new Error('加载失败') })

    await harness.editors.pickChatForActiveRole('chat-b')
    await vi.waitFor(() => {
      expect(harness.showToast).toHaveBeenCalled()
    })
    await vi.waitFor(() => {
      expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.session('role', 'role-a', 'chat-b'))
    })
    expect(harness.render).not.toHaveBeenCalled()
  })
})
