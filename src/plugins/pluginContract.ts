export const PLUGIN_API_VERSION = 1 as const

export type PluginApiVersion = typeof PLUGIN_API_VERSION

// 先从最小集合开始：按“方法名”授权，后续要扩展再加
export type PluginCapability =
  | '*'
  | 'net'
  | 'net.*'
  | 'net.request'
  | 'clipboard'
  | 'clipboard.*'
  | 'clipboard.readText'
  | 'clipboard.writeText'
  | 'clipboard.readImage'
  | 'clipboard.writeImage'
  | 'storage'
  | 'storage.*'
  | 'storage.get'
  | 'storage.set'
  | 'storage.remove'
  | 'storage.getAll'
  | 'storage.setAll'
  | 'ui'
  | 'ui.*'
  | 'ui.showToast'
  | 'ui.openUrl'

export type PluginUiType = 'react' | 'iframe'

export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  main: string
  icon?: string
  keyword?: string

  // 新增：插件契约版本（不填默认认为是当前版本）
  apiVersion?: number
  // 新增：能力申请列表（不填默认放行，兼容老插件；建议新插件显式声明）
  requires?: PluginCapability[]
  // 新增：UI 运行方式（不填默认 react）
  ui?: {
    type: PluginUiType
  }
}

export function normalizeManifest(manifest: PluginManifest): Required<Pick<PluginManifest, 'apiVersion'>> &
  Omit<PluginManifest, 'apiVersion'> {
  return {
    ...manifest,
    apiVersion: typeof manifest.apiVersion === 'number' ? manifest.apiVersion : PLUGIN_API_VERSION,
  }
}

export function isCapabilityAllowed(
  requires: PluginCapability[] | undefined,
  needed: Exclude<
    PluginCapability,
    '*' | 'net' | 'clipboard' | 'storage' | 'ui' | 'net.*' | 'clipboard.*' | 'storage.*' | 'ui.*'
  >,
): boolean {
  // 兼容：老插件不写 requires 时，默认放行（不然现有生态直接全挂）
  if (!requires || requires.length === 0) return true
  if (requires.includes('*')) return true

  const [ns] = needed.split('.', 1)
  return (
    requires.includes(needed) ||
    (ns === 'net' && (requires.includes('net') || requires.includes('net.*'))) ||
    (ns === 'clipboard' && (requires.includes('clipboard') || requires.includes('clipboard.*'))) ||
    (ns === 'storage' && (requires.includes('storage') || requires.includes('storage.*'))) ||
    (ns === 'ui' && (requires.includes('ui') || requires.includes('ui.*')))
  )
}
