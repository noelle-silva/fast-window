import type { PluginCapability, SupportedPluginApiVersion } from './capabilities'

export type PluginUiType = 'iframe'

export interface PluginManifest {
  id: string
  name: string
  version: string
  author?: string
  description: string
  main: string
  icon?: string
  keyword?: string
  allowOverwriteOnUpdate?: boolean
  apiVersion?: SupportedPluginApiVersion
  requires?: PluginCapability[]
  ui?: {
    type: PluginUiType
    keepAlive?: boolean
  }
  background?: {
    main?: string
    autoStart?: boolean
  }
}
