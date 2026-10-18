import { describe, expect, it, vi } from 'vitest'
import { createChatOperations } from './chatOperations'

function createOperations(activeRoleId: string) {
  const state: any = {
    loading: false,
    draft: {
      activeTargetKind: 'workspace',
      activeRoleId,
      activeGroupId: '',
      activeWorkspaceId: 'ws-1',
      input: '你好',
      images: [],
    },
    data: {
      roles: [{ id: 'role-a', name: '角色A' }],
      groups: [],
      workspaces: [{ id: 'ws-1', name: '工作区一', registeredRoleIds: [] }],
      chatsByRole: {},
      chatsByGroup: {},
      chatsByWorkspace: {},
      ui: { activeTargetKind: 'workspace', activeRoleId, activeWorkspaceId: 'ws-1' },
      settings: { providers: [] },
    },
  }
  const netRequest = vi.fn(async () => ({ body: {} }))
  const operations = createChatOperations({
    getState: () => state,
    netRequest,
    save: async () => {},
    emit: () => {},
    render: () => {},
    renderComposer: () => {},
    scrollToBottomSoon: () => {},
    readImageFileAsDataUrl: async () => '',
  })
  return { state, netRequest, operations }
}

describe('没有当前角色时不能发送消息', () => {
  it('当前角色为空时不发起发送请求', async () => {
    const { netRequest, operations } = createOperations('')

    await operations.sendChat()

    expect(netRequest).not.toHaveBeenCalled()
  })
})
