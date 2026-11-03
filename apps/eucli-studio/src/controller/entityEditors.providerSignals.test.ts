import { describe, expect, it, vi } from 'vitest'
import { NEW_PROVIDER_ID, NEW_ROLE_ID } from '../domain/constants'
import { refreshScopes } from '../domain/uiRefreshScope'
import { createEntityEditors } from './entityEditors'

function createHarness() {
  const state: any = {
    data: {
      roles: [],
      groups: [],
      chatsByRole: {},
      chatsByGroup: {},
      settings: {
        providers: [
          {
            id: 'provider-a',
            name: '主供应商',
            baseUrl: 'https://a.example/v1',
            apiKey: '',
            protocol: 'openai',
            apiKeyStrategy: 'sequential',
            apiKeys: [{ id: 'key-a', name: 'Key A', key: 'sk-a', enabled: true, weight: 1 }],
            registeredModels: [],
            modelsCache: { items: [], fetchedAt: 0 },
          },
          {
            id: 'provider-b',
            name: '备用供应商',
            baseUrl: 'https://b.example/v1',
            apiKey: '',
            protocol: 'openai',
            apiKeyStrategy: 'sequential',
            apiKeys: [{ id: 'key-b', name: 'Key B', key: 'sk-b', enabled: true, weight: 1 }],
            registeredModels: [],
            modelsCache: { items: [], fetchedAt: 0 },
          },
        ],
      },
    },
    draft: {
      activeTargetKind: 'role',
      activeRoleId: '',
      activeGroupId: '',
      editRoleId: '',
      editProviderId: '',
      roleName: '',
      roleSystemPrompt: '',
      roleTemperature: '1',
      roleTemperatureEnabled: false,
      roleModelCandidates: [],
      roleDefaultModelCandidateId: '',
      roleToolPolicy: { tools: [], nativeTools: [], runModes: {} },
      providerName: '',
      providerBaseUrl: '',
      providerApiKey: '',
      providerProtocol: '',
      providerApiKeyStrategy: 'sequential',
      providerApiKeys: [],
      providerRegisteredModels: [],
    },
  }
  const emitScope = vi.fn()
  const closeModal = vi.fn(() => {
    state.modal = ''
    emitScope(refreshScopes.uiShell())
  })
  const showToast = vi.fn()
  const saveRoleEntity = vi.fn(async () => {})
  const saveProviderEntity = vi.fn(async () => {})
  const removeProviderEntity = vi.fn(async () => {})
  const editors = createEntityEditors({
    getState: () => state,
    save: async () => {},
    saveRoleEntity,
    saveProviderEntity,
    removeProviderEntity,
    emitScope,
    closeModal,
    showToast,
    filesImages: {},
    cleanupFavoriteRefsForTarget: () => {},
    cleanupFavoriteRefsForChat: () => {},
  })
  return { state, emitScope, closeModal, showToast, saveRoleEntity, saveProviderEntity, removeProviderEntity, editors }
}

