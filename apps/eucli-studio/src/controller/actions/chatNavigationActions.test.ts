import { describe, expect, it, vi } from 'vitest'
import { refreshScopes } from '../../domain/uiRefreshScope'
import { createChatNavigationActions } from './chatNavigationActions'

function createHarness(targetKind: 'role' | 'group') {
  const state: any = {
    data: {
      roles: [{ id: 'role-a' }, { id: 'role-b' }],
      groups: [{ id: 'group-a' }, { id: 'group-b' }],
      chatsByRole: { 'role-b': { activeChatId: 'chat-b', chatMetas: [], chats: [] } },
      chatsByGroup: { 'group-b': { activeChatId: 'chat-g', chatMetas: [], chats: [] } },
      ui: {
        activeTargetKind: targetKind,
        activeRoleId: 'role-a',
        activeGroupId: 'group-a',
        activeWorkspaceId: '',
      },
    },
    draft: {
      activeTargetKind: targetKind,
      activeRoleId: 'role-a',
      activeGroupId: 'group-a',
      activeWorkspaceId: '',
    },
    branchDraft: null,
  }
  const emit = vi.fn()
  const emitScope = vi.fn()
  const actions = createChatNavigationActions({
    state,
    emit,
    emitScope,
    saveMeta: async () => {},
    ensureActiveChatLoaded: async () => null,
    ensureChatsBoxBare: () => state.data.chatsByRole['role-b'],
    ensureGroupChatsBoxBare: () => state.data.chatsByGroup['group-b'],
    setActiveWorkspace: () => {},
    setWorkspaceRole: () => {},
    createChatForActiveTarget: () => {},
    pickChatForActiveTarget: () => {},
    pickDraftImages: () => {},
    addDraftImagesFromFiles: async () => {},
  })
  return { state, emit, emitScope, actions }
}

describe('会话目标切换通知', () => {
  it('setActiveRole 只发 navigation / composer / session，不再全局广播两次', async () => {
    const harness = createHarness('role')

    harness.actions.setActiveRole('role-b')
    await vi.waitFor(() => {
      expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.session('role', 'role-b', 'chat-b'))
    })

    expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.navigation())
    expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.composer())
    expect(harness.emit).not.toHaveBeenCalled()
  })

  it('setActiveGroup 使用群组与会话的显式地址', async () => {
    const harness = createHarness('group')

    harness.actions.setActiveGroup('group-b')
    await vi.waitFor(() => {
      expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.session('group', 'group-b', 'chat-g'))
    })

    expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.navigation())
    expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.composer())
    expect(harness.emit).not.toHaveBeenCalled()
  })
})
