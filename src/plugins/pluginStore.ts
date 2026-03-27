import { invoke } from '@tauri-apps/api/core'

export type PluginStoreInstallResult = {
  pluginId: string
  version: string
}

export async function pluginStoreInstall(opts: {
  url: string
  expectedSha256: string
  expectedId: string
  expectedVersion: string
  expectedRequires: string[]
}): Promise<PluginStoreInstallResult> {
  const url = String(opts.url || '').trim()
  const expectedSha256 = String(opts.expectedSha256 || '').trim()
  const expectedId = String(opts.expectedId || '').trim()
  const expectedVersion = String(opts.expectedVersion || '').trim()
  const expectedRequires = Array.isArray(opts.expectedRequires) ? opts.expectedRequires.map(x => String(x || '').trim()).filter(Boolean) : []
  if (!url) throw new Error('url 不能为空')
  if (!expectedSha256) throw new Error('expectedSha256 不能为空')
  if (!expectedId) throw new Error('expectedId 不能为空')
  if (!expectedVersion) throw new Error('expectedVersion 不能为空')
  return await invoke<PluginStoreInstallResult>('plugin_store_install', { url, expectedSha256, expectedId, expectedVersion, expectedRequires })
}
