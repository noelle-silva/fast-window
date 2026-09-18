import { addNativeToolsToPolicy, addToolsToPolicy, removeNativeToolFromPolicy, removeToolFromPolicy, setToolRunMode } from '../../domain/toolPolicy'
import type { AiChatShowToast } from '../../gateway/capabilities'

export function createToolActions(deps: {
  state: any
  emit: () => void
  showToast?: AiChatShowToast
  refreshTools: (force: boolean) => any
  openToolConfig: (toolId: any) => any
  closeToolConfig: () => any
  setToolConfigValue: (path: any, value: any) => any
  removeToolConfigValue: (path: any) => any
  setToolPromptDescriptionDraft: (value: any) => any
  resetToolPromptDescriptionDraftToDefault: () => any
  saveSelectedToolConfig: () => any
  loadToolInstallState: (toolId: any) => any
  installTool: (toolId: any) => any
  updateTool: (toolId: any) => any
  getInstallSource: () => any
  setInstallSource: (kind: 'official' | 'local') => any
}) {
  const { state, emit, refreshTools, openToolConfig, closeToolConfig, setToolConfigValue, removeToolConfigValue, setToolPromptDescriptionDraft, resetToolPromptDescriptionDraftToDefault, saveSelectedToolConfig, loadToolInstallState, installTool, updateTool, getInstallSource, setInstallSource } = deps

  return {
    refreshTools: (force: any) => refreshTools(!!force),
    openToolConfig: (toolId: any) => openToolConfig(toolId),
    closeToolConfig: () => closeToolConfig(),
    setToolConfigValue: (path: any, value: any) => setToolConfigValue(path, value),
    removeToolConfigValue: (path: any) => removeToolConfigValue(path),
    setToolPromptDescriptionDraft: (value: any) => setToolPromptDescriptionDraft(value),
    resetToolPromptDescriptionDraftToDefault: () => resetToolPromptDescriptionDraftToDefault(),
    saveSelectedToolConfig: () => saveSelectedToolConfig(),
    loadToolInstallState: (toolId: any) => loadToolInstallState(toolId),
    installTool: (toolId: any) => installTool(toolId),
    updateTool: (toolId: any) => updateTool(toolId),
    getInstallSource: () => getInstallSource(),
    setInstallSource: (kind: 'official' | 'local') => setInstallSource(kind),
    openRoleToolWhitelist: () => {
      state.draft.roleToolWhitelistOpen = true
      refreshTools(false).catch(() => {})
      emit()
    },
    closeRoleToolWhitelist: () => {
      state.draft.roleToolWhitelistOpen = false
      state.draft.roleToolMenuName = ''
      state.draft.roleToolPermissionName = ''
      emit()
    },
    openRoleToolAdd: () => {
      state.draft.roleToolAddOpen = true
      state.draft.roleToolSearch = ''
      state.draft.roleToolAddSelected = []
      refreshTools(false).catch(() => {})
      emit()
    },
    closeRoleToolAdd: () => {
      state.draft.roleToolAddOpen = false
      state.draft.roleToolSearch = ''
      state.draft.roleToolAddSelected = []
      emit()
    },
    setRoleToolSearch: (value: any) => {
      state.draft.roleToolSearch = String(value || '')
      emit()
    },
    toggleRoleToolAddSelection: (toolName: any) => {
      const name = String(toolName || '').trim()
      if (!name) return
      const selected = Array.isArray(state.draft.roleToolAddSelected) ? state.draft.roleToolAddSelected.map((x: any) => String(x || '').trim()).filter(Boolean) : []
      state.draft.roleToolAddSelected = selected.includes(name) ? selected.filter((item: string) => item !== name) : selected.concat(name)
      emit()
    },
    addSelectedRoleTools: () => {
      const selected = Array.isArray(state.draft.roleToolAddSelected) ? state.draft.roleToolAddSelected : []
      state.draft.roleToolPolicy = addToolsToPolicy(state.draft.roleToolPolicy, selected)
      state.draft.roleToolAddOpen = false
      state.draft.roleToolSearch = ''
      state.draft.roleToolAddSelected = []
      emit()
    },
    openRoleToolMenu: (toolName: any) => {
      state.draft.roleToolMenuName = String(toolName || '').trim()
      emit()
    },
    closeRoleToolMenu: () => {
      state.draft.roleToolMenuName = ''
      emit()
    },
    openRoleToolPermission: (toolName: any) => {
      state.draft.roleToolPermissionName = String(toolName || '').trim()
      state.draft.roleToolMenuName = ''
      emit()
    },
    closeRoleToolPermission: () => {
      state.draft.roleToolPermissionName = ''
      emit()
    },
    setRoleToolRunMode: (toolName: any, mode: any) => {
      state.draft.roleToolPolicy = setToolRunMode(state.draft.roleToolPolicy, String(toolName || ''), mode)
      state.draft.roleToolPermissionName = ''
      emit()
    },
    removeRoleTool: (toolName: any) => {
      state.draft.roleToolPolicy = removeToolFromPolicy(state.draft.roleToolPolicy, String(toolName || ''))
      state.draft.roleToolMenuName = ''
      state.draft.roleToolPermissionName = ''
      emit()
    },
    openRoleNativeToolAdd: () => {
      state.draft.roleNativeToolAddOpen = true
      refreshTools(false).catch(() => {})
      emit()
    },
    closeRoleNativeToolAdd: () => {
      state.draft.roleNativeToolAddOpen = false
      emit()
    },
    addRoleNativeTool: (toolName: any) => {
      state.draft.roleToolPolicy = addNativeToolsToPolicy(state.draft.roleToolPolicy, [String(toolName || '')])
      state.draft.roleNativeToolAddOpen = false
      emit()
    },
    removeRoleNativeTool: (toolName: any) => {
      state.draft.roleToolPolicy = removeNativeToolFromPolicy(state.draft.roleToolPolicy, String(toolName || ''))
      emit()
    },
  }
}
