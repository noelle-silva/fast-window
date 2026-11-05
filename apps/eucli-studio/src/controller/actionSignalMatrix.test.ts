// 动作 → 刷新信号行为矩阵。
//
// 每条动作断言三件事：
// 1. 至少发出约定地址（避免界面静默不更新）；
// 2. uiShell 次数精确匹配（避免重复通知或漏发）；
// 3. 不发 global 广播（避免用一个全局地址掩盖缺失的精确地址）。
//
// 矩阵按真实动作入口驱动，不读源码字符串；新增动作时直接往 SIGNAL_MATRIX 加一行。
import { describe, expect, it, vi } from 'vitest'
import { NEW_ROLE_ID } from '../domain/constants'
import { refreshScopes } from '../domain/uiRefreshScope'
import { createEntityActions } from './actions/entityActions'
import { createModalHelpers } from './controllerHelpers'
import { createEntityEditors } from './entityEditors'
import { createWorkspaceManager } from './workspaceManager'

type SignalResult = Promise<unknown> | unknown
type MatrixRow = {
  action: string
  expected: readonly string[]
  uiShellCount: number
  forbidden?: readonly string[]
  execute: () => Promise<string[]>
}

const entities = (domain: string) => refreshScopes.entities(domain)
const uiShell = refreshScopes.uiShell()
const navigation = refreshScopes.navigation()
const globalScope = refreshScopes.global()

function readSignals(emitScope: ReturnType<typeof vi.fn>): string[] {
  return emitScope.mock.calls.map((call) => String(call[0]))
}

function createChatBox() {
  return { activeChatId: '', chatMetas: [], chats: [] }
}

function createRole(id: string, name: string) {
  return {
    id,
    name,
    avatarImage: '',
    systemPrompt: `你是${name}`,
    temperature: 1,
    temperatureEnabled: false,
    hookPromptPresetId: '',
    modelCandidates: [{ kind: 'provider', providerId: 'provider-a', groupId: '', modelId: 'gpt-4o' }],
    defaultModelCandidateId: 'provider:provider-a:gpt-4o',
    toolPolicy: { tools: [], nativeTools: [], runModes: {} },
    createdAt: 1,
    updatedAt: 1,
  }
}

function createGroup(id: string, name: string) {
  return {
    id,
    name,
    avatarImage: '',
    prompt: '',
    mode: 'roundRobin',
    memberRoleIds: ['role-a'],
    roundRobinOrder: ['role-a'],
    random: { weightsByRoleId: { 'role-a': 1 }, minCount: 1, maxCount: 1 },
    createdAt: 1,
    updatedAt: 1,
  }
}

function createProvider(id: string, name: string) {
  return {
    id,
    name,
    baseUrl: `https://${id}.example/v1`,
    apiKey: '',
    protocol: 'openai',
    apiKeyStrategy: 'sequential',
    apiKeys: [{ id: `key-${id}`, name: 'Key', key: `sk-${id}`, enabled: true, weight: 1 }],
    registeredModels: [],
    modelsCache: { items: [], fetchedAt: 0 },
  }
}

type EditorHarnessOptions = {
  failRoleSave?: boolean
  failRoleDelete?: boolean
  failGroupDelete?: boolean
  failProviderSave?: boolean
  failProviderDelete?: boolean
}

