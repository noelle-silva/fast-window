export const PLUGIN_API_VERSION = 2 as const

export type PluginApiVersion = typeof PLUGIN_API_VERSION

// 先从最小集合开始：按“方法名”授权，后续要扩展再加
export type PluginCapability =
  | '*'
  | 'net'
  | 'net.*'
  | 'net.request'
  | 'net.requestBase64'
  | 'net.requestStream'
  | 'net.requestStreamCancel'
  | 'files'
  | 'files.*'
  | 'files.getOutputDir'
  | 'files.pickOutputDir'
  | 'files.pickDir'
  | 'files.openOutputDir'
  | 'files.openDir'
  | 'files.images.writeBase64'
  | 'files.images.read'
  | 'files.images.list'
  | 'files.images.delete'
  | 'files.pickImages'
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
  | 'ui.openExternal'
  | 'ui.openBrowserWindow'
  | 'task'
  | 'task.*'
  | 'task.create'
  | 'task.get'
  | 'task.list'
  | 'task.cancel'

export const ALL_PLUGIN_CAPABILITIES: readonly PluginCapability[] = [
  '*',
  'net',
  'net.*',
  'net.request',
  'net.requestBase64',
  'net.requestStream',
  'net.requestStreamCancel',
  'files',
  'files.*',
  'files.getOutputDir',
  'files.pickOutputDir',
  'files.pickDir',
  'files.openOutputDir',
  'files.openDir',
  'files.images.writeBase64',
  'files.images.read',
  'files.images.list',
  'files.images.delete',
  'files.pickImages',
  'clipboard',
  'clipboard.*',
  'clipboard.readText',
  'clipboard.writeText',
  'clipboard.readImage',
  'clipboard.writeImage',
  'storage',
  'storage.*',
  'storage.get',
  'storage.set',
  'storage.remove',
  'storage.getAll',
  'storage.setAll',
  'ui',
  'ui.*',
  'ui.showToast',
  'ui.openUrl',
  'ui.openExternal',
  'ui.openBrowserWindow',
  'task',
  'task.*',
  'task.create',
  'task.get',
  'task.list',
  'task.cancel',
] as const

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
  // Release：宿主更新时是否允许用随包版本覆盖该插件（默认 false）
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

export function isCapabilityAllowed(
  requires: PluginCapability[] | undefined,
  needed: PluginMethodCapability,
): boolean {
  // v2：默认拒绝（缺失/空列表 = 没有权限）
  if (!requires || requires.length === 0) return false
  if (requires.includes('*')) return true

  const [ns] = needed.split('.', 1)
  return (
    requires.includes(needed) ||
    (ns === 'net' && (requires.includes('net') || requires.includes('net.*'))) ||
    (ns === 'files' && (requires.includes('files') || requires.includes('files.*'))) ||
    (ns === 'clipboard' && (requires.includes('clipboard') || requires.includes('clipboard.*'))) ||
    (ns === 'storage' && (requires.includes('storage') || requires.includes('storage.*'))) ||
    (ns === 'ui' && (requires.includes('ui') || requires.includes('ui.*'))) ||
    (ns === 'task' && (requires.includes('task') || requires.includes('task.*')))
  )
}

export type PluginMethodCapability = Exclude<
  PluginCapability,
  | '*'
  | 'net'
  | 'files'
  | 'clipboard'
  | 'storage'
  | 'ui'
  | 'task'
  | 'net.*'
  | 'files.*'
  | 'clipboard.*'
  | 'storage.*'
  | 'ui.*'
  | 'task.*'
>
