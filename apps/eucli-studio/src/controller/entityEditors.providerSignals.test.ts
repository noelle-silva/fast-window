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