function createEditorHarness(options: EditorHarnessOptions = {}) {
  const state: any = {
    data: {
      roles: [createRole('role-a', '角色A'), createRole('role-b', '角色B')],
      groups: [createGroup('group-a', '群组A'), createGroup('group-b', '群组B')],
      chatsByRole: { 'role-a': createChatBox(), 'role-b': createChatBox() },
      chatsByGroup: { 'group-a': createChatBox(), 'group-b': createChatBox() },
      workspaces: [],
      settings: {
        providers: [createProvider('provider-a', '供应商A'), createProvider('provider-b', '供应商B')],
      },
    },
    draft: {
      activeTargetKind: 'role',
      activeRoleId: 'role-a',
      activeGroupId: 'group-a',
      activeWorkspaceId: '',
      editRoleId: '',
      editGroupId: '',
      editProviderId: '',
      editWorkspaceId: '',
      roleName: '',
      roleAvatarImage: '',
      roleSystemPrompt: '',
      roleTemperature: '1',
      roleTemperatureEnabled: false,
      roleModelCandidates: [],
      roleDefaultModelCandidateId: '',
      roleToolPolicy: { tools: [], nativeTools: [], runModes: {} },
      roleToolAddOpen: false,
      roleToolSearch: '',
      roleToolAddSelected: [],
      groupName: '',
      groupAvatarImage: '',
      groupPrompt: '',
      groupMode: 'roundRobin',
      groupMemberRoleIds: [],
      groupRoundRobinOrder: [],
      groupRandomWeights: {},
      groupRandomMinCount: 1,
      groupRandomMaxCount: 1,
      providerName: '',
      providerBaseUrl: '',
      providerApiKey: '',
      providerProtocol: '',
      providerApiKeyStrategy: 'sequential',
      providerApiKeys: [],
      providerRegisteredModels: [],
      workspaceName: '',
      workspacePrompt: '',
      workspaceDirectories: [],
      workspaceRegisteredRoleIds: [],
      deleteRoleId: '',
      deleteGroupId: '',
      deleteProviderId: '',
      deleteWorkspaceId: '',
    },
    modal: '',
  }
  const emitScope = vi.fn()
  const showToast = vi.fn()
  const { closeModal } = createModalHelpers({ state, emitScope })
  const saveRoleEntity = vi.fn(async () => {
    if (options.failRoleSave) throw new Error('角色保存失败')
  })
  const removeRoleEntity = vi.fn(async () => {
    if (options.failRoleDelete) throw new Error('角色删除失败')
  })
  const removeGroupEntity = vi.fn(async () => {
    if (options.failGroupDelete) throw new Error('群组删除失败')
  })
  const saveProviderEntity = vi.fn(async () => {
    if (options.failProviderSave) throw new Error('供应商保存失败')
  })
  const removeProviderEntity = vi.fn(async () => {
    if (options.failProviderDelete) throw new Error('供应商删除失败')
  })
  const editors = createEntityEditors({
    getState: () => state,
    save: async () => {},
    saveRoleEntity,
    removeRoleEntity,
    saveGroupEntity: vi.fn(async () => {}),
    removeGroupEntity,
    saveProviderEntity,
    removeProviderEntity,
    emitScope,
    closeModal,
    showToast,
    shrinkImageDataUrl: async (dataUrl: string) => dataUrl,
    filesImages: {},
    cleanupFavoriteRefsForTarget: () => {},
    cleanupFavoriteRefsForChat: () => {},
  })
  return {
    state,
    emitScope,
    closeModal,
    showToast,
    editors,
    signals: () => readSignals(emitScope),
  }
}

async function editorSignals(options: EditorHarnessOptions, run: (harness: ReturnType<typeof createEditorHarness>) => SignalResult) {
  const harness = createEditorHarness(options)
  await run(harness)
  return harness.signals()
}

function editProviderDraft(harness: ReturnType<typeof createEditorHarness>) {
  harness.state.draft.editProviderId = 'provider-b'
  harness.state.draft.providerName = '供应商B改名'
  harness.state.draft.providerBaseUrl = 'https://provider-b.example/v1'
  harness.state.draft.providerProtocol = 'openai'
  harness.state.draft.providerApiKeyStrategy = 'sequential'
  harness.state.draft.providerApiKeys = [
    { id: 'key-provider-b', name: 'Key', key: 'sk-provider-b', enabled: true, weight: 1 },
  ]
  harness.state.draft.providerRegisteredModels = []
}

