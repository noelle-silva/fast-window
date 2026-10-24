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
