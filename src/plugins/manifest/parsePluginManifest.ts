import {
  type PluginApiVersion,
  type PluginCapability,
  type PluginManifest,
  SUPPORTED_PLUGIN_API_VERSIONS,
  SYSTEM_BACKEND_PLUGIN_API_VERSION,
  TRUSTED_LOCAL_APP_PLUGIN_API_VERSION,
  isSupportedPluginApiVersion,
  isValidPluginCapability,
} from '../pluginContract'

export type ManifestParseResult =
  | { ok: true; manifest: PluginManifest; warnings: string[] }
  | { ok: false; reason: string }

const BACKEND_LIFECYCLES = new Set(['on_demand', 'resident', 'short_lived'] as const)
const BACKEND_RUNTIMES = ['node', 'python', 'deno', 'bun', 'direct'] as const
const BACKEND_RUNTIME_SET = new Set<string>(BACKEND_RUNTIMES)

type ManifestVersionPolicy = {
  requireDescription: boolean
  requireRequires: boolean
  requireUiType: boolean
  systemBackend: boolean
}

function isSafePluginId(id: string) {
  return /^[A-Za-z0-9_-]+$/.test(id)
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveManifestPolicy(apiVersion: PluginApiVersion): ManifestVersionPolicy {
  return {
    requireDescription: apiVersion < TRUSTED_LOCAL_APP_PLUGIN_API_VERSION,
    requireRequires: apiVersion < TRUSTED_LOCAL_APP_PLUGIN_API_VERSION,
    requireUiType: apiVersion < TRUSTED_LOCAL_APP_PLUGIN_API_VERSION,
    systemBackend: apiVersion >= SYSTEM_BACKEND_PLUGIN_API_VERSION,
  }
}

function parseOptionalStringField(value: unknown, fieldName: string, required: boolean): ManifestParseResult | null {
  if (typeof value === 'string') return null
  if (value === undefined && !required) return null
  return { ok: false, reason: `${fieldName} must be a string${required ? '' : ' when provided'}` }
}

function parseRequires(value: unknown, required: boolean): { ok: true; requires: PluginCapability[] } | { ok: false; reason: string } {
  if (value === undefined && !required) return { ok: true, requires: [] }
  if (!Array.isArray(value)) return { ok: false, reason: 'manifest.requires must be an array' }

  const requires: PluginCapability[] = []
  for (const item of value) {
    if (!isValidPluginCapability(item)) return { ok: false, reason: `unknown capability "${String(item)}"` }
    requires.push(String(item).trim() as PluginCapability)
  }
  return { ok: true, requires }
}

function validateUiType(value: unknown, required: boolean): ManifestParseResult | null {
  if (value === 'iframe') return null
  if (value === undefined && !required) return null
  return { ok: false, reason: `ui.type must be "iframe"${required ? '' : ' when provided'}` }
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
  const policy = resolveManifestPolicy(apiVersion)

  const uiTypeResult = validateUiType(raw?.ui?.type, policy.requireUiType)
  if (uiTypeResult) return uiTypeResult

  const name = normalizeText(raw?.name)
  if (!name) return { ok: false, reason: 'manifest.name is required' }

  const version = normalizeText(raw?.version)
  if (!version) return { ok: false, reason: 'manifest.version is required' }

  const description = raw?.description
  const descriptionResult = parseOptionalStringField(description, 'manifest.description', policy.requireDescription)
  if (descriptionResult) return descriptionResult

  const requiresResult = parseRequires(raw?.requires, policy.requireRequires)
  if (!requiresResult.ok) return requiresResult

  const main = normalizeText(raw?.main)
  if (!main) return { ok: false, reason: 'manifest.main is required' }

  // 系统级后台从 v3 开始使用 lifecycle；v2 保留 autoStart legacy 兼容。
  const bg = raw?.background
  if (bg) {
    const lc = bg?.lifecycle
    const autoStart = bg?.autoStart

    if (policy.systemBackend) {
      if (autoStart !== undefined) {
        return { ok: false, reason: `apiVersion=${apiVersion} does not allow background.autoStart; use background.lifecycle` }
      }
      const bgMain = normalizeText(bg?.main)
      if (!bgMain) {
        return { ok: false, reason: `apiVersion=${apiVersion} requires background.main for system backend process` }
      }
      if (!BACKEND_LIFECYCLES.has(lc)) {
        return { ok: false, reason: `apiVersion=${apiVersion} requires background.lifecycle: on_demand | resident | short_lived` }
      }
      const runtime = bg?.runtime
      if (runtime !== undefined && !BACKEND_RUNTIME_SET.has(runtime)) {
        return { ok: false, reason: `background.runtime must be one of: ${BACKEND_RUNTIMES.join(' | ')}` }
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
    description: typeof description === 'string' ? description : '',
    main,
    apiVersion,
    requires: requiresResult.requires,
  }

  return { ok: true, manifest, warnings }
}
