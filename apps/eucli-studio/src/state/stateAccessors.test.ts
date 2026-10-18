import { describe, expect, it } from 'vitest'
import { createStateAccessors } from './stateAccessors'

function createAccessors(activeRoleId: string, registeredRoleIds: string[] = ['role-a']) {
  const state: any = {
    draft: { activeTargetKind: 'workspace', activeRoleId, activeGroupId: '', activeWorkspaceId: 'ws-1' },
    data: {
      roles: [{ id: 'role-a' }, { id: 'role-b' }],
      groups: [],
      workspaces: [{ id: 'ws-1', registeredRoleIds }],
      chatsByRole: {},
      chatsByGroup: {},
      chatsByWorkspace: {
        'ws-1::role-b': { activeChatId: 'chat-b1', chatMetas: [], chats: [{ id: 'chat-b1' }] },
      },
      ui: {},
    },
  }
  return { state, accessors: createStateAccessors({ getState: () => state }) }
}

describe('工作区当前角色不参与注册过滤', () => {
  it('当前角色不在工作区清单内时仍按状态返回，不判空', () => {
    const { accessors } = createAccessors('role-b')

    expect(accessors.activeRole()?.id).toBe('role-b')
    expect(accessors.activeChat()?.id).toBe('chat-b1')
  })

  it('当前角色在工作区清单内时正常返回', () => {
    const { accessors } = createAccessors('role-a')

    expect(accessors.activeRole()?.id).toBe('role-a')
  })
})
