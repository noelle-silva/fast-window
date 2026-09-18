export function createLibraryActions(deps: {
  refreshHookPromptLibrary: (force?: boolean) => Promise<any>
  persistHookPromptLibrary: (library: any) => Promise<any>
  refreshPlaceholderLibrary: (force?: boolean) => Promise<any>
  persistPlaceholderLibrary: (library: any) => Promise<any>
  refreshPlaceholderPreview: (value: any) => Promise<any>
  refreshPlaceholderDependencyTree: (name: any) => Promise<any>
  refreshSystemPlugins: (force?: boolean) => Promise<any>
  openSystemPlugin: (pluginId: any) => Promise<any>
  saveSystemPluginConfig: (pluginId: any, config: any) => Promise<any>
  refreshAvailableSystemPluginPlaceholderInterfaces: () => Promise<any>
  createPlaceholderFromSystemPlugin: (pluginId: any, interfaceId: any) => Promise<any>
  loadSystemPluginInstallState: (pluginId: any) => Promise<any>
  installSystemPluginAction: (pluginId: any) => Promise<any>
  updateSystemPluginAction: (pluginId: any) => Promise<any>
  selectHookPromptForActiveChat: (mode: any, presetId: any) => Promise<any>
}) {
  const { refreshHookPromptLibrary, persistHookPromptLibrary, refreshPlaceholderLibrary, persistPlaceholderLibrary, refreshPlaceholderPreview, refreshPlaceholderDependencyTree, refreshSystemPlugins, openSystemPlugin, saveSystemPluginConfig, refreshAvailableSystemPluginPlaceholderInterfaces, createPlaceholderFromSystemPlugin, loadSystemPluginInstallState, installSystemPluginAction, updateSystemPluginAction, selectHookPromptForActiveChat } = deps

  return {
    refreshHookPromptLibrary: (force: any) => refreshHookPromptLibrary(!!force),
    saveHookPromptLibrary: (library: any) => persistHookPromptLibrary(library),
    refreshPlaceholderLibrary: (force: any) => refreshPlaceholderLibrary(!!force),
    savePlaceholderLibrary: (library: any) => persistPlaceholderLibrary(library),
    previewPlaceholders: (value: any) => refreshPlaceholderPreview(value),
    loadPlaceholderDependencies: (name: any) => refreshPlaceholderDependencyTree(name),
    refreshSystemPlugins: (force: any) => refreshSystemPlugins(!!force),
    openSystemPlugin: (pluginId: any) => openSystemPlugin(pluginId),
    saveSystemPluginConfig: (pluginId: any, config: any) => saveSystemPluginConfig(pluginId, config),
    refreshAvailableSystemPluginPlaceholderInterfaces: () => refreshAvailableSystemPluginPlaceholderInterfaces(),
    createPlaceholderFromSystemPlugin: (pluginId: any, interfaceId: any) => createPlaceholderFromSystemPlugin(pluginId, interfaceId),
    loadSystemPluginInstallState: (pluginId: any) => loadSystemPluginInstallState(pluginId),
    installSystemPlugin: (pluginId: any) => installSystemPluginAction(pluginId),
    updateSystemPlugin: (pluginId: any) => updateSystemPluginAction(pluginId),
    selectHookPromptForActiveChat: (mode: any, presetId: any) => selectHookPromptForActiveChat(mode, presetId),
  }
}
