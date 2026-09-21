import { cancelSystemPlugin, createPlaceholderFromSystemPluginInterface, disableSystemPlugin as disableSystemPluginClient, enableSystemPlugin as enableSystemPluginClient, installSystemPlugin as installSystemPluginClient, loadAvailableSystemPluginPlaceholderInterfaces, loadSystemPlugin, loadSystemPlugins, saveSystemPluginUserConfig, updateSystemPlugin as updateSystemPluginClient } from './systemPluginClient'
import { loadPlaceholderProblems } from './placeholderClient'
import { systemPluginLocatorId } from '../domain/systemPlugin'
import { isArtifactBusy, normalizeArtifactInstallState, normalizeArtifactInstallStateList, type ArtifactInstallState } from '../domain/release'
import { createArtifactInstallTracker, type ArtifactInstallStateMap } from './artifactInstallTracker'
import type { AiChatShowToast } from '../gateway/capabilities'

type InstallTerminalListener = (id: string, state: ArtifactInstallState) => void

export function createSystemPluginController(deps: {
  getState: () => any
  getNetRequest: () => ((req: any) => Promise<any>) | undefined
  emit: () => void
  showToast?: AiChatShowToast
  refreshPlaceholderLibrary: (force?: boolean) => Promise<any>
}) {
  const { getState, getNetRequest, emit, showToast, refreshPlaceholderLibrary } = deps
  let installTerminalListener: InstallTerminalListener | null = null

  function requireNetRequest() {
    const netRequest = getNetRequest()
    if (typeof netRequest !== 'function') throw new Error('业务端请求通道不可用')
    return netRequest
  }

  function installStates(): ArtifactInstallStateMap {
    const state = getState()
    const box = state.systemPlugins && typeof state.systemPlugins === 'object' ? state.systemPlugins : {}
    return box.installStates && typeof box.installStates === 'object' ? box.installStates : {}
  }

  function applyInstallState(pluginId: string, state: ArtifactInstallState) {
    const current = getState()
    current.systemPlugins = { ...current.systemPlugins, installStates: { ...installStates(), [pluginId]: state } }
    emit()
  }

  const installTracker = createArtifactInstallTracker({
    loadState: async (pluginId) => {
      const netRequest = requireNetRequest()
      const response = await netRequest({ method: 'GET', path: `/api/system-plugins/${encodeURIComponent(pluginId)}/install-state`, timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      return normalizeArtifactInstallState(response?.body)
    },
    cancel: async (pluginId) => {
      const netRequest = requireNetRequest()
      const state = await cancelSystemPlugin(netRequest, pluginId)
      return state
    },
    loadOperations: async () => {
      const netRequest = requireNetRequest()
      const response = await netRequest({ method: 'GET', path: '/api/artifact-operations', timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      return normalizeArtifactInstallStateList(response?.body).filter((state) => String(state.artifact?.kind || '') === 'plugin')
    },
    getStates: installStates,
    setStates: (states) => {
      const state = getState()
      state.systemPlugins = { ...state.systemPlugins, installStates: states }
      emit()
    },
    onTerminal: (pluginId, state) => {
      void refreshSystemPlugins(false).catch(() => null)
      if (state.status === 'failed') {
        showToast?.(`「${pluginId}」安装或更新失败：${state.error.message || '未知原因'}`, { kind: 'error' })
      }
      installTerminalListener?.(pluginId, state)
      emit()
    },
  })

  async function refreshSystemPlugins(force?: boolean) {
    const state = getState()
    const netRequest = getNetRequest()
    if (typeof netRequest !== 'function') {
      state.systemPlugins = { ...state.systemPlugins, loading: false, error: '业务端请求通道不可用' }
      emit()
      return state.systemPlugins.items
    }
    if (state.systemPlugins.loading && !force) return state.systemPlugins.items
    state.systemPlugins = { ...state.systemPlugins, loading: true, error: '' }
    emit()
    try {
      const items = await loadSystemPlugins(netRequest)
      const selectedPluginId = state.systemPlugins.selectedPluginId || systemPluginLocatorId(items[0] || { id: '', sourceId: '' })
      state.systemPlugins = { ...state.systemPlugins, loading: false, error: '', items, selectedPluginId }
      emit()
      if (selectedPluginId) await openSystemPlugin(selectedPluginId).catch(() => null)
      return items
    } catch (e: any) {
      const message = String(e?.message || e || '加载系统插件失败')
      state.systemPlugins = { ...state.systemPlugins, loading: false, error: message }
      showToast?.(message, { kind: 'error' })
      emit()
      return state.systemPlugins.items
    }
  }

  async function openSystemPlugin(pluginIdRaw: any) {
    const pluginId = String(pluginIdRaw || '').trim()
    if (!pluginId) return null
    const state = getState()
    const netRequest = getNetRequest()
    if (typeof netRequest !== 'function') throw new Error('业务端请求通道不可用')
    state.systemPlugins = { ...state.systemPlugins, selectedPluginId: pluginId, detailLoading: true, detailError: '' }
    emit()
    try {
      const plugin = await loadSystemPlugin(netRequest, pluginId)
      state.systemPlugins = { ...state.systemPlugins, detailLoading: false, detailError: '', selectedPlugin: plugin }
      emit()
      return plugin
    } catch (e: any) {
      const message = String(e?.message || e || '加载系统插件详情失败')
      state.systemPlugins = { ...state.systemPlugins, detailLoading: false, detailError: message }
      showToast?.(message, { kind: 'error' })
      emit()
      return null
    }
  }

  async function saveSystemPluginConfig(pluginIdRaw: any, config: any) {
    const pluginId = String(pluginIdRaw || '').trim()
    if (!pluginId) throw new Error('系统插件 ID 不能为空')
    const state = getState()
    const netRequest = getNetRequest()
    if (typeof netRequest !== 'function') throw new Error('业务端请求通道不可用')
    state.systemPlugins = { ...state.systemPlugins, saving: true, saveError: '' }
    emit()
    try {
      const plugin = await saveSystemPluginUserConfig(netRequest, pluginId, config || {})
      state.systemPlugins = { ...state.systemPlugins, saving: false, saveError: '', selectedPlugin: plugin }
      showToast?.('系统插件设置已保存', { kind: 'success' })
      emit()
      await refreshPlaceholderLibrary(true).catch(() => null)
      return plugin
    } catch (e: any) {
      const message = String(e?.message || e || '保存系统插件设置失败')
      state.systemPlugins = { ...state.systemPlugins, saving: false, saveError: message }
      emit()
      throw e
    }
  }

  async function refreshAvailableSystemPluginPlaceholderInterfaces() {
    const netRequest = requireNetRequest()
    const interfaces = await loadAvailableSystemPluginPlaceholderInterfaces(netRequest)
    const state = getState()
    state.systemPlugins = { ...state.systemPlugins, availableInterfaces: interfaces }
    emit()
    return interfaces
  }

  // setSystemPluginEnabled 切换插件启停：停用会让插件全部能力面整体退出服役。
  async function setSystemPluginEnabled(pluginIdRaw: any, enabled: boolean) {
    const pluginId = String(pluginIdRaw || '').trim()
    if (!pluginId) return null
    const state = getState()
    const netRequest = getNetRequest()
    if (typeof netRequest !== 'function') throw new Error('业务端请求通道不可用')
    state.systemPlugins = { ...state.systemPlugins, togglingId: pluginId }
    emit()
    try {
      const plugin = enabled ? await enableSystemPluginClient(netRequest, pluginId) : await disableSystemPluginClient(netRequest, pluginId)
      const items = (Array.isArray(state.systemPlugins.items) ? state.systemPlugins.items : []).map((item: any) =>
        systemPluginLocatorId(item) === pluginId ? { ...item, enabled: plugin.enabled !== false } : item,
      )
      const selectedPluginId = String(state.systemPlugins.selectedPluginId || '').trim()
      const selectedPlugin = selectedPluginId === pluginId ? plugin : state.systemPlugins.selectedPlugin
      state.systemPlugins = { ...state.systemPlugins, togglingId: '', items, selectedPlugin }
      showToast?.(enabled ? '系统插件已启用' : '系统插件已停用', { kind: 'success' })
      emit()
      await refreshPlaceholderLibrary(true).catch(() => null)
      return plugin
    } catch (e: any) {
      const message = String(e?.message || e || (enabled ? '启用系统插件失败' : '停用系统插件失败'))
      state.systemPlugins = { ...state.systemPlugins, togglingId: '' }
      showToast?.(message, { kind: 'error' })
      emit()
      throw e
    }
  }

  function installSystemPluginAction(pluginIdRaw: any) {
    return startSystemPluginOperation(pluginIdRaw, 'install')
  }

  function updateSystemPluginAction(pluginIdRaw: any) {
    return startSystemPluginOperation(pluginIdRaw, 'update')
  }

  // startSystemPluginOperation 发起安装或更新：请求立即返回运行态并交给任务跟踪。
  async function startSystemPluginOperation(pluginIdRaw: any, action: 'install' | 'update') {
    const pluginId = String(pluginIdRaw || '').trim()
    if (!pluginId) return null
    try {
      const netRequest = requireNetRequest()
      const state = action === 'install'
        ? await installSystemPluginClient(netRequest, pluginId)
        : await updateSystemPluginClient(netRequest, pluginId)
      applyInstallState(pluginId, state)
      if (isArtifactBusy(state)) {
        installTracker.track(pluginId)
        return state
      }
      await refreshSystemPlugins(true).catch(() => null)
      return state
    } catch (e: any) {
      const message = String(e?.message || e || (action === 'install' ? '插件安装失败' : '插件更新失败'))
      showToast?.(message, { kind: 'error' })
      return null
    } finally {
      emit()
    }
  }

  // cancelSystemPluginInstall 取消正在进行的安装或更新；终态由任务跟踪写回。
  function cancelSystemPluginInstall(pluginIdRaw: any) {
    const pluginId = String(pluginIdRaw || '').trim()
    if (!pluginId) return Promise.resolve(null)
    return installTracker.cancel(pluginId)
  }

  // syncSystemPluginInstallStates 批量恢复安装任务事实；面板或商店打开时调用。
  function syncSystemPluginInstallStates() {
    return installTracker.sync()
  }

  function setInstallTerminalListener(listener: InstallTerminalListener | null) {
    installTerminalListener = typeof listener === 'function' ? listener : null
  }

  async function createPlaceholderFromSystemPlugin(pluginId: any, interfaceId: any) {
    const netRequest = requireNetRequest()
    const library = await createPlaceholderFromSystemPluginInterface(netRequest, String(pluginId || ''), String(interfaceId || ''))
    const problems = await loadPlaceholderProblems(netRequest).catch(() => [])
    const state = getState()
    state.placeholders = { ...state.placeholders, loading: false, error: '', library, problems }
    state.systemPlugins = { ...state.systemPlugins, availableInterfaces: [] }
    showToast?.('已从插件接口创建占位符', { kind: 'success' })
    emit()
    return library
  }

  function dispose() {
    installTracker.dispose()
  }

  return {
    refreshSystemPlugins,
    openSystemPlugin,
    saveSystemPluginConfig,
    refreshAvailableSystemPluginPlaceholderInterfaces,
    setSystemPluginEnabled,
    installSystemPluginAction,
    updateSystemPluginAction,
    cancelSystemPluginInstall,
    syncSystemPluginInstallStates,
    setInstallTerminalListener,
    createPlaceholderFromSystemPlugin,
    dispose,
  }
}
