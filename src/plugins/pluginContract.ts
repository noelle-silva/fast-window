export {
  LEGACY_PLUGIN_API_VERSION,
  SYSTEM_BACKEND_PLUGIN_API_VERSION,
  TRUSTED_LOCAL_APP_PLUGIN_API_VERSION,
  LATEST_PLUGIN_API_VERSION,
  PLUGIN_API_VERSION,
  SUPPORTED_PLUGIN_API_VERSIONS,
  isSupportedPluginApiVersion,
  isValidPluginCapability,
} from './contract/capabilities'

export type {
  PluginCapability,
  SupportedPluginApiVersion as PluginApiVersion,
} from './contract/capabilities'

export type {
  PluginBackgroundLifecycle,
  PluginBackgroundRuntime,
  PluginManifest,
  PluginUiType,
} from './contract/manifest'
