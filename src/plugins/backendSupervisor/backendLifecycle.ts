import type { PluginManifest } from '../pluginContract'

export type LegacyPluginBackgroundLifecycle = 'on_demand' | 'resident'

export type ResolvedBackendLifecycle = {
  lifecycle: LegacyPluginBackgroundLifecycle
  /**
   * 用来解释生命周期策略是从哪里来的：
   * - legacy：兼容旧插件（autoStart 语义）
   */
  source: 'legacy'
}

export function resolveBackendLifecycle(manifest?: PluginManifest | null): ResolvedBackendLifecycle | null {
  const bg = manifest?.background
  if (!bg) return null

  // v2 兼容：历史上 background 存在时默认 autoStart=true
  // - autoStart !== false => 常驻（启动即驻留）
  // - autoStart === false => 按需（仅在需要时启动）
  const autoStart = (bg as any)?.autoStart
  if (autoStart === false) return { lifecycle: 'on_demand', source: 'legacy' }
  return { lifecycle: 'resident', source: 'legacy' }
}