function editRoleDraft(harness: ReturnType<typeof createEditorHarness>, roleId: string) {
  harness.state.draft.editRoleId = roleId
  harness.state.draft.roleName = '角色A改名'
  harness.state.draft.roleSystemPrompt = '你是角色A'
  harness.state.draft.roleModelCandidates = [
    { kind: 'provider', providerId: 'provider-a', groupId: '', modelId: 'gpt-4o' },
  ]
  harness.state.draft.roleDefaultModelCandidateId = 'provider:provider-a:gpt-4o'
  harness.state.draft.roleToolPolicy = { tools: [], nativeTools: [], runModes: {} }
}

type ActionHarnessOptions = {
  failRoleReorder?: boolean
  failProviderReorder?: boolean
}

function createActionHarness(options: ActionHarnessOptions = {}) {
  const state: any = {
    data: {
      roles: [{ id: 'role-a' }, { id: 'role-b' }, { id: 'role-c' }],
      settings: { providers: [{ id: 'provider-a' }, { id: 'provider-b' }] },
    },
    draft: {},
  }
  const emitScope = vi.fn()
  const showToast = vi.fn()
  const reorderRoles = vi.fn(async () => {
    if (options.failRoleReorder) throw new Error('角色排序失败')
  })
  const reorderProviders = vi.fn(async () => {
    if (options.failProviderReorder) throw new Error('供应商排序失败')
  })
  const actions = createEntityActions({
    state,
    emitScope,
    showToast,
    reorderRoles,
    reorderProviders,
    moveWorkspace: async () => {},
  } as any)
  return {
    state,
    emitScope,
    actions,
    signals: () => readSignals(emitScope),
  }
}

async function actionSignals(options: ActionHarnessOptions, run: (harness: ReturnType<typeof createActionHarness>) => SignalResult) {
  const harness = createActionHarness(options)
  await run(harness)
  return harness.signals()
}

function createWorkspaceRecord(id: string, name: string, registeredRoleIds: string[]) {
  return {
    id,
    name,
    directories: [],
    prompt: '',
    registeredRoleIds,
    actualPrompt: '',
    createdAt: 1,
    updatedAt: 1,
  }
}

type WorkspaceHarnessOptions = {
  failSave?: boolean
  failDelete?: boolean
}

