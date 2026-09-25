import { now } from '../core/utils'
import type { AiChatShowToast } from '../gateway/capabilities'
import { isArtifactBusy, normalizeArtifactInstallState, normalizeArtifactInstallStateList, type ArtifactInstallState } from '../domain/release'
import { createArtifactInstallTracker, type ArtifactInstallStateMap } from './artifactInstallTracker'
import { normalizeCompatibilityStatus, normalizeEucliBoxCompatibility } from '../domain/release'

type InstallTerminalListener = (id: string, state: ArtifactInstallState) => void

export function createToolCatalog(deps: {
  getState: () => any
  netRequest: (req: any) => Promise<any>
  emit: () => void
  showToast?: AiChatShowToast
}) {
  let installTerminalListener: InstallTerminalListener | null = null

  function currentCatalog() {
    const state = deps.getState()
    if (!state.tools || typeof state.tools !== 'object') state.tools = defaultToolCatalogState()
    return { state, catalog: state.tools }
  }

  function patchCatalog(patch: Record<string, any>) {
    const { state, catalog } = currentCatalog()
    state.tools = { ...defaultToolCatalogState(), ...catalog, ...patch }
  }

  function installStates(): ArtifactInstallStateMap {
    const { catalog } = currentCatalog()
    return catalog.installStates && typeof catalog.installStates === 'object' ? catalog.installStates : {}
  }

  function applyInstallState(toolId: string, state: ArtifactInstallState) {
    patchCatalog({ installStates: { ...installStates(), [toolId]: state } })
  }

  const installTracker = createArtifactInstallTracker({
    loadState: async (toolId) => {
      const response = await deps.netRequest({ method: 'GET', path: `/api/tools/${encodeURIComponent(toolId)}/install-state`, timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      return normalizeArtifactInstallState(response?.body)
    },
    cancel: async (toolId) => {
      const response = await deps.netRequest({ method: 'POST', path: `/api/tools/${encodeURIComponent(toolId)}/cancel`, body: {}, timeoutMs: 30000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      return normalizeArtifactInstallState(response?.body)
    },
    loadOperations: async () => {
      const response = await deps.netRequest({ method: 'GET', path: '/api/artifact-operations', timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      return normalizeArtifactInstallStateList(response?.body).filter((state) => String(state.artifact?.kind || '') === 'tool')
    },
    getStates: installStates,
    setStates: (states) => {
      patchCatalog({ installStates: states })
      deps.emit()
    },
    onTerminal: (toolId, state) => {
      void refreshTools(true).catch(() => {})
      if (state.status === 'failed') {
        deps.showToast?.(`「${toolId}」安装或更新失败：${state.error.message || '未知原因'}`, { kind: 'error' })
      }
      installTerminalListener?.(toolId, state)
      deps.emit()
    },
  })

  async function refreshTools(force = false) {
    const { state, catalog } = currentCatalog()
    const age = now() - Number(catalog.fetchedAt || 0)
    if (!force && Array.isArray(catalog.items) && catalog.items.length && age < 60 * 1000) return catalog.items

    patchCatalog({ loading: true, error: '', items: Array.isArray(catalog.items) ? catalog.items : [], fetchedAt: Number(catalog.fetchedAt || 0) })
    deps.emit()

    try {
      const response = await deps.netRequest({ method: 'GET', path: '/api/tools', timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const items = normalizeToolSummaries(response?.body)
      patchCatalog({ loading: false, error: '', items, fetchedAt: now() })
      return items
    } catch (e: any) {
      const error = String(e?.message || e || '工具列表加载失败')
      patchCatalog({ loading: false, error, items: Array.isArray(catalog.items) ? catalog.items : [], fetchedAt: Number(catalog.fetchedAt || 0) })
      deps.showToast?.(error, { kind: 'error' })
      return state.tools.items
    } finally {
      deps.emit()
    }
  }

  async function openToolConfig(toolIdRaw: any) {
    const toolId = String(toolIdRaw || '').trim()
    if (!toolId) return null
    patchCatalog({ detailLoading: true, detailError: '', selectedToolId: toolId, selectedTool: null, configDraft: {}, promptDescriptionDraft: '', capabilityGrantsDraft: {}, saveError: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'GET', path: `/api/tools/${encodeURIComponent(toolId)}`, timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const tool = normalizeToolDefinition(response?.body)
      patchCatalog({ detailLoading: false, detailError: '', selectedToolId: String(tool.id || toolId), selectedTool: tool, configDraft: clonePlainObject(tool.userConfig), promptDescriptionDraft: String(tool.promptDescriptionOverride ?? ''), capabilityGrantsDraft: normalizeCapabilityGrants(tool.capabilityGrants), saveError: '' })
      return tool
    } catch (e: any) {
      const error = String(e?.message || e || '工具详情加载失败')
      patchCatalog({ detailLoading: false, detailError: error })
      deps.showToast?.(error, { kind: 'error' })
      return null
    } finally {
      deps.emit()
    }
  }

  function closeToolConfig() {
    patchCatalog({ selectedToolId: '', selectedTool: null, configDraft: {}, promptDescriptionDraft: '', capabilityGrantsDraft: {}, detailError: '', saveError: '' })
    deps.emit()
  }

  function setToolConfigValue(path: any, value: any) {
    const segments = normalizeConfigPath(path)
    if (!segments.length) return
    const { catalog } = currentCatalog()
    const draft = clonePlainObject(catalog.configDraft)
    setValueAtPath(draft, segments, value)
    patchCatalog({ configDraft: draft, saveError: '' })
    deps.emit()
  }

  function removeToolConfigValue(path: any) {
    const segments = normalizeConfigPath(path)
    if (!segments.length) return
    const { catalog } = currentCatalog()
    const draft = clonePlainObject(catalog.configDraft)
    removeValueAtPath(draft, segments)
    patchCatalog({ configDraft: draft, saveError: '' })
    deps.emit()
  }

  function setToolPromptDescriptionDraft(value: any) {
    patchCatalog({ promptDescriptionDraft: String(value ?? ''), saveError: '' })
    deps.emit()
  }

  function resetToolPromptDescriptionDraftToDefault() {
    patchCatalog({ promptDescriptionDraft: '', saveError: '' })
    deps.emit()
  }

  // setToolCapabilityGrant 按标准能力项（id:access）增删授权草稿；
  // 授权项只保存开启状态，关闭即移除键。
  function setToolCapabilityGrant(keyRaw: any, granted: any) {
    const key = String(keyRaw || '').trim()
    if (!key) return
    const { catalog } = currentCatalog()
    const draft = { ...clonePlainObject(catalog.capabilityGrantsDraft) }
    if (granted) {
      draft[key] = true
    } else {
      delete draft[key]
    }
    patchCatalog({ capabilityGrantsDraft: draft, saveError: '' })
    deps.emit()
  }

  async function saveSelectedToolConfig() {
    const { catalog } = currentCatalog()
    const toolId = String(catalog.selectedToolId || catalog.selectedTool?.id || '').trim()
    if (!toolId) return false

    const userConfig = clonePlainObject(catalog.configDraft)
    const promptDescriptionOverride = String(catalog.promptDescriptionDraft ?? '')
    const capabilityGrants = clonePlainObject(catalog.capabilityGrantsDraft)

    patchCatalog({ saving: true, saveError: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'PUT', path: `/api/tools/${encodeURIComponent(toolId)}/user-config`, body: { userConfig, promptDescriptionOverride, capabilityGrants }, timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const tool = normalizeToolDefinition(response?.body)
      patchCatalog({ saving: false, saveError: '', selectedTool: tool, selectedToolId: String(tool.id || toolId), configDraft: clonePlainObject(tool.userConfig), promptDescriptionDraft: String(tool.promptDescriptionOverride ?? ''), capabilityGrantsDraft: normalizeCapabilityGrants(tool.capabilityGrants) })
      await refreshTools(true)
      deps.showToast?.('工具配置已保存', { kind: 'success' })
      return true
    } catch (e: any) {
      const error = String(e?.message || e || '工具配置保存失败')
      patchCatalog({ saving: false, saveError: error })
      deps.showToast?.(error, { kind: 'error' })
      return false
    } finally {
      deps.emit()
    }
  }

  function installTool(toolIdRaw: any) {
    return startToolOperation(toolIdRaw, 'install')
  }

  function updateTool(toolIdRaw: any) {
    return startToolOperation(toolIdRaw, 'update')
  }

  // startToolOperation 发起安装或更新：请求立即返回运行态并交给任务跟踪；
  // 同步返回的阻止事实按工具占用交互处理。
  async function startToolOperation(toolIdRaw: any, action: 'install' | 'update') {
    const toolId = String(toolIdRaw || '').trim()
    if (!toolId) return null
    try {
      const response = await deps.netRequest({ method: 'POST', path: `/api/tools/${encodeURIComponent(toolId)}/${action}`, body: {}, timeoutMs: 60000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const state = normalizeArtifactInstallState(response?.body)
      applyInstallState(toolId, state)
      if (isArtifactBusy(state)) {
        installTracker.track(toolId)
        return state
      }
      if (action === 'update' && state.status === 'blocked' && (state.error.code === 'TOOL_ACTIVE' || state.error.code === 'ARTIFACT_UPDATE_IN_PROGRESS')) {
        askBusyReplacement(toolId, action)
        return state
      }
      await refreshTools(true).catch(() => {})
      return state
    } catch (e: any) {
      const error = String(e?.message || e || (action === 'install' ? '工具安装失败' : '工具更新失败'))
      deps.showToast?.(error, { kind: 'error' })
      return null
    } finally {
      deps.emit()
    }
  }

  // cancelToolInstall 取消正在进行的安装或更新；终态由任务跟踪写回。
  function cancelToolInstall(toolIdRaw: any) {
    const toolId = String(toolIdRaw || '').trim()
    if (!toolId) return Promise.resolve(null)
    return installTracker.cancel(toolId)
  }

  // syncToolInstallStates 批量恢复安装任务事实；面板或商店打开时调用。
  function syncToolInstallStates() {
    return installTracker.sync()
  }

  function setInstallTerminalListener(listener: InstallTerminalListener | null) {
    installTerminalListener = typeof listener === 'function' ? listener : null
  }

  async function stopTool(toolIdRaw: any) {
    const toolId = String(toolIdRaw || '').trim()
    if (!toolId) return null
    const response = await deps.netRequest({ method: 'POST', path: `/api/tools/${encodeURIComponent(toolId)}/stop`, body: {}, timeoutMs: 15000 })
    const status = Number(response?.status || 0)
    if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
    return response?.body
  }

  function askBusyReplacement(toolIdRaw: any, action: 'install' | 'update') {
    const toolId = String(toolIdRaw || '').trim()
    if (!toolId) return
    patchCatalog({ busyPrompt: { toolId, action } })
    deps.emit()
  }

  function dismissBusyPrompt() {
    patchCatalog({ busyPrompt: null })
    deps.emit()
  }

  async function confirmStopAndContinue() {
    const { catalog } = currentCatalog()
    const pending = catalog.busyPrompt as { toolId?: string; action?: 'install' | 'update' } | null
    const toolId = String(pending?.toolId || '').trim()
    const action = pending?.action === 'install' ? 'install' : 'update'
    patchCatalog({ busyPrompt: null, stopping: true })
    deps.emit()
    try {
      await stopTool(toolId)
      await startToolOperation(toolId, action)
    } catch (e: any) {
      const error = String(e?.message || e || '停止工具失败')
      deps.showToast?.(error, { kind: 'error' })
    } finally {
      patchCatalog({ stopping: false })
      deps.emit()
    }
  }

  function dispose() {
    installTracker.dispose()
  }

  return { refreshTools, openToolConfig, closeToolConfig, setToolConfigValue, removeToolConfigValue, setToolPromptDescriptionDraft, resetToolPromptDescriptionDraftToDefault, setToolCapabilityGrant, saveSelectedToolConfig, installTool, updateTool, cancelToolInstall, syncToolInstallStates, setInstallTerminalListener, stopTool, confirmStopAndContinue, dismissBusyPrompt, dispose }
}

function defaultToolCatalogState() {
  return {
    loading: false,
    error: '',
    items: [] as any[],
    fetchedAt: 0,
    detailLoading: false,
    detailError: '',
    selectedToolId: '',
    selectedTool: null as any,
    configDraft: {} as Record<string, any>,
    promptDescriptionDraft: '',
    capabilityGrantsDraft: {} as Record<string, boolean>,
    saving: false,
    saveError: '',
    installStates: {} as ArtifactInstallStateMap,
    busyPrompt: null as { toolId: string; action: 'install' | 'update' } | null,
    stopping: false,
  }
}

function normalizeToolSummaries(value: any): any[] {
  const list = Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : []
  const seen = new Set<string>()
  const out: any[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const name = String((item as any).name || (item as any).id || '').trim()
    const id = String((item as any).id || name).trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push({
      id,
      name,
      description: String((item as any).description || '').trim(),
      version: String((item as any).version || '').trim(),
      eucliBoxCompatibility: normalizeEucliBoxCompatibility((item as any).eucliBoxCompatibility),
      compatibility: normalizeCompatibilityStatus((item as any).compatibility),
      status: String((item as any).status || '').trim(),
      statusMessage: String((item as any).statusMessage || '').trim(),
      type: String((item as any).type || '').trim(),
      updatedAt: (item as any).updatedAt,
    })
  }
  return out.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
}

function normalizeToolDefinition(value: any): any {
  const source = value && typeof value === 'object' ? value : {}
  return {
    ...source,
    id: String((source as any).id || (source as any).name || '').trim(),
    name: String((source as any).name || (source as any).id || '').trim(),
    description: String((source as any).description || '').trim(),
    promptDescription: String((source as any).promptDescription || '').trim(),
    promptDescriptionOverride: String((source as any).promptDescriptionOverride ?? ''),
    version: String((source as any).version || '').trim(),
    eucliBoxCompatibility: normalizeEucliBoxCompatibility((source as any).eucliBoxCompatibility),
    compatibility: normalizeCompatibilityStatus((source as any).compatibility),
    status: String((source as any).status || '').trim(),
    statusMessage: String((source as any).statusMessage || '').trim(),
    type: String((source as any).type || '').trim(),
    inputSchema: objectOrNull((source as any).inputSchema),
    userConfigSchema: objectOrNull((source as any).userConfigSchema),
    userConfig: objectOrEmpty((source as any).userConfig),
    defaultConfig: objectOrEmpty((source as any).defaultConfig),
    capabilities: normalizeToolCapabilities((source as any).capabilities),
    capabilityGrants: normalizeCapabilityGrants((source as any).capabilityGrants),
  }
}

function normalizeToolCapabilities(value: any): any[] {
  const list = Array.isArray(value) ? value : []
  const out: any[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const id = String((item as any).id || '').trim()
    const access = String((item as any).access || '').trim()
    if (!id || !access) continue
    out.push({ id, access, name: String((item as any).name || '').trim(), description: String((item as any).description || '').trim() })
  }
  return out
}

// normalizeCapabilityGrants 只保留明确开启的授权项，键为能力标识与访问方式。
function normalizeCapabilityGrants(value: any): Record<string, boolean> {
  const source = objectOrEmpty(value)
  const out: Record<string, boolean> = {}
  for (const [key, granted] of Object.entries(source)) {
    const normalized = String(key || '').trim()
    if (normalized && granted === true) out[normalized] = true
  }
  return out
}

function objectOrEmpty(value: any): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function objectOrNull(value: any): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function clonePlainObject(value: any): Record<string, any> {
  const source = objectOrEmpty(value)
  try {
    return JSON.parse(JSON.stringify(source))
  } catch (_) {
    return { ...source }
  }
}

function normalizeConfigPath(path: any): string[] {
  const parts = Array.isArray(path) ? path : String(path || '').split('.')
  return parts.map((part: any) => String(part || '').trim()).filter((part: string) => !!part)
}

function setValueAtPath(target: Record<string, any>, path: string[], value: any) {
  let cursor: Record<string, any> = target
  for (const segment of path.slice(0, -1)) {
    const next = cursor[segment]
    if (!next || typeof next !== 'object' || Array.isArray(next)) cursor[segment] = {}
    cursor = cursor[segment]
  }
  cursor[path[path.length - 1]] = value
}

function removeValueAtPath(target: Record<string, any>, path: string[]): boolean {
  const key = path[0]
  if (!key) return false
  if (path.length === 1) return delete target[key]
  const child = target[key]
  if (!child || typeof child !== 'object' || Array.isArray(child)) return false
  const removed = removeValueAtPath(child, path.slice(1))
  if (removed && Object.keys(child).length === 0) delete target[key]
  return removed
}
