import { describe, expect, it, vi } from 'vitest'
import { createChatOperationsShared } from './chatOperationsShared'
import { createChatMessageOperations } from './chatMessageOperations'

// B1 回归：消息写成功之后必须失效正文缓存。
// 编辑 / 删除都会立刻 refreshTargetSession，但 refresh 之前的本地修改
// 与缓存里的正文是两份事实——只要缓存没失效，下一次读就会把旧正文盖回来。

function createHarness(options: { targetKind?: 'role' | 'group' } = {}) {
  const targetKind = options.targetKind || 'role'
  const sessionId = 'chat-1'
  const targetId = 'role-a'
  const chat = {
    id: sessionId,
    title: '会话',
    updatedAt: 100,
    messages: [
      { id: 'm1', content: '原文', parts: [{ id: 'p1', type: 'text', text: '原文' }], createdAt: 1, updatedAt: 1 },
    ],
  }
  const state: any = {
    loading: false,
    data: {
      roles: [{ id: targetId, name: '角色 A' }],
      groups: targetKind === 'group' ? [{ id: targetId, name: '群组 A' }] : [],
      workspaces: [],
      chatsByRole: targetKind === 'role' ? { [targetId]: { activeChatId: sessionId, chats: [chat] } } : {},
      chatsByGroup: targetKind === 'group' ? { [targetId]: { activeChatId: sessionId, chats: [chat] } } : {},
      chatsByWorkspace: {},
      ui: {
        activeTargetKind: targetKind,
        activeRoleId: targetKind === 'role' ? targetId : 'role-member',
        activeGroupId: targetKind === 'group' ? targetId : '',
        activeWorkspaceId: '',
      },
    },
    draft: {
      activeTargetKind: targetKind,
      activeRoleId: targetKind === 'role' ? targetId : 'role-member',
      activeGroupId: targetKind === 'group' ? targetId : '',
      activeWorkspaceId: '',
    },
  }

  const invalidateChatBody = vi.fn()
  const updateRoleSessionMessage = vi.fn(async () => ({}))
  const deleteRoleSessionMessage = vi.fn(async () => ({}))
  const netRequest = vi.fn(async (req: any) => {
    if (String(req?.method || '').toUpperCase() === 'PATCH') return { status: 200, body: {} }
    return { status: 200, body: {} }
  })

  const shared = createChatOperationsShared({
    getState: () => state,
    save: async () => {},
    emit: () => {},
    render: () => {},
    renderComposer: () => {},
    scrollToBottomSoon: () => {},
    readImageFileAsDataUrl: async () => '',
    netRequest,
    invalidateChatBody,
    // 刷新路径：回读同一份 chat（模拟业务端已落盘）。
    reloadRoleSession: async () => chat,
    reloadGroupSession: async () => chat,
  })

  return {
    state,
    shared,
    chat,
    invalidateChatBody,
    updateRoleSessionMessage,
    deleteRoleSessionMessage,
    netRequest,
  }
}

describe('消息写成功后失效正文缓存（B1）', () => {
  it('编辑消息成功之后失效该 scope+chatId 的正文', async () => {
    const harness = createHarness()
    const ops = createChatMessageOperations(harness.shared)

    const ok = await ops.editMessage('m1', '改后的文本')

    expect(ok).toBe(true)
    expect(harness.chat.messages[0].content).toBe('改后的文本')
    expect(harness.invalidateChatBody).toHaveBeenCalledWith({ kind: 'role', targetId: 'role-a' }, 'chat-1')
  })

  it('编辑失败时不动缓存（不能因为失败把可用正文丢掉）', async () => {
    const harness = createHarness()
    // 业务端请求抛错 = 写失败（这些 helper 用抛错表达失败，不看状态码）。
    harness.netRequest.mockImplementation(async (req: any) => {
      if (String(req?.method || '').toUpperCase() === 'PATCH') throw new Error('写入失败')
      return { status: 200, body: {} }
    })
    const ops = createChatMessageOperations(harness.shared)

    const ok = await ops.editMessage('m1', '改后的文本')

    expect(ok).toBe(false)
    expect(harness.chat.messages[0].content).toBe('原文')
    expect(harness.invalidateChatBody).not.toHaveBeenCalled()
  })

  it('删除消息成功之后失效正文（删除走 refresh，refresh 内部先失效）', async () => {
    const harness = createHarness()
    const ops = createChatMessageOperations(harness.shared)

    await ops.deleteMessage('m1')

    expect(harness.invalidateChatBody).toHaveBeenCalledWith({ kind: 'role', targetId: 'role-a' }, 'chat-1')
  })

  it('删除消息失败时不失效', async () => {
    const harness = createHarness()
    harness.netRequest.mockImplementation(async () => {
      throw new Error('删除失败')
    })
    const ops = createChatMessageOperations(harness.shared)

    await ops.deleteMessage('m1')

    expect(harness.invalidateChatBody).not.toHaveBeenCalled()
  })
})
