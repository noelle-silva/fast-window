export const PLUGIN_API_VERSION = 2 as const

export type PluginApiVersion = typeof PLUGIN_API_VERSION

// 按“能力字符串”授权：目前只保留 tauri 网关能力。
export type PluginCapability =
  // 透传调用 tauri invoke 的能力声明：由插件自行声明允许调用的 command。
  // 语义：`tauri:<command>`，其中 <command> 例：`plugin:fs|read_text_file` 或 `my_custom_command`。
  // 支持后缀通配：`tauri:plugin:fs|*`、`tauri:*`。
  | `tauri:${string}`

export function isValidPluginCapability(item: unknown): item is PluginCapability {
  const s = String(item ?? '').trim()
  if (!s) return false
  // 动态能力：tauri:<command>
  if (!s.startsWith('tauri:')) return false
  if (s.length > 256) return false
  if (s.includes('\n') || s.includes('\r')) return false
  return true
}

// 仅支持 iframe 沙箱；legacy react/eval 已禁用（见 pluginLoader）
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
  // 已废弃：旧版把宿主偏好写进插件 manifest；新版不再读取/写入此字段。
  allowOverwriteOnUpdate?: boolean

  // 新增：插件契约版本（不填默认认为是当前版本）
  apiVersion?: number
  // 能力申请列表（v2 起为强约束：未声明的能力会被宿主拒绝）
  requires?: PluginCapability[]
  // UI 运行方式（v2 起要求显式为 iframe；legacy react/eval 已禁用）
  ui?: {
    type: PluginUiType
    // 可选：UI 是否保活（返回主界面时不卸载 iframe；再次打开可秒开并保留状态）
    keepAlive?: boolean
  }
  background?: {
    // 统一入口模式下不再必填；若提供 main，则按 legacy 双入口处理
    main?: string
    autoStart?: boolean
  }
}

export function normalizeManifest(manifest: PluginManifest): Required<Pick<PluginManifest, 'apiVersion'>> &
  Omit<PluginManifest, 'apiVersion'> {
  return {
    ...manifest,
    apiVersion: typeof manifest.apiVersion === 'number' ? manifest.apiVersion : PLUGIN_API_VERSION,
  }
}
