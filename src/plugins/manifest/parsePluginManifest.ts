import {
  type PluginApiVersion,
  type PluginCapability,
  type PluginManifest,
  SUPPORTED_PLUGIN_API_VERSIONS,
  isSupportedPluginApiVersion,
  isValidPluginCapability,
} from '../pluginContract'

export type ManifestParseResult =
  | { ok: true; manifest: PluginManifest; warnings: string[] }
  | { ok: false; reason: string }

const BACKEND_LIFECYCLES = new Set(['on_demand', 'resident', 'short_lived'] as const)

function isSafePluginId(id: string) {
  return /^[A-Za-z0-9_-]+$/.test(id)
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function parsePluginManifest(pluginId: string, manifestContent: string): ManifestParseResult {
  let raw: any
  try {
    raw = JSON.parse(manifestContent)
  } catch (e) {
    return { ok: false, reason: 'manifest.json is not valid JSON' }
  }

  const warnings: string[] = []

  const manifestId = normalizeText(raw?.id)
  if (!manifestId || !isSafePluginId(manifestId)) return { ok: false, reason: 'invalid manifest.id' }
  if (manifestId !== pluginId) return { ok: false, reason: `manifest.id "${manifestId}" must match directory "${pluginId}"` }

  if (!isSupportedPluginApiVersion(raw?.apiVersion)) {
    return {
      ok: false,
      reason: `unsupported apiVersion: plugin=${String(raw?.apiVersion)}, supported=${SUPPORTED_PLUGIN_API_VERSIONS.join(',')}`,
    }
  }
  const apiVersion = raw.apiVersion as PluginApiVersion

  const uiType = raw?.ui?.type
  if (uiType !== 'iframe') return { ok: false, reason: 'ui.type must be "iframe"' }

  const name = normalizeText(raw?.name)
  if (!name) return { ok: false, reason: 'manifest.name is required' }

  const version = normalizeText(raw?.version)
  if (!version) return { ok: false, reason: 'manifest.version is required' }

  const description = raw?.description
  if (typeof description !== 'string') return { ok: false, reason: 'manifest.description must be a string' }

  const requires = raw?.requires
  if (!Array.isArray(requires)) return { ok: false, reason: 'manifest.requires must be an array' }
  const normalizedRequires: PluginCapability[] = []
  for (const item of requires) {
    if (!isValidPluginCapability(item)) return { ok: false, reason: `unknown capability "${String(item)}"` }
    normalizedRequires.push(String(item).trim() as PluginCapability)
  }

  const main = normalizeText(raw?.main)
  if (!main) return { ok: false, reason: 'manifest.main is required' }

  // background 语义校验：v3 只允许 lifecycle；v2 保留 autoStart legacy 兼容。
  const bg = raw?.background
  if (bg) {
    const lc = bg?.lifecycle
    const autoStart = bg?.autoStart

    if (apiVersion >= 3) {
      if (autoStart !== undefined) {
        return { ok: false, reason: 'apiVersion=3 does not allow background.autoStart; use background.lifecycle' }
      }
      if (!BACKEND_LIFECYCLES.has(lc)) {
        return { ok: false, reason: 'apiVersion=3 requires background.lifecycle: on_demand | resident | short_lived' }
      }
    } else {
      // v2：允许 lifecycle（便于前向迁移），但它与 autoStart 同时存在时，以 lifecycle 为准。
      if (lc !== undefined && !BACKEND_LIFECYCLES.has(lc)) {
        return { ok: false, reason: `unknown background.lifecycle "${String(lc)}"` }
      }
      if (lc !== undefined && autoStart !== undefined) {
        warnings.push('background.autoStart is ignored because background.lifecycle is present (v2 compat)')
      }
    }
  }

  const manifest: PluginManifest = {
    ...raw,
    id: manifestId,
    name,
    version,
    description,
    main,
    apiVersion,
    requires: normalizedRequires,
  }

  return { ok: true, manifest, warnings }
}
