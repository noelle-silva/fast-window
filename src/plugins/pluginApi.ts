import { PLUGIN_API_VERSION, type PluginCapability } from './pluginContract'

export type PluginContext = {
  apiVersion: number
  id: string
  requires: PluginCapability[]
}

export function createPluginContext(pluginId: string, requires: PluginCapability[]): PluginContext {
  return {
    apiVersion: PLUGIN_API_VERSION,
    id: pluginId,
    requires,
  }
}

