// 设置页面板的数据快照：从 controller 当前状态即时派生，不做缓存。
//
// 面板宿主每次重渲染都调用这里，因此即使状态切片被整体替换
// （例如 moveRole 直接换了 roles 数组引用），面板也不会读到旧 props。
import type { SettingsTabValue } from '../../domain/settingsNavigation'
import { normalizeRequestRecordViewOptions } from '../../domain/requestRecordViewOptions'
import type { HookPromptLibrary } from '../../domain/hookPrompt'
import type { PlaceholderLibrary } from '../../domain/placeholder'

export type SettingsTargetKind = 'role' | 'group' | 'workspace'

export type SettingsPanelState = {
  loading: boolean
  data: any
  roles: any[]
  groups: any[]
  workspaces: any[]
  providers: any[]
  modelGroups: any
  modelGroupItems: any[]
  // providerCapabilities 是业务端声明的协议与思考档位清单，客户端只渲染不持有枚举。
  providerCapabilities: { protocols: any[]; reasoningEfforts: any[] }
  models: any
  tools: any
  toolWorkDirectory: any
  modelRequestConfig: any
  conversationImageConfig: any
  requestRecords: any
  requestRecordViewOptions: any
  accessSettings: any
  hookPrompts: any
  placeholders: any
  systemPlugins: any
  draft: any
  activeRoleId: string
  activeWorkspaceId: string
  activeGroupId: string
  activeTargetKind: SettingsTargetKind
}

const EMPTY_HOOK_PROMPTS = {
  loading: false,
  error: '',
  library: { presets: [] } as HookPromptLibrary,
}

const EMPTY_PLACEHOLDERS = {
  loading: false,
  error: '',
  library: { placeholders: [], folders: [] } as PlaceholderLibrary,
  preview: { text: '', problems: [] },
  problems: [],
  dependencyTree: { name: '' },
}

const EMPTY_SYSTEM_PLUGINS = {
  loading: false,
  error: '',
  items: [],
  selectedPluginId: '',
  selectedPlugin: null,
  availableInterfaces: [],
}

// readProviderCapabilities 读取 controller 缓存里的清单：缓存的清单在 value 字段下。
// 清单缺席时返回空数组，由渲染层退化成「只显示已保存的值」，客户端绝不编造选项。
function readProviderCapabilities(state: any) {
  const box = asObject(state?.providerCapabilities) as { value?: unknown } | null
  const value = asObject(box?.value) as { protocols?: unknown; reasoningEfforts?: unknown } | null
  return {
    protocols: Array.isArray(value?.protocols) ? value.protocols : [],
    reasoningEfforts: Array.isArray(value?.reasoningEfforts) ? value.reasoningEfforts : [],
  }
}

function asObject(value: unknown) {
  return value && typeof value === 'object' ? value : null
}

export function readSettingsTargetKind(state: any): SettingsTargetKind {
  const raw = String(state?.draft?.activeTargetKind || state?.data?.ui?.activeTargetKind || 'role').trim()
  return raw === 'group' ? 'group' : raw === 'workspace' ? 'workspace' : 'role'
}

export function readSettingsPanelState(controller: any): SettingsPanelState {
  const state = controller?.getState?.() || {}
  const data = state.data
  const modelGroups = asObject(state.modelGroups) || {}
  const requestRecordViewOptions = normalizeRequestRecordViewOptions(data?.settings?.requestRecordViewOptions)

  return {
    loading: !!state.loading,
    data,
    roles: Array.isArray(data?.roles) ? data.roles : [],
    groups: Array.isArray(data?.groups) ? data.groups : [],
    workspaces: Array.isArray(data?.workspaces) ? data.workspaces : [],
    providers: Array.isArray(data?.settings?.providers) ? data.settings.providers : [],
    modelGroups,
    modelGroupItems: Array.isArray((modelGroups as any).items) ? (modelGroups as any).items : [],
    providerCapabilities: readProviderCapabilities(state),
    models: state.models,
    tools: state.tools,
    toolWorkDirectory: state.toolWorkDirectory,
    modelRequestConfig: state.modelRequestConfig,
    conversationImageConfig: state.conversationImageConfig,
    requestRecords: state.requestRecords,
    requestRecordViewOptions,
    accessSettings: state.accessSettings,
    hookPrompts: asObject(state.hookPrompts) || EMPTY_HOOK_PROMPTS,
    placeholders: asObject(state.placeholders) || EMPTY_PLACEHOLDERS,
    systemPlugins: asObject(state.systemPlugins) || EMPTY_SYSTEM_PLUGINS,
    draft: state.draft,
    activeRoleId: String(state.draft?.activeRoleId || ''),
    activeWorkspaceId: String(state.draft?.activeWorkspaceId || data?.ui?.activeWorkspaceId || ''),
    activeGroupId: String(state.draft?.activeGroupId || data?.ui?.activeGroupId || ''),
    activeTargetKind: readSettingsTargetKind(state),
  }
}

export type SettingsPanelRenderContext = {
  bootstrap?: any
  releaseViews: any
  onReleaseRefresh: (kind?: string) => Promise<void> | void
  dataDirectory?: any
  eucliBoxConnection?: any
  activeTab: SettingsTabValue
}
