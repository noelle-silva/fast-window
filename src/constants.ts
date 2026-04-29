import type { ComponentType } from 'react'
import type { PluginCapability, PluginManifest } from './plugins/pluginContract'

export const APP_TITLE = 'Fast Window'

export const APP_STORAGE_ID = '__app'
export const PLUGIN_ORDER_KEY = 'pluginOrder'
export const PLUGIN_BROWSE_LAYOUT_KEY = 'pluginBrowseLayout'
export const DISABLED_PLUGINS_KEY = 'disabledPlugins'
export const PLUGIN_AUTO_UPDATE_LAST_CHECK_KEY = 'pluginAutoUpdateLastCheckMs'
export const PLUGIN_AUTO_UPDATE_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000
export const DEFAULT_STORE_INDEX_URL = 'https://raw.githubusercontent.com/noelle-silva/fast-window-plugins-download/main/index.json'
export const MAX_AUTO_UPDATE_PER_RUN = 8

export interface Plugin {
  id: string
  name: string
  description: string
  icon: string
  keyword?: string
  requires?: PluginCapability[]
  backgroundCode?: string
  manifest?: PluginManifest
  disabled: boolean
  component: ComponentType<{ onBack: () => void }>
}

export type PluginBrowseLayout = 'list' | 'grid' | 'icon'

export interface RegistryPluginItem {
  id: string
  name: string
  description: string
  version: string
  download_url: string
  sha256: string
  requires?: string[]
}

export interface RegistryIndex {
  registry_version: number
  plugins: RegistryPluginItem[]
}

export interface Semver {
  major: number
  minor: number
  patch: number
}