function createWorkspaceHarness(options: WorkspaceHarnessOptions = {}) {
  const store: Record<string, any> = {
    'ws-1': createWorkspaceRecord('ws-1', '工作区一', ['role-a']),
    'ws-2': createWorkspaceRecord('ws-2', '工作区二', ['role-b']),
  }
  const netRequest = vi.fn(async (req: any) => {
    const method = String(req?.method || '')
    const path = String(req?.path || '')
    if (method === 'GET' && path === '/api/workspaces') {
      return { body: Object.values(store).map((workspace) => ({ id: workspace.id })) }
    }
    const detailMatch = path.match(/^\/api\/workspaces\/([^/]+)$/)
    if (method === 'GET' && detailMatch) {
      const workspace = store[decodeURIComponent(detailMatch[1])]
      if (!workspace) throw new Error(`工作区不存在：${decodeURIComponent(detailMatch[1])}`)
      return { body: workspace }
    }
    if (method === 'POST' && path === '/api/workspaces') {
      if (options.failSave) throw new Error('工作区保存失败')
      store[String(req.body.id)] = { ...req.body }
      return { body: req.body }
    }
    if (method === 'DELETE' && detailMatch) {
      if (options.failDelete) throw new Error('工作区删除失败')
      delete store[decodeURIComponent(detailMatch[1])]
      return { body: {} }
    }
    if (method === 'GET' && /^\/api\/workspaces\/[^/]+\/roles\/[^/]+\/sessions$/.test(path)) {
      return { body: [] }
    }
    throw new Error(`未预期的请求：${method} ${path}`)
  })
  const state: any = {
    loading: false,
    draft: {
      activeTargetKind: 'workspace',
      activeRoleId: 'role-a',
      activeGroupId: '',
      activeWorkspaceId: 'ws-1',
      editWorkspaceId: '',
      workspaceName: '',
      workspacePrompt: '',
      workspaceDirectories: [],
      workspaceRegisteredRoleIds: [],
      deleteRoleId: '',
      deleteGroupId: '',
      deleteProviderId: '',
      deleteWorkspaceId: '',
    },
    data: {
      roles: [{ id: 'role-a', name: '角色A' }, { id: 'role-b', name: '角色B' }],
      workspaces: Object.values(store),
      chatsByRole: {},
      chatsByGroup: {},
      chatsByWorkspace: {},
    },
  }
  const emit = vi.fn()
  const emitScope = vi.fn()
  const showToast = vi.fn()
  const { closeModal } = createModalHelpers({ state, emitScope })
  const manager = createWorkspaceManager({
    getState: () => state,
    netRequest,
    emit,
    emitScope,
    closeModal,
    saveMeta: async () => {},
    scrollToBottomSoon: () => {},
    showToast,
    shrinkImageDataUrl: async (dataUrl: string) => dataUrl,
    activeTargetKind: () => String(state.draft.activeTargetKind || 'role'),
    activeRole: () => state.data.roles.find((role: any) => String(role.id) === String(state.draft.activeRoleId)) || null,
    activeWorkspace: () =>
      state.data.workspaces.find((workspace: any) => String(workspace.id) === String(state.draft.activeWorkspaceId)) || null,
    clearPendingWorkspaceChat: () => {
      state.pendingWorkspaceChat = null
    },
    cleanupFavoriteRefsForTarget: () => {},
  })
  return {
    state,
    emit,
    emitScope,
    closeModal,
    showToast,
    manager,
    signals: () => readSignals(emitScope),
  }
}

async function workspaceSignals(
  options: WorkspaceHarnessOptions,
  run: (harness: ReturnType<typeof createWorkspaceHarness>) => SignalResult,
) {
  const harness = createWorkspaceHarness(options)
  await run(harness)
  return harness.signals()
}

function createConfirmEntityActions(input: {
  state: any
  emitScope: (scope: string) => void
  closeModal: (options?: { notify?: boolean }) => void
  showToast: (message: string, options?: any) => void
  deleteRole?: (roleId: string, options?: any) => Promise<boolean>
  deleteGroup?: (groupId: string, options?: any) => Promise<boolean>
  deleteProvider?: (providerId: string, options?: any) => Promise<boolean>
  deleteWorkspaceEditor?: (workspaceId: string, options?: any) => Promise<boolean>
}) {
  return createEntityActions({
    state: input.state,
    emitScope: input.emitScope,
    closeModal: input.closeModal,
    showToast: input.showToast,
    saveMeta: async () => {},
    getProvider: () => null,
    reorderRoles: async () => {},
    reorderProviders: async () => {},
    moveWorkspace: async () => {},
    deleteRole: input.deleteRole || (async () => false),
    deleteGroup: input.deleteGroup || (async () => false),
    deleteProvider: input.deleteProvider || (async () => false),
    deleteWorkspaceEditor: input.deleteWorkspaceEditor || (async () => false),
  } as any)
}

function expectConfirmDeleteSignals(signals: string[], domain: string, navigationCount: number) {
  expect(signals.filter((signal) => signal === uiShell)).toHaveLength(1)
  expect(signals.filter((signal) => signal === entities(domain))).toHaveLength(1)
  expect(signals.filter((signal) => signal.startsWith('entities:'))).toEqual([entities(domain)])
  expect(signals.filter((signal) => signal === navigation)).toHaveLength(navigationCount)
  expect(signals).not.toContain(refreshScopes.settings())
  expect(signals).not.toContain(globalScope)
}

