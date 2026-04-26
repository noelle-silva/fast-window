import type { PluginManifest, PluginBackgroundLifecycle } from '../pluginContract'

export type ResolvedBackendLifecycle = {
  lifecycle: PluginBackgroundLifecycle
  /**
   * 用来解释生命周期策略是从哪里来的：
   * - manifest：插件显式声明（新体系推荐）
   * - legacy：兼容旧插件（autoStart 语义）
   */
  source: 'manifest' | 'legacy'
}

export function resolveBackendLifecycle(manifest?: PluginManifest | null): ResolvedBackendLifecycle | null {
  const bg = manifest?.background
  if (!bg) return null

  const apiVersion = typeof (manifest as any)?.apiVersion === 'number' ? (manifest as any).apiVersion : 2

  const lc = (bg as any)?.lifecycle
  if (lc === 'on_demand' || lc === 'resident' || lc === 'short_lived') {
    return { lifecycle: lc, source: 'manifest' }
  }

  // 系统级后台不再使用 autoStart 这种细碎开关，必须用生命周期档位表达意图。
  if (apiVersion >= 3) {
    console.warn(`[backend-lifecycle] invalid system backend manifest: background.lifecycle is missing or unknown (plugin="${String(manifest?.id || '')}")`)
    return { lifecycle: 'on_demand', source: 'manifest' }
  }

  // v2 兼容：历史上 background 存在时默认 autoStart=true
  // - autoStart !== false => 常驻（启动即驻留）
  // - autoStart === false => 按需（仅在需要时启动）
  const autoStart = (bg as any)?.autoStart
  if (autoStart === false) return { lifecycle: 'on_demand', source: 'legacy' }
  return { lifecycle: 'resident', source: 'legacy' }
}
