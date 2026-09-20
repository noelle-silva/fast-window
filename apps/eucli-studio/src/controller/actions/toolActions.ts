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
  installTool: (toolId: any) => any
  updateTool: (toolId: any) => any
  cancelToolInstall: (toolId: any) => any
  syncToolInstallStates: () => any
  setToolInstallTerminalListener: (listener: ((id: string, state: any) => void) | null) => any
  getInstallSource: () => any
  setInstallSource: (kind: 'official' | 'local') => any
}) {
  const { state, emit, refreshTools, openToolConfig, closeToolConfig, setToolConfigValue, removeToolConfigValue, setToolPromptDescriptionDraft, resetToolPromptDescriptionDraftToDefault, saveSelectedToolConfig, installTool, updateTool, cancelToolInstall, syncToolInstallStates, setToolInstallTerminalListener, getInstallSource, setInstallSource } = deps

  return {
    refreshTools: (force: any) => refreshTools(!!force),
    openToolConfig: (toolId: any) => openToolConfig(toolId),
    closeToolConfig: () => closeToolConfig(),
    setToolConfigValue: (path: any, value: any) => setToolConfigValue(path, value),
    removeToolConfigValue: (path: any) => removeToolConfigValue(path),
    setToolPromptDescriptionDraft: (value: any) => setToolPromptDescriptionDraft(value),
    resetToolPromptDescriptionDraftToDefault: () => resetToolPromptDescriptionDraftToDefault(),
    saveSelectedToolConfig: () => saveSelectedToolConfig(),
    installTool: (toolId: any) => installTool(toolId),
    updateTool: (toolId: any) => updateTool(toolId),
    cancelToolInstall: (toolId: any) => cancelToolInstall(toolId),
    syncToolInstallStates: () => syncToolInstallStates(),
    setToolInstallTerminalListener: (listener: ((id: string, state: any) => void) | null) => setToolInstallTerminalListener(listener),
    getInstallSource: () => getInstallSource(),
    setInstallSource: (kind: 'official' | 'local') => setInstallSource(kind),
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
    setRoleToolRunMode: (toolName: any, mode: any) => {
      state.draft.roleToolPolicy = setToolRunMode(state.draft.roleToolPolicy, String(toolName || ''), mode)
      emit()
    },
    removeRoleTool: (toolName: any) => {
      state.draft.roleToolPolicy = removeToolFromPolicy(state.draft.roleToolPolicy, String(toolName || ''))
      emit()
    },
    addRoleNativeTool: (toolName: any) => {
      state.draft.roleToolPolicy = addNativeToolsToPolicy(state.draft.roleToolPolicy, [String(toolName || '')])
      emit()
    },
    removeRoleNativeTool: (toolName: any) => {
      state.draft.roleToolPolicy = removeNativeToolFromPolicy(state.draft.roleToolPolicy, String(toolName || ''))
      emit()
    },
  }
}
