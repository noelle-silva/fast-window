import { invoke } from '@tauri-apps/api/core'

export type PluginStoreInstallResult = {
  pluginId: string
  version: string
}

export async function pluginStoreInstall(opts: { url: string; expectedSha256: string }): Promise<PluginStoreInstallResult> {
  const url = String(opts.url || '').trim()
  const expectedSha256 = String(opts.expectedSha256 || '').trim()
  if (!url) throw new Error('url 不能为空')
  if (!expectedSha256) throw new Error('expectedSha256 不能为空')
  return await invoke<PluginStoreInstallResult>('plugin_store_install', { url, expectedSha256 })
}

