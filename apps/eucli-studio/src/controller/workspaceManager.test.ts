// 工作区角色组合会话加载守护：
// 进入工作区与切换角色必须共用同一条加载路径，把目标组合的会话列表与会话体
// 落到该组合自己的数据盒；目标组合没有会话时呈现空态，不伪造草稿会话。
import { describe, expect, it, vi } from 'vitest'
import { workspaceRoleTargetId } from '../domain/workspaceRoleTarget'
import { createWorkspaceManager } from './workspaceManager'

type WorkspaceSession = {
  id: string
  roleId: string
  workspaceId: string
  title: string
  messages: any[]
}

function createNetRequestStub(sessionsByCombination: Record<string, WorkspaceSession[]>) {
  return vi.fn(async (req: any) => {
    const method = String(req?.method || '')
    const path = String(req?.path || '')
    const listMatch = path.match(/^\/api\/workspaces\/([^/]+)\/roles\/([^/]+)\/sessions$/)
    if (method === 'GET' && listMatch) {
      const combinationId = workspaceRoleTargetId(decodeURIComponent(listMatch[1]), decodeURIComponent(listMatch[2]))
      const sessions = sessionsByCombination[combinationId] || []
      return {
        body: sessions.map((session) => ({
          id: session.id,
          roleId: session.roleId,
          workspaceId: session.workspaceId,
          title: session.title,
          createdAt: 1000,
          updatedAt: 1000,
        })),
      }
    }
    const detailMatch = path.match(/^\/api\/workspaces\/([^/]+)\/roles\/([^/]+)\/sessions\/([^/]+)$/)
    if (method === 'GET' && detailMatch) {
      const combinationId = workspaceRoleTargetId(decodeURIComponent(detailMatch[1]), decodeURIComponent(detailMatch[2]))
      const sessionId = decodeURIComponent(detailMatch[3])
      const session = (sessionsByCombination[combinationId] || []).find((item) => item.id === sessionId) || null
      if (!session) throw new Error(`会话不存在：${sessionId}`)
      return {
        body: {
          id: session.id,
          roleId: session.roleId,
          workspaceId: session.workspaceId,
          title: session.title,
          createdAt: 1000,
          updatedAt: 1000,
          messages: session.messages,
        },
      }
    }
    throw new Error(`未预期的请求：${method} ${path}`)
  })
}

function createHarness(sessionsByCombination: Record<string, WorkspaceSession[]>) {
  const state: any = {
    loading: false,
    draft: { activeTargetKind: 'workspace', activeRoleId: 'role-a', activeGroupId: '', activeWorkspaceId: 'ws-1' },
    data: {
      roles: [
        { id: 'role-a', name: '角色A' },
        { id: 'role-b', name: '角色B' },
        { id: 'role-c', name: '角色C' },
      ],
      workspaces: [{ id: 'ws-1', name: '工作区一', directories: [], prompt: '', createdAt: 1, updatedAt: 1 }],
      chatsByRole: {},
      chatsByGroup: {},
      chatsByWorkspace: {},
      ui: { activeTargetKind: 'workspace', activeRoleId: 'role-a', activeGroupId: '', activeWorkspaceId: 'ws-1' },
    },
  }
  let emitCount = 0
  const manager = createWorkspaceManager({
    getState: () => state,
    netRequest: createNetRequestStub(sessionsByCombination),
    emit: () => { emitCount += 1 },
    render: () => {},
    closeModal: () => {},
    saveMeta: async () => {},
    scrollToBottomSoon: () => {},
    activeTargetKind: () => String(state.draft.activeTargetKind || 'role'),
    activeRole: () => state.data.roles.find((role: any) => String(role.id) === String(state.draft.activeRoleId || state.data.ui.activeRoleId)) || null,
    activeWorkspace: () => state.data.workspaces.find((workspace: any) => String(workspace.id) === String(state.draft.activeWorkspaceId || state.data.ui.activeWorkspaceId)) || null,
    clearPendingWorkspaceChat: () => { state.pendingWorkspaceChat = null },
  })
  return { state, manager, emits: () => emitCount }
}

function boxOf(state: any, combinationId: string) {
  return state.data.chatsByWorkspace[combinationId]
}

describe('工作区角色组合会话加载', () => {
  it('进入工作区后切换角色：前后两个组合的会话列表与会话体都自动落到各自的数据盒', async () => {
    const harness = createHarness({
      [workspaceRoleTargetId('ws-1', 'role-a')]: [{ id: 'session-a1', roleId: 'role-a', workspaceId: 'ws-1', title: 'A 的会话', messages: [{ id: 'message-a1', role: 'user', content: '来自 A' }] }],
      [workspaceRoleTargetId('ws-1', 'role-b')]: [{ id: 'session-b1', roleId: 'role-b', workspaceId: 'ws-1', title: 'B 的会话', messages: [{ id: 'message-b1', role: 'user', content: '来自 B' }] }],
    })

    harness.manager.setActiveWorkspace('ws-1')
    await vi.waitFor(() => {
      const boxA = boxOf(harness.state, workspaceRoleTargetId('ws-1', 'role-a'))
      expect(boxA?.chatMetas?.map((meta: any) => meta.id)).toEqual(['session-a1'])
      expect(boxA?.chats?.map((chat: any) => chat.id)).toEqual(['session-a1'])
      expect(boxA?.activeChatId).toBe('session-a1')
    })

    harness.manager.setWorkspaceRole('role-b')
    await vi.waitFor(() => {
      const boxB = boxOf(harness.state, workspaceRoleTargetId('ws-1', 'role-b'))
      expect(boxB?.chatMetas?.map((meta: any) => meta.id)).toEqual(['session-b1'])
      expect(boxB?.chats?.map((chat: any) => chat.id)).toEqual(['session-b1'])
      expect(boxB?.activeChatId).toBe('session-b1')
    })

    const boxA = boxOf(harness.state, workspaceRoleTargetId('ws-1', 'role-a'))
    const boxB = boxOf(harness.state, workspaceRoleTargetId('ws-1', 'role-b'))
    expect(boxA.chats[0].messages.map((message: any) => message.id)).toEqual(['message-a1'])
    expect(boxB.chats[0].messages.map((message: any) => message.id)).toEqual(['message-b1'])
  })

  it('切换到没有会话的角色：目标组合呈现空数据盒，且不伪造草稿会话', async () => {
    const harness = createHarness({
      [workspaceRoleTargetId('ws-1', 'role-a')]: [{ id: 'session-a1', roleId: 'role-a', workspaceId: 'ws-1', title: 'A 的会话', messages: [] }],
      [workspaceRoleTargetId('ws-1', 'role-c')]: [],
    })

    harness.manager.setActiveWorkspace('ws-1')
    await vi.waitFor(() => {
      expect(boxOf(harness.state, workspaceRoleTargetId('ws-1', 'role-a'))?.chats?.length).toBe(1)
    })

    const emitsBefore = harness.emits()
    harness.manager.setWorkspaceRole('role-c')
    await vi.waitFor(() => {
      expect(harness.emits()).toBeGreaterThanOrEqual(emitsBefore + 2)
    })

    const boxC = boxOf(harness.state, workspaceRoleTargetId('ws-1', 'role-c'))
    expect(boxC).toBeTruthy()
    expect(boxC.chatMetas).toEqual([])
    expect(boxC.chats).toEqual([])
    expect(boxC.activeChatId).toBe('')
    expect(harness.state.pendingWorkspaceChat ?? null).toBeNull()
    expect(harness.state.draft.activeRoleId).toBe('role-c')
  })
})
