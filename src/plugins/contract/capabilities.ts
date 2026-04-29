export const LEGACY_PLUGIN_API_VERSION = 2 as const
export const SYSTEM_BACKEND_PLUGIN_API_VERSION = 3 as const
export const TRUSTED_LOCAL_APP_PLUGIN_API_VERSION = 4 as const
export const REGISTERED_APP_API_VERSION = 5 as const
// apiVersion 4 uses the v4.5 direct background contract in the current runtime.
export const LATEST_PLUGIN_API_VERSION = 4 as const
export const PLUGIN_API_VERSION = LATEST_PLUGIN_API_VERSION

export const SUPPORTED_PLUGIN_API_VERSIONS = [
  LEGACY_PLUGIN_API_VERSION,
  SYSTEM_BACKEND_PLUGIN_API_VERSION,
  TRUSTED_LOCAL_APP_PLUGIN_API_VERSION,
] as const

export type SupportedPluginApiVersion = typeof SUPPORTED_PLUGIN_API_VERSIONS[number]

export type PluginCapability =
  | `tauri:${string}`
  | `cap:${string}`

const CAPABILITY_TEXT_RE = /^[A-Za-z0-9._:*|-]+$/

export function isSupportedPluginApiVersion(value: unknown): value is SupportedPluginApiVersion {
  return typeof value === 'number' && SUPPORTED_PLUGIN_API_VERSIONS.includes(value as SupportedPluginApiVersion)
}

export function isValidPluginCapability(item: unknown): item is PluginCapability {
  const s = String(item ?? '').trim()
  if (!s) return false
  if (s.length > 256) return false
  if (s.includes('\n') || s.includes('\r')) return false

  if (s.startsWith('tauri:')) return true
  if (!s.startsWith('cap:')) return false

  return CAPABILITY_TEXT_RE.test(s.slice('cap:'.length))
}