function editWorkspaceDraft(harness: ReturnType<typeof createWorkspaceHarness>) {
  harness.state.draft.editWorkspaceId = 'ws-1'
  harness.state.draft.workspaceName = '工作区一改名'
  harness.state.draft.workspacePrompt = ''
  harness.state.draft.workspaceDirectories = []
  harness.state.draft.workspaceRegisteredRoleIds = ['role-a']
}

const SIGNAL_MATRIX: readonly MatrixRow[] = [
  {
    action: '新建供应商只建立草稿',
    expected: [uiShell],
    uiShellCount: 1,
    forbidden: [globalScope, entities('providers')],
    execute: () => editorSignals({}, (harness) => harness.editors.createProvider()),
  },
  {
    action: '保存供应商成功',
    expected: [entities('providers'), uiShell],
    uiShellCount: 1,
    execute: () =>
      editorSignals({}, (harness) => {
        editProviderDraft(harness)
        return harness.editors.saveProviderInlineEditor()
      }),
  },
  {
    action: '保存供应商确定失败',
    expected: [entities('providers'), uiShell],
    uiShellCount: 1,
    execute: () =>
      editorSignals({ failProviderSave: true }, (harness) => {
        editProviderDraft(harness)
        return harness.editors.saveProviderInlineEditor()
      }),
  },
  {
    action: '删除供应商成功',
    expected: [entities('providers'), uiShell],
    uiShellCount: 1,
    execute: () => editorSignals({}, (harness) => harness.editors.deleteProvider('provider-b')),
  },
  {
    action: '删除供应商失败',
    expected: [entities('providers'), uiShell],
    uiShellCount: 1,
    execute: () =>
      editorSignals({ failProviderDelete: true }, (harness) => harness.editors.deleteProvider('provider-b')),
  },
  {
    action: '新建角色成功',
    expected: [entities('roles'), uiShell],
    uiShellCount: 1,
    execute: () =>
      editorSignals({}, (harness) => {
        editRoleDraft(harness, NEW_ROLE_ID)
        return harness.editors.saveRoleEditor()
      }),
  },
  {
    action: '保存已有角色成功',
    // 保存已有角色成功会同时补发 entities:roles 与关闭弹层触发的 uiShell。
    expected: [entities('roles'), uiShell],
    uiShellCount: 1,
    execute: () =>
      editorSignals({}, (harness) => {
        editRoleDraft(harness, 'role-a')
        return harness.editors.saveRoleEditor()
      }),
  },
  {
    action: '保存已有角色确定失败',
    expected: [entities('roles'), uiShell],
    uiShellCount: 1,
    execute: () =>
      editorSignals({ failRoleSave: true }, (harness) => {
        editRoleDraft(harness, 'role-a')
        return harness.editors.saveRoleEditor()
      }),
  },
  {
    action: '删除角色成功',
    expected: [entities('roles'), navigation, uiShell],
    uiShellCount: 1,
    execute: () => editorSignals({}, (harness) => harness.editors.deleteRole('role-b')),
  },
  {
    action: '删除角色失败',
    expected: [entities('roles'), navigation, uiShell],
    uiShellCount: 1,
    execute: () => editorSignals({ failRoleDelete: true }, (harness) => harness.editors.deleteRole('role-b')),
  },
  {
    action: '保存已有群组成功',
    // 保存已有群组成功会同时补发 entities:groups 与关闭弹层触发的 uiShell。
    expected: [entities('groups'), uiShell],
    uiShellCount: 1,
    execute: () =>
      editorSignals({}, (harness) => {
        harness.state.draft.editGroupId = 'group-a'
        harness.state.draft.groupName = '群组A改名'
        harness.state.draft.groupPrompt = ''
        harness.state.draft.groupMode = 'roundRobin'
        harness.state.draft.groupMemberRoleIds = ['role-a']
        harness.state.draft.groupRoundRobinOrder = ['role-a']
        harness.state.draft.groupRandomWeights = { 'role-a': 1 }
        harness.state.draft.groupRandomMinCount = 1
        harness.state.draft.groupRandomMaxCount = 1
        return harness.editors.saveGroupEditor()
      }),
  },
  {
    action: '删除群组成功',
    expected: [entities('groups'), navigation, uiShell],
    uiShellCount: 1,
    execute: () => editorSignals({}, (harness) => harness.editors.deleteGroup('group-b')),
  },
  {
    action: '删除群组失败',
    expected: [entities('groups'), navigation, uiShell],
    uiShellCount: 1,
    execute: () => editorSignals({ failGroupDelete: true }, (harness) => harness.editors.deleteGroup('group-b')),
  },
  {
    action: '供应商排序 moveProvider',
    expected: [entities('providers')],
    uiShellCount: 0,
    execute: () => actionSignals({}, (harness) => harness.actions.moveProvider('provider-a', 'provider-b', 'after')),
  },
  {
    action: '角色排序 moveRole',
    expected: [entities('roles')],
    uiShellCount: 0,
    execute: () => actionSignals({}, (harness) => harness.actions.moveRole('role-a', 'role-b', 'after')),
  },
  {
    action: '保存工作区成功',
    expected: [entities('workspaces'), uiShell],
    uiShellCount: 1,
    execute: () =>
      workspaceSignals({}, (harness) => {
        editWorkspaceDraft(harness)
        return harness.manager.saveWorkspaceEditor()
      }),
  },
  {
    action: '保存工作区失败',
    expected: [uiShell],
    uiShellCount: 1,
    execute: () =>
      workspaceSignals({ failSave: true }, (harness) => {
        editWorkspaceDraft(harness)
        return harness.manager.saveWorkspaceEditor()
      }),
  },
  {
    action: '粘贴 SVG 图标源码只改草稿',
    expected: [uiShell],
    uiShellCount: 1,
    execute: () =>
      workspaceSignals({}, (harness) =>
        harness.manager.setWorkspaceIconSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"/>'),
      ),
  },
  {
    action: '清除工作区图标只改草稿',
    expected: [uiShell],
    uiShellCount: 1,
    execute: () => workspaceSignals({}, (harness) => harness.manager.clearWorkspaceIcon()),
  },
  {
    action: '删除工作区成功',
    expected: [entities('workspaces'), navigation, uiShell],
    uiShellCount: 1,
    execute: () => workspaceSignals({}, (harness) => harness.manager.deleteWorkspaceEditor('ws-2')),
  },
  {
    action: '删除工作区失败',
    expected: [entities('workspaces'), navigation, uiShell],
    uiShellCount: 1,
    execute: () => workspaceSignals({ failDelete: true }, (harness) => harness.manager.deleteWorkspaceEditor('ws-2')),
  },
]

