export function createLibraryActions(deps: {
  refreshHookPromptLibrary: (force?: boolean) => Promise<any>
  persistHookPromptLibrary: (library: any) => Promise<any>
  reorderHookPromptPresetOrder: (presetIds: string[]) => Promise<any>
  refreshPlaceholderLibrary: (force?: boolean) => Promise<any>
  persistPlaceholderLibrary: (library: any) => Promise<any>
  reorderPlaceholders: (names: string[]) => Promise<any>
  refreshPlaceholderPreview: (value: any) => Promise<any>
  refreshPlaceholderDependencyTree: (name: any) => Promise<any>
  loadRolePlaceholderDependencyTree: (rootName: any, text: any) => Promise<any>
  refreshSystemPlugins: (force?: boolean) => Promise<any>
  moveSystemPlugin: (activeId: string, overId: string, position: string) => Promise<any>
  openSystemPlugin: (pluginId: any) => Promise<any>
  saveSystemPluginConfig: (pluginId: any, config: any) => Promise<any>
  refreshAvailableSystemPluginPlaceholderInterfaces: () => Promise<any>
  createPlaceholderFromSystemPlugin: (pluginId: any, interfaceId: any) => Promise<any>
  setSystemPluginEnabled: (pluginId: any, enabled: boolean) => Promise<any>
  installSystemPluginAction: (pluginId: any) => Promise<any>
  updateSystemPluginAction: (pluginId: any) => Promise<any>
  importSystemPluginPackage: () => Promise<any>
  importSystemPluginFolder: () => Promise<any>
  cancelSystemPluginInstall: (pluginId: any) => Promise<any>
  syncSystemPluginInstallStates: () => Promise<any>
  setSystemPluginInstallTerminalListener: (listener: ((id: string, state: any) => void) | null) => void
  selectHookPromptForActiveChat: (mode: any, presetId: any) => Promise<any>
}) {
  const { refreshHookPromptLibrary, persistHookPromptLibrary, reorderHookPromptPresetOrder, refreshPlaceholderLibrary, persistPlaceholderLibrary, reorderPlaceholders, refreshPlaceholderPreview, refreshPlaceholderDependencyTree, loadRolePlaceholderDependencyTree, refreshSystemPlugins, moveSystemPlugin, openSystemPlugin, saveSystemPluginConfig, refreshAvailableSystemPluginPlaceholderInterfaces, createPlaceholderFromSystemPlugin, setSystemPluginEnabled, installSystemPluginAction, updateSystemPluginAction, importSystemPluginPackage, importSystemPluginFolder, cancelSystemPluginInstall, syncSystemPluginInstallStates, setSystemPluginInstallTerminalListener, selectHookPromptForActiveChat } = deps

  return {
    refreshHookPromptLibrary: (force: any) => refreshHookPromptLibrary(!!force),
    saveHookPromptLibrary: (library: any) => persistHookPromptLibrary(library),
    reorderHookPromptPresets: (presetIds: string[]) => reorderHookPromptPresetOrder(presetIds),
    refreshPlaceholderLibrary: (force: any) => refreshPlaceholderLibrary(!!force),
    savePlaceholderLibrary: (library: any) => persistPlaceholderLibrary(library),
    reorderPlaceholders: (names: string[]) => reorderPlaceholders(names),
    previewPlaceholders: (value: any) => refreshPlaceholderPreview(value),
    loadPlaceholderDependencies: (name: any) => refreshPlaceholderDependencyTree(name),
    loadRolePlaceholderDependencyTree: (rootName: any, text: any) => loadRolePlaceholderDependencyTree(rootName, text),
    refreshSystemPlugins: (force: any) => refreshSystemPlugins(!!force),
    moveSystemPlugin: (activeId: string, overId: string, position: string) => moveSystemPlugin(activeId, overId, position),
    openSystemPlugin: (pluginId: any) => openSystemPlugin(pluginId),
    saveSystemPluginConfig: (pluginId: any, config: any) => saveSystemPluginConfig(pluginId, config),
    refreshAvailableSystemPluginPlaceholderInterfaces: () => refreshAvailableSystemPluginPlaceholderInterfaces(),
    createPlaceholderFromSystemPlugin: (pluginId: any, interfaceId: any) => createPlaceholderFromSystemPlugin(pluginId, interfaceId),
    setSystemPluginEnabled: (pluginId: any, enabled: boolean) => setSystemPluginEnabled(pluginId, !!enabled),
    installSystemPlugin: (pluginId: any) => installSystemPluginAction(pluginId),
    updateSystemPlugin: (pluginId: any) => updateSystemPluginAction(pluginId),
    importSystemPluginPackage: () => importSystemPluginPackage(),
    importSystemPluginFolder: () => importSystemPluginFolder(),
    cancelSystemPluginInstall: (pluginId: any) => cancelSystemPluginInstall(pluginId),
    syncSystemPluginInstallStates: () => syncSystemPluginInstallStates(),
    setSystemPluginInstallTerminalListener: (listener: ((id: string, state: any) => void) | null) => setSystemPluginInstallTerminalListener(listener),
    selectHookPromptForActiveChat: (mode: any, presetId: any) => selectHookPromptForActiveChat(mode, presetId),
  }
}
