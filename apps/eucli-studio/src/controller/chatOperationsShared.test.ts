import { describe, expect, it, vi } from 'vitest'
import { workspaceRoleTargetId } from '../domain/workspaceRoleTarget'
import { createChatOperationsShared } from './chatOperationsShared'

function createHarness() {
  const state: any = {
    data: {
      roles: [],
      groups: [],
      workspaces: [],
      chatsByRole: {},
      chatsByGroup: {},
      chatsByWorkspace: {},
      ui: { activeTargetKind: 'workspace', activeRoleId: 'role-a', activeGroupId: '', activeWorkspaceId: 'ws-1' },
    },
    draft: { activeTargetKind: 'workspace', activeRoleId: 'role-a', activeGroupId: '', activeWorkspaceId: 'ws-1' },
  }
  const reloadWorkspaceSession = vi.fn(async (workspaceId: string, roleId: string, sessionId: string) => ({
    id: sessionId,
    workspaceId,
    roleId,
    messages: [],
  }))
  const shared = createChatOperationsShared({
    getState: () => state,
    save: async () => {},
    emit: () => {},
    render: () => {},
    renderComposer: () => {},
    scrollToBottomSoon: () => {},
    readImageFileAsDataUrl: async () => '',
    reloadWorkspaceSession,
  })
  return { state, shared, reloadWorkspaceSession }
}

describe('工作区会话刷新身份', () => {
  it('刷新会话时把工作区编号与角色编号分别交给业务端', async () => {
    const harness = createHarness()

    await harness.shared.refreshTargetSession('workspace', workspaceRoleTargetId('ws-1', 'role-b'), 'session-b1')

    expect(harness.reloadWorkspaceSession).toHaveBeenCalledWith('ws-1', 'role-b', 'session-b1')
    expect(harness.state.data.chatsByWorkspace[workspaceRoleTargetId('ws-1', 'role-b')]?.activeChatId).toBe('session-b1')
  })

  it('目标地址缺少角色时快速失败，不退回全局当前角色', async () => {
    const harness = createHarness()

    const chat = await harness.shared.refreshTargetSession('workspace', 'ws-1', 'session-b1')

    expect(chat).toBeNull()
    expect(harness.reloadWorkspaceSession).not.toHaveBeenCalled()
  })
})

describe('写路径的正文缓存失效', () => {
  function createRoleHarness() {
    const state: any = {
      data: {
        roles: [{ id: 'role-a', name: '角色 A' }],
        groups: [],
        workspaces: [],
        chatsByRole: { 'role-a': { activeChatId: 'chat-1', chats: [] } },
        chatsByGroup: {},
        chatsByWorkspace: {},
        ui: { activeTargetKind: 'role', activeRoleId: 'role-a', activeGroupId: '', activeWorkspaceId: '' },
      },
      draft: { activeTargetKind: 'role', activeRoleId: 'role-a', activeGroupId: '', activeWorkspaceId: '' },
    }
    const invalidateChatBody = vi.fn()
    const reloadRoleSession = vi.fn(async (_roleId: string, sessionId: string) => ({ id: sessionId, messages: [] }))
    const shared = createChatOperationsShared({
      getState: () => state,
      save: async () => {},
      emit: () => {},
      render: () => {},
      renderComposer: () => {},
      scrollToBottomSoon: () => {},
      readImageFileAsDataUrl: async () => '',
      reloadRoleSession,
      invalidateChatBody,
    })
    return { state, shared, invalidateChatBody, reloadRoleSession }
  }

  it('refreshTargetSession 读取前先失效该 scope+chatId 的正文', async () => {
    const harness = createRoleHarness()

    await harness.shared.refreshTargetSession('role', 'role-a', 'chat-1')

    expect(harness.invalidateChatBody).toHaveBeenCalledWith({ kind: 'role', targetId: 'role-a' }, 'chat-1')
    // 失效必须发生在读取之前：用调用顺序钉住。
    expect(harness.invalidateChatBody.mock.invocationCallOrder[0]).toBeLessThan(
      harness.reloadRoleSession.mock.invocationCallOrder[0],
    )
  })

  it('工作区会话不走 scope 化正文缓存，不触发失效', async () => {
    const harness = createRoleHarness()

    await harness.shared.refreshTargetSession('workspace', 'ws-1::role-a', 'chat-1')

    expect(harness.invalidateChatBody).not.toHaveBeenCalled()
  })

  it('invalidateChatBodyAfterWrite 是写路径唯一失效原语', () => {
    const harness = createRoleHarness()

    harness.shared.invalidateChatBodyAfterWrite('role', 'role-a', 'chat-1')
    expect(harness.invalidateChatBody).toHaveBeenCalledWith({ kind: 'role', targetId: 'role-a' }, 'chat-1')
  })

  it('空 targetId / sessionId 不产生无意义的失效调用', () => {
    const harness = createRoleHarness()

    harness.shared.invalidateChatBodyAfterWrite('role', '', 'chat-1')
    harness.shared.invalidateChatBodyAfterWrite('role', 'role-a', '')
    expect(harness.invalidateChatBody).not.toHaveBeenCalled()
  })
})