describe('动作 → 刷新信号矩阵', () => {
  for (const row of SIGNAL_MATRIX) {
    it(row.action, async () => {
      const signals = await row.execute()

      for (const address of row.expected) {
        expect(signals, `${row.action} 缺少刷新地址 ${address}`).toContain(address)
      }
      expect(signals.filter((signal) => signal === uiShell).length, `${row.action} 的 uiShell 次数`).toBe(row.uiShellCount)
      for (const address of row.forbidden ?? [globalScope]) {
        expect(signals, `${row.action} 不得发全局广播 ${address}`).not.toContain(address)
      }
    })
  }
})

describe('确认删除通知收口', () => {
  it('确认删除角色成功：uiShell、角色域、导航各一次', async () => {
    const harness = createEditorHarness()
    harness.state.draft.deleteRoleId = 'role-b'
    const actions = createConfirmEntityActions({
      state: harness.state,
      emitScope: harness.emitScope,
      closeModal: harness.closeModal,
      showToast: harness.showToast,
      deleteRole: harness.editors.deleteRole,
    })

    await actions.confirmDelete()

    expectConfirmDeleteSignals(harness.signals(), 'roles', 1)
    expect(harness.state.data.roles.some((role: any) => role.id === 'role-b')).toBe(false)
  })

  it('确认删除角色失败：uiShell、角色域、导航各一次，保留失败提示', async () => {
    const harness = createEditorHarness({ failRoleDelete: true })
    harness.state.draft.deleteRoleId = 'role-b'
    const actions = createConfirmEntityActions({
      state: harness.state,
      emitScope: harness.emitScope,
      closeModal: harness.closeModal,
      showToast: harness.showToast,
      deleteRole: harness.editors.deleteRole,
    })

    await actions.confirmDelete()

    expectConfirmDeleteSignals(harness.signals(), 'roles', 1)
    expect(harness.state.data.roles.some((role: any) => role.id === 'role-b')).toBe(true)
    expect(harness.showToast).toHaveBeenCalledWith('角色删除失败', { kind: 'error' })
  })

  it('确认删除供应商成功：uiShell 与供应商域各一次，不发导航', async () => {
    const harness = createEditorHarness()
    harness.state.draft.deleteProviderId = 'provider-b'
    const actions = createConfirmEntityActions({
      state: harness.state,
      emitScope: harness.emitScope,
      closeModal: harness.closeModal,
      showToast: harness.showToast,
      deleteProvider: harness.editors.deleteProvider,
    })

    await actions.confirmDelete()

    expectConfirmDeleteSignals(harness.signals(), 'providers', 0)
    expect(harness.state.data.settings.providers.some((provider: any) => provider.id === 'provider-b')).toBe(false)
  })

  it('确认删除供应商失败：uiShell 与供应商域各一次，保留失败提示', async () => {
    const harness = createEditorHarness({ failProviderDelete: true })
    harness.state.draft.deleteProviderId = 'provider-b'
    const actions = createConfirmEntityActions({
      state: harness.state,
      emitScope: harness.emitScope,
      closeModal: harness.closeModal,
      showToast: harness.showToast,
      deleteProvider: harness.editors.deleteProvider,
    })

    await actions.confirmDelete()

    expectConfirmDeleteSignals(harness.signals(), 'providers', 0)
    expect(harness.state.data.settings.providers.some((provider: any) => provider.id === 'provider-b')).toBe(true)
    expect(harness.showToast).toHaveBeenCalledWith('供应商删除失败', { kind: 'error' })
  })

  it('确认删除工作区成功：uiShell、工作区域、导航各一次', async () => {
    const harness = createWorkspaceHarness()
    harness.state.draft.deleteWorkspaceId = 'ws-2'
    const actions = createConfirmEntityActions({
      state: harness.state,
      emitScope: harness.emitScope,
      closeModal: harness.closeModal,
      showToast: harness.showToast,
      deleteWorkspaceEditor: harness.manager.deleteWorkspaceEditor,
    })

    await actions.confirmDelete()

    expectConfirmDeleteSignals(harness.signals(), 'workspaces', 1)
    expect(harness.state.data.workspaces.some((workspace: any) => workspace.id === 'ws-2')).toBe(false)
  })

  it('确认删除工作区失败：uiShell、工作区域、导航各一次，保留失败提示', async () => {
    const harness = createWorkspaceHarness({ failDelete: true })
    harness.state.draft.deleteWorkspaceId = 'ws-2'
    const actions = createConfirmEntityActions({
      state: harness.state,
      emitScope: harness.emitScope,
      closeModal: harness.closeModal,
      showToast: harness.showToast,
      deleteWorkspaceEditor: harness.manager.deleteWorkspaceEditor,
    })

    await actions.confirmDelete()

    expectConfirmDeleteSignals(harness.signals(), 'workspaces', 1)
    expect(harness.state.data.workspaces.some((workspace: any) => workspace.id === 'ws-2')).toBe(true)
    expect(harness.showToast).toHaveBeenCalledWith('工作区删除失败', { kind: 'error' })
  })
})
