import { describe, expect, it, vi } from 'vitest'
import { createChatOperationsShared } from './chatOperationsShared'

function createHarness() {
  const state: any = {
    data: {
      roles: [],
      groups: [],
      workspaces: [],
      chatsByRole: {
        'role-a': {
          activeChatId: 'old-chat',
          chatMetas: [{ id: 'old-chat', title: '旧会话' }],
          chats: [],
        },
      },
      chatsByGroup: {
        'group-1': {
          activeChatId: 'old-group-chat',
          chatMetas: [{ id: 'old-group-chat', title: '旧群会话' }],
          chats: [],
        },
      },
      chatsByWorkspace: {},
      ui: { activeTargetKind: 'role', activeRoleId: 'role-a', activeGroupId: '', activeWorkspaceId: '' },
    },
    draft: { activeTargetKind: 'role', activeRoleId: 'role-a', activeGroupId: '', activeWorkspaceId: '' },
    pendingChat: { roleId: 'role-a', chat: { id: 'draft-chat', title: '新聊天', messages: [] } },
    pendingGroupChat: { groupId: 'group-1', chat: { id: 'draft-group-chat', title: '群聊', messages: [] } },
  }
  const persistActiveChatSelection = vi.fn(async () => {})
  const shared = createChatOperationsShared({
    getState: () => state,
    save: async () => {},
    emit: () => {},
    render: () => {},
    renderComposer: () => {},
    scrollToBottomSoon: () => {},
    readImageFileAsDataUrl: async () => '',
    persistActiveChatSelection,
  })
  return { state, shared, persistActiveChatSelection }
}

describe('pending 会话落成真实会话后的偏好持久化', () => {
  it('草稿发送成功：本地切到新会话，并走与普通点击相同的偏好写入', async () => {
    const harness = createHarness()
    const box = harness.state.data.chatsByRole['role-a']
    const metasBefore = box.chatMetas

    const activated = await harness.shared.activateResolvedPendingSelection('role', 'role-a', 'new-real-chat', 'draft-chat')

    expect(activated).toBe(true)
    expect(box.activeChatId).toBe('new-real-chat')
    expect(harness.state.pendingChat).toBeNull()
    expect(harness.persistActiveChatSelection).toHaveBeenCalledTimes(1)
    expect(harness.persistActiveChatSelection).toHaveBeenCalledWith('role', 'role-a', 'new-real-chat')
    // 只收口选择事实：列表事实不参与这次写入。
    expect(box.chatMetas).toBe(metasBefore)
  })

  it('重复的 run 事件不会重复写偏好', async () => {
    const harness = createHarness()

    expect(await harness.shared.activateResolvedPendingSelection('role', 'role-a', 'new-real-chat', 'draft-chat')).toBe(true)
    expect(await harness.shared.activateResolvedPendingSelection('role', 'role-a', 'new-real-chat', 'draft-chat')).toBe(false)

    expect(harness.persistActiveChatSelection).toHaveBeenCalledTimes(1)
  })

  it('群聊草稿落成真实会话时同样持久化群聊偏好', async () => {
    const harness = createHarness()

    const activated = await harness.shared.activateResolvedPendingSelection('group', 'group-1', 'new-group-chat', 'draft-group-chat')

    expect(activated).toBe(true)
    expect(harness.state.data.chatsByGroup['group-1'].activeChatId).toBe('new-group-chat')
    expect(harness.state.pendingGroupChat).toBeNull()
    expect(harness.persistActiveChatSelection).toHaveBeenCalledWith('group', 'group-1', 'new-group-chat')
  })
})