describe('供应商实体通知', () => {
  it('新建供应商只建立草稿：不入列表，也不发 entities:providers', () => {
    const harness = createHarness()

    harness.editors.createProvider()

    expect(harness.state.data.settings.providers).toHaveLength(2)
    expect(harness.state.draft.editProviderId).toBe(NEW_PROVIDER_ID)
    expect(harness.state.draft.providerName).toBe('新供应商（OpenAI 兼容）')
    expect(harness.state.draft.providerBaseUrl).toBe('http://')
    expect(harness.state.draft.providerProtocol).toBe('')
    expect(harness.state.draft.providerApiKeyStrategy).toBe('sequential')
    expect(harness.state.draft.providerApiKeys).toEqual([])
    expect(harness.state.draft.providerRegisteredModels).toEqual([])
    expect(harness.emitScope.mock.calls.map((call) => call[0])).toEqual([refreshScopes.uiShell()])
  })

  it('新建草稿保存成功后只持久化一次，插入列表并保留选中', async () => {
    const harness = createHarness()
    harness.editors.createProvider()
    harness.state.draft.providerBaseUrl = ' https://new.example/v1 '
    harness.state.draft.providerProtocol = 'openai'
    harness.state.draft.providerApiKeys = [{ id: 'key-new', name: ' Key New ', key: ' sk-new ', enabled: true, weight: '2' }]
    harness.emitScope.mockClear()

    await harness.editors.saveProviderInlineEditor()

    expect(harness.saveProviderEntity).toHaveBeenCalledTimes(1)
    expect(harness.state.data.settings.providers).toHaveLength(3)
    const created = harness.state.data.settings.providers[0]
    expect(created.id).not.toBe(NEW_PROVIDER_ID)
    expect(created.name).toBe('新供应商（OpenAI 兼容）')
    expect(created.baseUrl).toBe('https://new.example/v1')
    expect(created.apiKeys).toEqual([{ id: 'key-new', name: 'Key New', key: 'sk-new', enabled: true, weight: 2 }])
    expect(harness.state.draft.editProviderId).toBe(created.id)
    expect(harness.emitScope.mock.calls.map((call) => call[0])).toEqual([
      refreshScopes.entities('providers'),
      refreshScopes.uiShell(),
    ])
  })

  it('新建草稿保存失败不插入列表，草稿保留以便重试', async () => {
    const harness = createHarness()
    harness.saveProviderEntity.mockRejectedValueOnce(new Error('disk full'))
    harness.editors.createProvider()
    harness.state.draft.providerProtocol = 'openai'
    harness.state.draft.providerApiKeys = [{ id: 'key-new', name: 'Key New', key: 'sk-new', enabled: true, weight: 1 }]
    harness.emitScope.mockClear()

    await harness.editors.saveProviderInlineEditor()

    expect(harness.saveProviderEntity).toHaveBeenCalledTimes(1)
    expect(harness.state.data.settings.providers).toHaveLength(2)
    expect(harness.state.draft.editProviderId).toBe(NEW_PROVIDER_ID)
    expect(harness.state.draft.providerName).toBe('新供应商（OpenAI 兼容）')
    expect(harness.emitScope.mock.calls.map((call) => call[0])).toEqual([refreshScopes.uiShell()])
  })

  it('删除没有目录记录的幽灵供应商成功', async () => {
    const harness = createHarness()
    harness.state.data.settings.providers.push({
      id: 'ghost-provider',
      name: '幽灵供应商',
      baseUrl: 'http://',
      apiKey: '',
      protocol: 'openai',
      apiKeyStrategy: 'sequential',
      apiKeys: [],
      registeredModels: [],
      modelsCache: { items: [], fetchedAt: 0 },
    })

    const ok = await harness.editors.deleteProvider('ghost-provider')

    expect(ok).toBe(true)
    expect(harness.removeProviderEntity).toHaveBeenCalledWith('ghost-provider')
    expect(harness.state.data.settings.providers.some((provider: any) => provider.id === 'ghost-provider')).toBe(false)
    expect(harness.emitScope.mock.calls.map((call) => call[0])).toEqual([
      refreshScopes.entities('providers'),
      refreshScopes.uiShell(),
    ])
  })

  it('删除新建草稿只清空编辑态，不触碰实体', async () => {
    const harness = createHarness()
    harness.state.draft.editProviderId = NEW_PROVIDER_ID

    const ok = await harness.editors.deleteProvider(NEW_PROVIDER_ID)

    expect(ok).toBe(true)
    expect(harness.removeProviderEntity).not.toHaveBeenCalled()
    expect(harness.state.data.settings.providers).toHaveLength(2)
    expect(harness.state.draft.editProviderId).toBe('')
    expect(harness.emitScope.mock.calls.map((call) => call[0])).toEqual([refreshScopes.uiShell()])
  })

  it('保存供应商后保留编辑选中，并把归一化结果回写到草稿', async () => {
    const harness = createHarness()
    harness.state.draft.editProviderId = 'provider-b'
    harness.state.draft.providerName = '  主供应商  '
    harness.state.draft.providerBaseUrl = ' https://b.example/v1 '
    harness.state.draft.providerProtocol = 'anthropic'
    harness.state.draft.providerApiKeyStrategy = 'weighted_random'
    harness.state.draft.providerApiKeys = [
      { id: 'key-b', name: ' Key B ', key: ' sk-b ', enabled: false, weight: '3' },
      { id: '', name: '缺 Key', key: '', enabled: true, weight: 1 },
    ]

    await harness.editors.saveProviderInlineEditor()

    expect(harness.saveProviderEntity).toHaveBeenCalledTimes(1)
    expect(harness.state.draft.editProviderId).toBe('provider-b')
    expect(harness.state.draft.providerName).toBe('主供应商（2）')
    expect(harness.state.draft.providerBaseUrl).toBe('https://b.example/v1')
    expect(harness.state.draft.providerProtocol).toBe('anthropic')
    expect(harness.state.draft.providerApiKeyStrategy).toBe('weighted_random')
    expect(harness.state.draft.providerApiKeys).toEqual([
      { id: 'key-b', name: 'Key B', key: 'sk-b', enabled: false, weight: 3 },
    ])
    expect(harness.emitScope.mock.calls.map((call) => call[0])).toEqual([
      refreshScopes.entities('providers'),
      refreshScopes.uiShell(),
    ])
  })

  it('保留选中后再次保存幂等，不会重复改名或追加 Key', async () => {
    const harness = createHarness()
    harness.state.draft.editProviderId = 'provider-b'
    harness.state.draft.providerName = '主供应商'
    harness.state.draft.providerBaseUrl = 'https://b.example/v1'
    harness.state.draft.providerProtocol = 'openai'
    harness.state.draft.providerApiKeys = [{ id: 'key-b', name: 'Key B', key: 'sk-b', enabled: true, weight: 1 }]

    await harness.editors.saveProviderInlineEditor()
    await harness.editors.saveProviderInlineEditor()

    const provider = harness.state.data.settings.providers.find((item: any) => item.id === 'provider-b')
    expect(harness.saveProviderEntity).toHaveBeenCalledTimes(2)
    expect(harness.state.draft.editProviderId).toBe('provider-b')
    expect(harness.state.draft.providerName).toBe('主供应商（2）')
    expect(provider.name).toBe('主供应商（2）')
    expect(provider.apiKeys).toHaveLength(1)
  })

  it('已有供应商：登记模型缺少映射原始模型时拒绝保存并定位行号', async () => {
    const harness = createHarness()
    harness.state.draft.editProviderId = 'provider-b'
    harness.state.draft.providerName = '备用供应商'
    harness.state.draft.providerBaseUrl = 'https://b.example/v1'
    harness.state.draft.providerProtocol = 'openai'
    harness.state.draft.providerApiKeys = [{ id: 'key-b', name: 'Key B', key: 'sk-b', enabled: true, weight: 1 }]
    harness.state.draft.providerRegisteredModels = [
      { id: 'model-ok', name: '正常模型', sourceModelId: 'raw-ok' },
      { id: 'model-broken', name: '缺映射模型', sourceModelId: '  ' },
    ]

    await harness.editors.saveProviderInlineEditor()

    expect(harness.saveProviderEntity).not.toHaveBeenCalled()
    const provider = harness.state.data.settings.providers.find((item: any) => item.id === 'provider-b')
    expect(provider.registeredModels).toEqual([])
    expect(harness.showToast).toHaveBeenCalledTimes(1)
    expect(harness.showToast).toHaveBeenCalledWith('登记模型第 2 行的「映射原始模型」未选择', { kind: 'error' })
  })

  it('新建草稿：登记模型缺少映射原始模型时拒绝保存', async () => {
    const harness = createHarness()
    harness.editors.createProvider()
    harness.state.draft.providerProtocol = 'openai'
    harness.state.draft.providerApiKeys = [{ id: 'key-new', name: 'Key New', key: 'sk-new', enabled: true, weight: 1 }]
    harness.state.draft.providerRegisteredModels = [{ id: 'model-new', name: '新模型', sourceModelId: '' }]

    await harness.editors.saveProviderInlineEditor()

    expect(harness.saveProviderEntity).not.toHaveBeenCalled()
    expect(harness.state.data.settings.providers).toHaveLength(2)
    expect(harness.state.draft.editProviderId).toBe(NEW_PROVIDER_ID)
    expect(harness.showToast).toHaveBeenCalledWith('登记模型第 1 行的「映射原始模型」未选择', { kind: 'error' })
  })

  it('已有供应商：登记模型 ID 为空时拒绝保存', async () => {
    const harness = createHarness()
    harness.state.draft.editProviderId = 'provider-b'
    harness.state.draft.providerName = '备用供应商'
    harness.state.draft.providerBaseUrl = 'https://b.example/v1'
    harness.state.draft.providerProtocol = 'openai'
    harness.state.draft.providerApiKeys = [{ id: 'key-b', name: 'Key B', key: 'sk-b', enabled: true, weight: 1 }]
    harness.state.draft.providerRegisteredModels = [{ id: '  ', name: '无 ID 模型', sourceModelId: 'raw-1' }]

    await harness.editors.saveProviderInlineEditor()

    expect(harness.saveProviderEntity).not.toHaveBeenCalled()
    expect(harness.showToast).toHaveBeenCalledWith('登记模型第 1 行的「自定义模型 ID」未填写', { kind: 'error' })
  })

  it('已有供应商：登记模型 ID 重复时拒绝保存并指出重复行', async () => {
    const harness = createHarness()
    harness.state.draft.editProviderId = 'provider-b'
    harness.state.draft.providerName = '备用供应商'
    harness.state.draft.providerBaseUrl = 'https://b.example/v1'
    harness.state.draft.providerProtocol = 'openai'
    harness.state.draft.providerApiKeys = [{ id: 'key-b', name: 'Key B', key: 'sk-b', enabled: true, weight: 1 }]
    harness.state.draft.providerRegisteredModels = [
      { id: 'model-dup', name: '模型 A', sourceModelId: 'raw-a' },
      { id: ' model-dup ', name: '模型 B', sourceModelId: 'raw-b' },
    ]

    await harness.editors.saveProviderInlineEditor()

    expect(harness.saveProviderEntity).not.toHaveBeenCalled()
    expect(harness.showToast).toHaveBeenCalledWith('登记模型第 2 行的「自定义模型 ID」与第 1 行重复', { kind: 'error' })
  })

  it('已有供应商：登记模型合法时保存成功并写入规范化结果', async () => {
    const harness = createHarness()
    harness.state.draft.editProviderId = 'provider-b'
    harness.state.draft.providerName = '备用供应商'
    harness.state.draft.providerBaseUrl = 'https://b.example/v1'
    harness.state.draft.providerProtocol = 'openai'
    harness.state.draft.providerApiKeys = [{ id: 'key-b', name: ' Key B ', key: ' sk-b ', enabled: true, weight: '1' }]
    harness.state.draft.providerRegisteredModels = [
      { id: ' model-1 ', name: ' 模型一 ', sourceModelId: ' raw-1 ', supportsReasoning: true, defaultReasoningEffort: 'high' },
      { id: 'model-2', name: '模型二', sourceModelId: 'raw-2', supportsReasoning: false },
    ]

    await harness.editors.saveProviderInlineEditor()

    expect(harness.saveProviderEntity).toHaveBeenCalledTimes(1)
    const provider = harness.state.data.settings.providers.find((item: any) => item.id === 'provider-b')
    expect(provider.registeredModels).toEqual([
      { id: 'model-1', name: '模型一', sourceModelId: 'raw-1', supportsReasoning: true, defaultReasoningEffort: 'high' },
      { id: 'model-2', name: '模型二', sourceModelId: 'raw-2' },
    ])
    expect(harness.showToast).toHaveBeenCalledWith('供应商已保存', { kind: 'success' })
  })
})

describe('角色实体通知', () => {
  it('新建角色成功后补发 entities:roles，uiShell 只由 closeModal 发出一次', async () => {
    const harness = createHarness()
    harness.state.draft.editRoleId = NEW_ROLE_ID
    harness.state.draft.roleName = '新角色'
    harness.state.draft.roleSystemPrompt = '你是测试角色'
    harness.state.draft.roleModelCandidates = [{ kind: 'provider', providerId: 'provider-a', groupId: '', modelId: 'gpt-4o' }]
    harness.state.draft.roleDefaultModelCandidateId = 'provider:provider-a:gpt-4o'

    await harness.editors.saveRoleEditor()

    expect(harness.saveRoleEntity).toHaveBeenCalledTimes(1)
    expect(harness.closeModal).toHaveBeenCalledTimes(1)
    expect(harness.emitScope.mock.calls.map((call) => call[0])).toEqual([
      refreshScopes.entities('roles'),
      refreshScopes.uiShell(),
    ])
    expect(harness.state.data.roles[0]?.name).toBe('新角色')
  })
})
