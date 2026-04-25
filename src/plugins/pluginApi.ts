import type { PluginCapability, PluginApiVersion } from './pluginContract'

export type PluginContext = {
  apiVersion: PluginApiVersion
  id: string
  requires: PluginCapability[]
}

export function createPluginContext(
  pluginId: string,
  apiVersion: PluginApiVersion,
  requires: PluginCapability[],
): PluginContext {
  return {
    apiVersion,
    id: pluginId,
    requires,
  }
}
