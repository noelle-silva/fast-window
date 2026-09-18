import { now } from '../core/utils'
import type { AiChatShowToast } from '../gateway/capabilities'
import { normalizeArtifactInstallState, normalizeCompatibilityStatus, normalizeEucliBoxCompatibility, type ArtifactInstallState } from '../domain/release'

export function createToolCatalog(deps: {
  getState: () => any
  netRequest: (req: any) => Promise<any>
  emit: () => void
  showToast?: AiChatShowToast
}) {
  function currentCatalog() {
    const state = deps.getState()
    if (!state.tools || typeof state.tools !== 'object') state.tools = defaultToolCatalogState()
    return { state, catalog: state.tools }
  }

  function patchCatalog(patch: Record<string, any>) {
    const { state, catalog } = currentCatalog()
    state.tools = { ...defaultToolCatalogState(), ...catalog, ...patch }
  }

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
    patchCatalog({ detailLoading: true, detailError: '', selectedToolId: toolId, selectedTool: null, configDraft: {}, promptDescriptionDraft: '', saveError: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'GET', path: `/api/tools/${encodeURIComponent(toolId)}`, timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const tool = normalizeToolDefinition(response?.body)
      patchCatalog({ detailLoading: false, detailError: '', selectedToolId: String(tool.id || toolId), selectedTool: tool, configDraft: clonePlainObject(tool.userConfig), promptDescriptionDraft: String(tool.promptDescriptionOverride ?? ''), saveError: '' })
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
    patchCatalog({ selectedToolId: '', selectedTool: null, configDraft: {}, promptDescriptionDraft: '', detailError: '', saveError: '' })
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

  async function saveSelectedToolConfig() {
    const { catalog } = currentCatalog()
    const toolId = String(catalog.selectedToolId || catalog.selectedTool?.id || '').trim()
    if (!toolId) return false

    const userConfig = clonePlainObject(catalog.configDraft)
    const promptDescriptionOverride = String(catalog.promptDescriptionDraft ?? '')

    patchCatalog({ saving: true, saveError: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'PUT', path: `/api/tools/${encodeURIComponent(toolId)}/user-config`, body: { userConfig, promptDescriptionOverride }, timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const tool = normalizeToolDefinition(response?.body)
      patchCatalog({ saving: false, saveError: '', selectedTool: tool, selectedToolId: String(tool.id || toolId), configDraft: clonePlainObject(tool.userConfig), promptDescriptionDraft: String(tool.promptDescriptionOverride ?? '') })
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

  async function loadToolInstallState(toolIdRaw: any) {
    const toolId = String(toolIdRaw || '').trim()
    if (!toolId) return null
    patchCatalog({ installLoading: true, installError: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'GET', path: `/api/tools/${encodeURIComponent(toolId)}/install-state`, timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const state = normalizeArtifactInstallState(response?.body)
      patchCatalog({ installLoading: false, installError: '', installState: state })
      return state
    } catch (e: any) {
      const error = String(e?.message || e || '工具安装状态加载失败')
      patchCatalog({ installLoading: false, installError: error })
      return null
    } finally {
      deps.emit()
    }
  }

  async function installTool(toolIdRaw: any) {
    return runToolOperation(toolIdRaw, 'install')
  }

  async function updateTool(toolIdRaw: any) {
    return runToolOperation(toolIdRaw, 'update')
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
      await runToolOperation(toolId, action)
    } catch (e: any) {
      const error = String(e?.message || e || '停止工具失败')
      patchCatalog({ stopping: false })
      deps.showToast?.(error, { kind: 'error' })
      deps.emit()
    } finally {
      patchCatalog({ stopping: false })
      deps.emit()
    }
  }

  async function runToolOperation(toolIdRaw: any, action: 'install' | 'update') {
    const toolId = String(toolIdRaw || '').trim()
    if (!toolId) return null
    patchCatalog({ installLoading: true, installError: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'POST', path: `/api/tools/${encodeURIComponent(toolId)}/${action}`, body: {}, timeoutMs: 180000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const state = normalizeArtifactInstallState(response?.body)
      if (action === 'update' && state.status === 'blocked' && (state.error.code === 'TOOL_ACTIVE' || state.error.code === 'ARTIFACT_UPDATE_IN_PROGRESS')) {
        patchCatalog({ installLoading: false, installError: '' })
        askBusyReplacement(toolId, action)
        return state
      }
      patchCatalog({ installLoading: false, installError: '', installState: state })
      await refreshTools(true)
      return state
    } catch (e: any) {
      const error = String(e?.message || e || (action === 'install' ? '工具安装失败' : '工具更新失败'))
      patchCatalog({ installLoading: false, installError: error })
      deps.showToast?.(error, { kind: 'error' })
      return null
    } finally {
      deps.emit()
    }
  }

  return { refreshTools, openToolConfig, closeToolConfig, setToolConfigValue, removeToolConfigValue, setToolPromptDescriptionDraft, resetToolPromptDescriptionDraftToDefault, saveSelectedToolConfig, loadToolInstallState, installTool, updateTool, stopTool, confirmStopAndContinue, dismissBusyPrompt }
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
    saving: false,
    saveError: '',
    installLoading: false,
    installError: '',
    installState: null as ArtifactInstallState | null,
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
  }
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
