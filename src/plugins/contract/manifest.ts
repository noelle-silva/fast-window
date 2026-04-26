import type { PluginCapability, SupportedPluginApiVersion } from './capabilities'

export type PluginUiType = 'iframe'

export type PluginBackgroundLifecycle = 'on_demand' | 'resident' | 'short_lived'

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
    /**
     * legacy（v2）：历史“自启动”开关。
     * - 系统级后台插件不再接受该字段：请使用 lifecycle 表达清晰的生命周期档位。
     */
    autoStart?: boolean
    lifecycle?: PluginBackgroundLifecycle
  }
}
