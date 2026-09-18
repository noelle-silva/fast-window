import { createPlaceholderFromSystemPluginInterface, installSystemPlugin as installSystemPluginClient, loadAvailableSystemPluginPlaceholderInterfaces, loadSystemPlugin, loadSystemPluginInstallState as loadSystemPluginInstallStateClient, loadSystemPlugins, saveSystemPluginUserConfig, updateSystemPlugin as updateSystemPluginClient } from './systemPluginClient'
import { loadPlaceholderProblems } from './placeholderClient'
import { systemPluginLocatorId } from '../domain/systemPlugin'
import type { AiChatShowToast } from '../gateway/capabilities'

export function createSystemPluginController(deps: {
  getState: () => any
  getNetRequest: () => ((req: any) => Promise<any>) | undefined
  emit: () => void
  showToast?: AiChatShowToast
  refreshPlaceholderLibrary: (force?: boolean) => Promise<any>
}) {
  const { getState, getNetRequest, emit, showToast, refreshPlaceholderLibrary } = deps

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
    const netRequest = getNetRequest()
    if (typeof netRequest !== 'function') throw new Error('业务端请求通道不可用')
    const interfaces = await loadAvailableSystemPluginPlaceholderInterfaces(netRequest)
    const state = getState()
    state.systemPlugins = { ...state.systemPlugins, availableInterfaces: interfaces }
    emit()
    return interfaces
  }

  async function loadSystemPluginInstallState(pluginIdRaw: any) {
    const pluginId = String(pluginIdRaw || '').trim()
    if (!pluginId) return null
    const state = getState()
    const netRequest = getNetRequest()
    if (typeof netRequest !== 'function') throw new Error('业务端请求通道不可用')
    state.systemPlugins = { ...state.systemPlugins, installLoading: true, installError: '' }
    emit()
    try {
      const installState = await loadSystemPluginInstallStateClient(netRequest, pluginId)
      state.systemPlugins = { ...state.systemPlugins, installLoading: false, installError: '', installState }
      emit()
      return installState
    } catch (e: any) {
      const message = String(e?.message || e || '插件安装状态加载失败')
      state.systemPlugins = { ...state.systemPlugins, installLoading: false, installError: message }
      emit()
      return null
    }
  }

  async function installSystemPluginAction(pluginIdRaw: any) {
    return runSystemPluginOperation(pluginIdRaw, 'install')
  }

  async function updateSystemPluginAction(pluginIdRaw: any) {
    return runSystemPluginOperation(pluginIdRaw, 'update')
  }

  async function runSystemPluginOperation(pluginIdRaw: any, action: 'install' | 'update') {
    const pluginId = String(pluginIdRaw || '').trim()
    if (!pluginId) return null
    const state = getState()
    const netRequest = getNetRequest()
    if (typeof netRequest !== 'function') throw new Error('业务端请求通道不可用')
    state.systemPlugins = { ...state.systemPlugins, installLoading: true, installError: '' }
    emit()
    try {
      const installState = action === 'install'
        ? await installSystemPluginClient(netRequest, pluginId)
        : await updateSystemPluginClient(netRequest, pluginId)
      state.systemPlugins = { ...state.systemPlugins, installLoading: false, installError: '', installState }
      emit()
      await refreshSystemPlugins(true).catch(() => null)
      return installState
    } catch (e: any) {
      const message = String(e?.message || e || (action === 'install' ? '插件安装失败' : '插件更新失败'))
      state.systemPlugins = { ...state.systemPlugins, installLoading: false, installError: message }
      showToast?.(message, { kind: 'error' })
      emit()
      return null
    }
  }

  async function createPlaceholderFromSystemPlugin(pluginId: any, interfaceId: any) {
    const netRequest = getNetRequest()
    if (typeof netRequest !== 'function') throw new Error('业务端请求通道不可用')
    const library = await createPlaceholderFromSystemPluginInterface(netRequest, String(pluginId || ''), String(interfaceId || ''))
    const problems = await loadPlaceholderProblems(netRequest).catch(() => [])
    const state = getState()
    state.placeholders = { ...state.placeholders, loading: false, error: '', library, problems }
    state.systemPlugins = { ...state.systemPlugins, availableInterfaces: [] }
    showToast?.('已从插件接口创建占位符', { kind: 'success' })
    emit()
    return library
  }

  return {
    refreshSystemPlugins,
    openSystemPlugin,
    saveSystemPluginConfig,
    refreshAvailableSystemPluginPlaceholderInterfaces,
    loadSystemPluginInstallState,
    installSystemPluginAction,
    updateSystemPluginAction,
    createPlaceholderFromSystemPlugin,
  }
}
