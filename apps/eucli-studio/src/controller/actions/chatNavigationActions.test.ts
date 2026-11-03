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
  const emitScope = vi.fn()
  const actions = createChatNavigationActions({
    state,
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
  return { state, emitScope, actions }
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
  })

  it('setActiveGroup 使用群组与会话的显式地址', async () => {
    const harness = createHarness('group')

    harness.actions.setActiveGroup('group-b')
    await vi.waitFor(() => {
      expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.session('group', 'group-b', 'chat-g'))
    })

    expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.navigation())
    expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.composer())
  })

  it('非输入草稿字段归 uiShell，草稿图片归 composer', () => {
    const harness = createHarness('role')

    harness.actions.setDraft('workspaceName', '新工作区')
    harness.actions.removeDraftImage('img-1')

    expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.uiShell())
    expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.composer())
  })

  it('输入框按键不广播，避免外部刷新重置输入区', () => {
    const harness = createHarness('role')

    harness.actions.setComposerInput('正在输入')

    expect(harness.emitScope).not.toHaveBeenCalled()
  })

  it('外部程序化写入必须广播 composer，让输入区按修订号对账', () => {
    const harness = createHarness('role')

    harness.actions.setComposerInputExternal('外部写入')

    expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.composer())
  })
})
