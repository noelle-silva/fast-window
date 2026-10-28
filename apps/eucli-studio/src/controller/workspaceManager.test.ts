// 工作区角色组合会话加载守护：
// 进入工作区与切换角色必须共用同一条加载路径，把目标组合的会话列表与会话体
// 落到该组合自己的数据盒；目标组合没有会话时呈现空态，不伪造草稿会话。
import { describe, expect, it, vi } from 'vitest'
import { workspaceRoleTargetId } from '../domain/workspaceRoleTarget'
import { createStateAccessors } from '../state/stateAccessors'
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

function createHarness(
  sessionsByCombination: Record<string, WorkspaceSession[]>,
  netRequest: any = createNetRequestStub(sessionsByCombination),
  extraDeps: Record<string, any> = {},
) {
  const state: any = {
    loading: false,
    draft: { activeTargetKind: 'workspace', activeRoleId: 'role-a', activeGroupId: '', activeWorkspaceId: 'ws-1' },
    data: {
      roles: [
        { id: 'role-a', name: '角色A' },
        { id: 'role-b', name: '角色B' },
        { id: 'role-c', name: '角色C' },
      ],
      workspaces: [{ id: 'ws-1', name: '工作区一', directories: [], prompt: '', registeredRoleIds: ['role-a', 'role-b', 'role-c'], createdAt: 1, updatedAt: 1 }],
      chatsByRole: {},
      chatsByGroup: {},
      chatsByWorkspace: {},
      ui: { activeTargetKind: 'workspace', activeRoleId: 'role-a', activeGroupId: '', activeWorkspaceId: 'ws-1' },
    },
  }
  let emitCount = 0
  const manager = createWorkspaceManager({
    getState: () => state,
    netRequest,
    emit: () => { emitCount += 1 },
    render: () => {},
    closeModal: () => {},
    saveMeta: async () => {},
    scrollToBottomSoon: () => {},
    activeTargetKind: () => String(state.draft.activeTargetKind || 'role'),
    activeRole: () => state.data.roles.find((role: any) => String(role.id) === String(state.draft.activeRoleId || state.data.ui.activeRoleId)) || null,
    activeWorkspace: () => state.data.workspaces.find((workspace: any) => String(workspace.id) === String(state.draft.activeWorkspaceId || state.data.ui.activeWorkspaceId)) || null,
    clearPendingWorkspaceChat: () => { state.pendingWorkspaceChat = null },
    ...extraDeps,
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

function createWorkspaceStore() {
  return {
    'ws-1': { id: 'ws-1', name: '工作区一', directories: [], prompt: '', registeredRoleIds: ['role-a'], createdAt: 1, updatedAt: 1 },
    'ws-2': { id: 'ws-2', name: '工作区二', directories: [], prompt: '', registeredRoleIds: ['role-c'], createdAt: 2, updatedAt: 2 },
  } as Record<string, any>
}

function createWorkspaceNetRequest(store: Record<string, any>) {
  const requests: any[] = []
  const netRequest = vi.fn(async (req: any) => {
    requests.push(req)
    const method = String(req?.method || '')
    const path = String(req?.path || '')
    if (method === 'GET' && path === '/api/workspaces') {
      return { body: Object.values(store).map((workspace) => ({ id: workspace.id })) }
    }
    const detailMatch = path.match(/^\/api\/workspaces\/([^/]+)$/)
    if (method === 'GET' && detailMatch) {
      return { body: store[decodeURIComponent(detailMatch[1])] }
    }
    if (method === 'POST' && path === '/api/workspaces') {
      store[req.body.id] = { ...req.body }
      return { body: req.body }
    }
    if (method === 'POST' && path === '/api/workspaces/prompt-preview') {
      return { body: { actualPrompt: '' } }
    }
    if (method === 'GET' && /^\/api\/workspaces\/[^/]+\/roles\/[^/]+\/sessions$/.test(path)) {
      return { body: [] }
    }
    throw new Error(`未预期的请求：${method} ${path}`)
  })
  return { netRequest, requests }
}

function createRegistrationNetRequest(store: Record<string, any>, sessionsByCombination: Record<string, WorkspaceSession[]>) {
  const requests: any[] = []
  const netRequest = vi.fn(async (req: any) => {
    requests.push(req)
    const method = String(req?.method || '')
    const path = String(req?.path || '')
    if (method === 'GET' && path === '/api/workspaces') {
      return { body: Object.values(store).map((workspace: any) => ({ id: workspace.id })) }
    }
    const workspaceDetailMatch = path.match(/^\/api\/workspaces\/([^/]+)$/)
    if (method === 'GET' && workspaceDetailMatch) {
      const workspace = store[decodeURIComponent(workspaceDetailMatch[1])]
      if (!workspace) throw new Error(`工作区不存在：${decodeURIComponent(workspaceDetailMatch[1])}`)
      return { body: workspace }
    }
    if (method === 'POST' && path === '/api/workspaces') {
      store[String(req?.body?.id || '')] = { ...(req.body || {}) }
      return { body: req.body }
    }
    const listMatch = path.match(/^\/api\/workspaces\/([^/]+)\/roles\/([^/]+)\/sessions$/)
    if (method === 'GET' && listMatch) {
      const combinationId = workspaceRoleTargetId(decodeURIComponent(listMatch[1]), decodeURIComponent(listMatch[2]))
      return {
        body: (sessionsByCombination[combinationId] || []).map((session) => ({
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
  return { netRequest, requests }
}

describe('工作区角色注册', () => {
  it('新建工作区从空清单开始，打开已有工作区载入其清单', () => {
    const harness = createHarness({})
    harness.state.data.workspaces[0].registeredRoleIds = ['role-a', 'role-b']

    harness.manager.openWorkspaceEditorInPlace('ws-1')
    expect(harness.state.draft.workspaceRegisteredRoleIds).toEqual(['role-a', 'role-b'])

    harness.manager.openNewWorkspaceEditorInPlace()
    expect(harness.state.draft.workspaceRegisteredRoleIds).toEqual([])
  })

  it('勾选注册与取消注册只改当前工作区草稿，保存后立即呈现最新清单且不影响其他工作区与角色本身', async () => {
    const store = createWorkspaceStore()
    const { netRequest, requests } = createWorkspaceNetRequest(store)
    const harness = createHarness({}, netRequest)
    harness.state.data.workspaces = [store['ws-1'], store['ws-2']]

    harness.manager.openWorkspaceEditorInPlace('ws-1')
    harness.manager.setWorkspaceRoleRegistered('role-b', true)
    expect(harness.state.draft.workspaceRegisteredRoleIds).toEqual(['role-a', 'role-b'])
    expect(harness.state.data.workspaces.find((workspace: any) => workspace.id === 'ws-1').registeredRoleIds).toEqual(['role-a'])
    expect(harness.state.data.workspaces.find((workspace: any) => workspace.id === 'ws-2').registeredRoleIds).toEqual(['role-c'])

    harness.manager.setWorkspaceRoleRegistered('role-a', false)
    harness.manager.setWorkspaceRoleRegistered('role-b', true)
    expect(harness.state.draft.workspaceRegisteredRoleIds).toEqual(['role-b'])

    await harness.manager.saveWorkspaceEditor()

    const saveRequest = requests.find((request) => request.method === 'POST' && request.path === '/api/workspaces')
    expect(saveRequest?.body.registeredRoleIds).toEqual(['role-b'])
    expect(harness.state.data.workspaces.find((workspace: any) => workspace.id === 'ws-1').registeredRoleIds).toEqual(['role-b'])
    expect(harness.state.data.workspaces.find((workspace: any) => workspace.id === 'ws-2').registeredRoleIds).toEqual(['role-c'])
    expect(harness.state.data.roles.map((role: any) => role.id)).toEqual(['role-a', 'role-b', 'role-c'])
    expect(harness.state.draft.activeRoleId).toBe('role-a')

    await harness.manager.refreshWorkspaces('ws-1')
    expect(harness.state.draft.activeRoleId).toBe('role-a')
  })

  it('保存没有当前角色的工作区时按原行为选中第一个角色', async () => {
    const store = createWorkspaceStore()
    const { netRequest } = createWorkspaceNetRequest(store)
    const harness = createHarness({}, netRequest)
    harness.state.data.workspaces = [store['ws-1'], store['ws-2']]
    harness.state.draft.activeRoleId = ''
    harness.state.data.ui.activeRoleId = ''

    harness.manager.openWorkspaceEditorInPlace('ws-1')
    harness.manager.setWorkspaceRoleRegistered('role-b', true)
    await harness.manager.saveWorkspaceEditor()

    expect(harness.state.data.workspaces.find((workspace: any) => workspace.id === 'ws-1').registeredRoleIds).toEqual(['role-a', 'role-b'])
    expect(harness.state.draft.activeRoleId).toBe('role-a')
  })
})

describe('无当前角色时的会话操作', () => {
  it('没有当前角色时不能创建新会话', () => {
    const harness = createHarness({})
    harness.state.draft.activeRoleId = ''
    harness.state.data.ui.activeRoleId = ''

    harness.manager.createChatForActiveWorkspace()

    expect(harness.state.pendingWorkspaceChat ?? null).toBeNull()
  })

  it('注册并选择一个角色后可以创建新会话', () => {
    const harness = createHarness({})
    harness.state.data.workspaces[0].registeredRoleIds = ['role-b']
    harness.state.draft.activeRoleId = 'role-b'
    harness.state.data.ui.activeRoleId = 'role-b'

    harness.manager.createChatForActiveWorkspace()

    expect(harness.state.pendingWorkspaceChat).toMatchObject({ workspaceId: 'ws-1', roleId: 'role-b' })
  })

  it('当前角色不在注册清单中也不被状态层判空，仍可创建新会话', () => {
    const harness = createHarness({})
    harness.state.data.workspaces[0].registeredRoleIds = []
    harness.state.draft.activeRoleId = 'role-a'
    harness.state.data.ui.activeRoleId = 'role-a'

    harness.manager.createChatForActiveWorkspace()

    expect(harness.state.pendingWorkspaceChat).toMatchObject({ workspaceId: 'ws-1', roleId: 'role-a' })
  })
})

describe('工作区角色范围', () => {
  it('进入工作区时当前角色为空则按原行为选中第一个角色', () => {
    const harness = createHarness({})
    harness.state.data.workspaces[0].registeredRoleIds = ['role-a', 'role-b']
    harness.state.draft.activeRoleId = ''
    harness.state.data.ui.activeRoleId = ''

    harness.manager.setActiveWorkspace('ws-1')

    expect(harness.state.draft.activeRoleId).toBe('role-a')
  })

  it('进入工作区时当前角色不在已注册清单中也原样保留，不按注册校验清空', () => {
    const harness = createHarness({})
    harness.state.data.workspaces[0].registeredRoleIds = ['role-a', 'role-b']
    harness.state.draft.activeRoleId = 'role-c'
    harness.state.data.ui.activeRoleId = 'role-c'

    harness.manager.setActiveWorkspace('ws-1')

    expect(harness.state.draft.activeRoleId).toBe('role-c')
    expect(harness.state.data.ui.activeRoleId).toBe('role-c')
    expect(boxOf(harness.state, workspaceRoleTargetId('ws-1', 'role-a'))).toBeUndefined()
  })

  it('进入工作区时当前角色已注册则保留并加载该角色组合', async () => {
    const harness = createHarness({
      [workspaceRoleTargetId('ws-1', 'role-b')]: [{ id: 'session-b1', roleId: 'role-b', workspaceId: 'ws-1', title: 'B 的会话', messages: [] }],
    })
    harness.state.data.workspaces[0].registeredRoleIds = ['role-a', 'role-b']
    harness.state.draft.activeRoleId = 'role-b'
    harness.state.data.ui.activeRoleId = 'role-b'

    harness.manager.setActiveWorkspace('ws-1')

    expect(harness.state.draft.activeRoleId).toBe('role-b')
    await vi.waitFor(() => {
      expect(boxOf(harness.state, workspaceRoleTargetId('ws-1', 'role-b'))?.chatMetas?.map((meta: any) => meta.id)).toEqual(['session-b1'])
    })
    expect(boxOf(harness.state, workspaceRoleTargetId('ws-1', 'role-a'))).toBeUndefined()
  })

  it('从角色模式直接切换工作区角色时补全工作区目标身份，activeChat 命中工作区会话盒', async () => {
    const harness = createHarness({
      [workspaceRoleTargetId('ws-1', 'role-b')]: [{ id: 'session-b1', roleId: 'role-b', workspaceId: 'ws-1', title: 'B 的会话', messages: [] }],
    })
    harness.state.draft.activeTargetKind = 'role'
    harness.state.draft.activeWorkspaceId = ''
    harness.state.data.ui.activeWorkspaceId = 'ws-1'
    harness.state.draft.activeRoleId = 'role-a'
    harness.state.data.ui.activeRoleId = 'role-a'
    harness.state.data.chatsByRole['role-a'] = {
      activeChatId: 'role-chat',
      chatMetas: [{ id: 'role-chat', title: '角色会话', createdAt: 1, updatedAt: 1 }],
      chats: [{ id: 'role-chat', title: '角色会话', messages: [] }],
    }
    const accessors = createStateAccessors({ getState: () => harness.state })

    expect(accessors.activeChat()?.id).toBe('role-chat')

    harness.manager.setWorkspaceRole('role-b')

    expect(harness.state.draft.activeTargetKind).toBe('workspace')
    expect(harness.state.draft.activeWorkspaceId).toBe('ws-1')
    expect(harness.state.draft.activeRoleId).toBe('role-b')
    await vi.waitFor(() => {
      expect(accessors.activeChat()?.id).toBe('session-b1')
    })
  })

  it('没有已注册角色的工作区仍可进入，并按原行为加载第一个角色组合', async () => {
    const harness = createHarness({ [workspaceRoleTargetId('ws-empty', 'role-a')]: [] })
    harness.state.data.workspaces.push({ id: 'ws-empty', name: '空工作区', directories: [], prompt: '', registeredRoleIds: [], createdAt: 2, updatedAt: 2 })
    harness.state.draft.activeRoleId = ''
    harness.state.data.ui.activeRoleId = ''

    harness.manager.setActiveWorkspace('ws-empty')

    expect(harness.state.draft.activeTargetKind).toBe('workspace')
    expect(harness.state.draft.activeWorkspaceId).toBe('ws-empty')
    expect(harness.state.draft.activeRoleId).toBe('role-a')
    await vi.waitFor(() => {
      expect(boxOf(harness.state, workspaceRoleTargetId('ws-empty', 'role-a'))).toBeTruthy()
    })
  })

  it('读取没有已注册角色的工作区时保留当前角色并按原行为请求会话', async () => {
    const store = {
      'ws-empty': { id: 'ws-empty', name: '空工作区', directories: [], prompt: '', registeredRoleIds: [], createdAt: 1, updatedAt: 1 },
    } as Record<string, any>
    const { netRequest, requests } = createWorkspaceNetRequest(store)
    const harness = createHarness({}, netRequest)
    harness.state.draft.activeTargetKind = 'workspace'
    harness.state.draft.activeWorkspaceId = 'ws-empty'
    harness.state.draft.activeRoleId = 'role-a'

    await harness.manager.refreshWorkspaces('ws-empty')

    expect(harness.state.draft.activeRoleId).toBe('role-a')
    expect(requests.some((request) => String(request.path || '') === '/api/workspaces/ws-empty/roles/role-a/sessions')).toBe(true)
  })
})

describe('工作区手动排序', () => {
  it('整行拖拽后立即更新视窗顺序，并把完整顺序写入业务端', async () => {
    const requests: any[] = []
    const netRequest = vi.fn(async (req: any) => {
      requests.push(req)
      return { body: {} }
    })
    const harness = createHarness({}, netRequest)
    harness.state.data.workspaces = [
      { id: 'ws-1', name: '一', directories: [], prompt: '', createdAt: 1, updatedAt: 1 },
      { id: 'ws-2', name: '二', directories: [], prompt: '', createdAt: 2, updatedAt: 2 },
      { id: 'ws-3', name: '三', directories: [], prompt: '', createdAt: 3, updatedAt: 3 },
    ]

    await harness.manager.moveWorkspace('ws-1', 'ws-3', 'after')

    expect(harness.state.data.workspaces.map((workspace: any) => workspace.id)).toEqual(['ws-2', 'ws-3', 'ws-1'])
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      method: 'PUT',
      path: '/api/workspaces/order',
      body: { ids: ['ws-2', 'ws-3', 'ws-1'] },
    })
  })

  it('业务端拒绝排序时回滚视窗顺序', async () => {
    const netRequest = vi.fn(async () => {
      throw new Error('排序失败')
    })
    const harness = createHarness({}, netRequest)
    harness.state.data.workspaces = [
      { id: 'ws-1', name: '一', directories: [], prompt: '', createdAt: 1, updatedAt: 1 },
      { id: 'ws-2', name: '二', directories: [], prompt: '', createdAt: 2, updatedAt: 2 },
    ]

    await harness.manager.moveWorkspace('ws-1', 'ws-2', 'after')

    expect(harness.state.data.workspaces.map((workspace: any) => workspace.id)).toEqual(['ws-1', 'ws-2'])
  })
})

describe('取消注册与重新注册保留会话', () => {
  it('取消注册不删除会话与消息，重新注册并选中后原会话恢复，会话归属不变', async () => {
    const store = {
      'ws-1': { id: 'ws-1', name: '工作区一', directories: [], prompt: '', registeredRoleIds: ['role-a', 'role-b'], createdAt: 1, updatedAt: 1 },
    } as Record<string, any>
    const sessionsByCombination = {
      [workspaceRoleTargetId('ws-1', 'role-a')]: [
        {
          id: 'session-a1',
          roleId: 'role-a',
          workspaceId: 'ws-1',
          title: 'A 的会话',
          messages: [{ id: 'message-a1', role: 'user', content: '保留我' }],
        },
      ],
    }
    const { netRequest, requests } = createRegistrationNetRequest(store, sessionsByCombination)
    const harness = createHarness(sessionsByCombination, netRequest)
    harness.state.data.workspaces = Object.values(store)

    harness.manager.setActiveWorkspace('ws-1')
    await vi.waitFor(() => {
      const box = boxOf(harness.state, workspaceRoleTargetId('ws-1', 'role-a'))
      expect(box?.chats?.[0]?.messages?.[0]?.content).toBe('保留我')
    })

    const boxBefore = boxOf(harness.state, workspaceRoleTargetId('ws-1', 'role-a'))
    const beforeUnregister = requests.length
    harness.manager.openWorkspaceEditorInPlace('ws-1')
    harness.manager.setWorkspaceRoleRegistered('role-a', false)
    await harness.manager.saveWorkspaceEditor()

    const unregisterRequests = requests.slice(beforeUnregister)
    expect(store['ws-1'].registeredRoleIds).toEqual(['role-b'])
    expect(harness.state.draft.activeRoleId).toBe('role-a')
    expect(unregisterRequests.some((request) => request.method === 'DELETE')).toBe(false)
    expect(unregisterRequests.some((request) => String(request.path || '') === '/api/workspaces/ws-1/roles/role-a/sessions')).toBe(true)
    expect(boxOf(harness.state, workspaceRoleTargetId('ws-1', 'role-a'))).toBe(boxBefore)
    expect(boxBefore.chats[0].messages.map((message: any) => message.content)).toEqual(['保留我'])

    harness.manager.openWorkspaceEditorInPlace('ws-1')
    harness.manager.setWorkspaceRoleRegistered('role-a', true)
    await harness.manager.saveWorkspaceEditor()

    expect(store['ws-1'].registeredRoleIds).toEqual(['role-b', 'role-a'])
    expect(harness.state.draft.activeRoleId).toBe('role-a')

    const beforeReselect = requests.length
    harness.manager.setWorkspaceRole('role-a')
    await vi.waitFor(() => {
      const box = boxOf(harness.state, workspaceRoleTargetId('ws-1', 'role-a'))
      expect(box?.chatMetas?.map((meta: any) => meta.id)).toEqual(['session-a1'])
      expect(box?.chats?.[0]?.messages?.[0]?.content).toBe('保留我')
    })

    const reselectRequests = requests.slice(beforeReselect)
    expect(reselectRequests.some((request) => String(request.path || '') === '/api/workspaces/ws-1/roles/role-a/sessions')).toBe(true)
    expect(reselectRequests.some((request) => String(request.path || '').includes('/roles/role-b/'))).toBe(false)
    expect(boxOf(harness.state, workspaceRoleTargetId('ws-1', 'role-b'))).toBeUndefined()
    expect(harness.state.draft.activeRoleId).toBe('role-a')
  })
})

function createSessionOpsNetRequest() {
  const requests: any[] = []
  const netRequest = vi.fn(async (req: any) => {
    requests.push(req)
    const method = String(req?.method || '')
    const path = String(req?.path || '')
    const detailMatch = path.match(/^\/api\/workspaces\/([^/]+)\/roles\/([^/]+)\/sessions\/([^/]+)$/)
    if (method === 'GET' && detailMatch) {
      return {
        body: {
          id: decodeURIComponent(detailMatch[3]),
          roleId: decodeURIComponent(detailMatch[2]),
          workspaceId: decodeURIComponent(detailMatch[1]),
          title: '旧标题',
          createdAt: 1000,
          updatedAt: 1000,
          messages: [],
        },
      }
    }
    if (method === 'PATCH' && /^\/api\/workspaces\/[^/]+\/roles\/[^/]+\/sessions\/[^/]+\/title$/.test(path)) {
      return { body: {} }
    }
    if (method === 'DELETE' && detailMatch) return { body: {} }
    throw new Error(`未预期的请求：${method} ${path}`)
  })
  return { netRequest, requests }
}

function seedWorkspaceChat(state: any, workspaceId: string, roleId: string, chatId: string) {
  const targetId = workspaceRoleTargetId(workspaceId, roleId)
  state.data.chatsByWorkspace[targetId] = {
    activeChatId: chatId,
    chatMetas: [{ id: chatId, title: '旧标题', createdAt: 1, updatedAt: 1 }],
    chats: [{ id: chatId, roleId, workspaceId, title: '旧标题', messages: [] }],
  }
}

describe('工作区会话身份：独立参数与自身角色', () => {
  it('重命名使用会话自身的角色，不受全局当前角色影响', async () => {
    const { netRequest, requests } = createSessionOpsNetRequest()
    const harness = createHarness({}, netRequest)
    seedWorkspaceChat(harness.state, 'ws-1', 'role-b', 'session-b1')

    const ok = await harness.manager.renameWorkspaceChatTitle('ws-1', 'role-b', 'session-b1', '新标题')

    expect(ok).toBe(true)
    expect(requests[0]).toMatchObject({
      method: 'PATCH',
      path: '/api/workspaces/ws-1/roles/role-b/sessions/session-b1/title',
    })
    expect(boxOf(harness.state, workspaceRoleTargetId('ws-1', 'role-b'))?.chats?.[0]?.title).toBe('新标题')
    expect(harness.state.draft.activeRoleId).toBe('role-a')
  })

  it('删除使用会话自身的角色并清理该会话收藏', async () => {
    const { netRequest, requests } = createSessionOpsNetRequest()
    const cleanupFavoriteRefsForChat = vi.fn()
    const harness = createHarness({}, netRequest, { cleanupFavoriteRefsForChat })
    seedWorkspaceChat(harness.state, 'ws-1', 'role-b', 'session-b1')

    const ok = await harness.manager.deleteChatForWorkspace('ws-1', 'role-b', 'session-b1')

    expect(ok).toBe(true)
    expect(requests[0]).toMatchObject({
      method: 'DELETE',
      path: '/api/workspaces/ws-1/roles/role-b/sessions/session-b1',
    })
    expect(boxOf(harness.state, workspaceRoleTargetId('ws-1', 'role-b'))?.chats).toEqual([])
    expect(cleanupFavoriteRefsForChat).toHaveBeenCalledWith('workspace', 'ws-1', 'role-b', 'session-b1')
    expect(harness.state.draft.activeRoleId).toBe('role-a')
  })

  it('加载会话使用显式角色，不退回全局当前角色', async () => {
    const { netRequest, requests } = createSessionOpsNetRequest()
    const harness = createHarness({}, netRequest)

    const chat = await harness.manager.ensureWorkspaceChatLoaded('ws-1', 'role-b', 'session-b1')

    expect(chat?.roleId).toBe('role-b')
    expect(requests.some((request) => String(request.path || '') === '/api/workspaces/ws-1/roles/role-b/sessions/session-b1')).toBe(true)
    expect(boxOf(harness.state, workspaceRoleTargetId('ws-1', 'role-b'))?.chats?.[0]?.id).toBe('session-b1')
    expect(boxOf(harness.state, workspaceRoleTargetId('ws-1', 'role-a'))).toBeUndefined()
    expect(harness.state.draft.activeRoleId).toBe('role-a')
  })

  it('工作区、角色与会话编号各自编码进独立路径段', async () => {
    const { netRequest, requests } = createSessionOpsNetRequest()
    const harness = createHarness({}, netRequest)

    await harness.manager.ensureWorkspaceChatLoaded('ws/1', 'role/1', 'session 1')
    await harness.manager.renameWorkspaceChatTitle('ws/1', 'role/1', 'session 1', '新标题')
    await harness.manager.deleteChatForWorkspace('ws/1', 'role/1', 'session 1')

    const paths = requests.map((request) => String(request.path || ''))
    expect(paths).toContain('/api/workspaces/ws%2F1/roles/role%2F1/sessions/session%201')
    expect(paths).toContain('/api/workspaces/ws%2F1/roles/role%2F1/sessions/session%201/title')
    expect(paths).toContain('/api/workspaces/ws%2F1/roles/role%2F1/sessions/session%201')
    expect(boxOf(harness.state, workspaceRoleTargetId('ws/1', 'role/1'))).toBeTruthy()
  })
})
