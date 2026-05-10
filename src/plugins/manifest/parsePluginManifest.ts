import {
  type PluginCapability,
  type PluginManifest,
  SUPPORTED_PLUGIN_API_VERSIONS,
  isSupportedPluginApiVersion,
  isValidPluginCapability,
} from '../pluginContract'

export type ManifestParseResult =
  | { ok: true; manifest: PluginManifest; warnings: string[] }
  | { ok: false; reason: string }

function isSafePluginId(id: string) {
  return /^[A-Za-z0-9_-]+$/.test(id)
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
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
      reason: `unsupported plugin apiVersion: plugin=${String(raw?.apiVersion)}, supported=${SUPPORTED_PLUGIN_API_VERSIONS.join(',')}. v3/v4 were transition contracts; v5 apps must use the registered app package contract.`,
    }
  }
  const apiVersion = raw.apiVersion

  const uiTypeResult = validateUiType(raw?.ui?.type, true)
  if (uiTypeResult) return uiTypeResult

  const name = normalizeText(raw?.name)
  if (!name) return { ok: false, reason: 'manifest.name is required' }

  const version = normalizeText(raw?.version)
  if (!version) return { ok: false, reason: 'manifest.version is required' }

  const description = raw?.description
  const descriptionResult = parseOptionalStringField(description, 'manifest.description', true)
  if (descriptionResult) return descriptionResult

  const requiresResult = parseRequires(raw?.requires, true)
  if (!requiresResult.ok) return requiresResult

  const main = normalizeText(raw?.main)
  if (!main) return { ok: false, reason: 'manifest.main is required' }

  const bg = raw?.background
  if (bg) {
    if (!bg || typeof bg !== 'object' || Array.isArray(bg)) return { ok: false, reason: 'manifest.background must be an object when provided' }
    if (bg.lifecycle !== undefined) return { ok: false, reason: 'background.lifecycle belongs to removed v3/v4 transition contracts' }
    if (bg.runtime !== undefined) return { ok: false, reason: 'background.runtime belongs to removed v3/v4 transition contracts' }
    if (bg.autoStart !== undefined && typeof bg.autoStart !== 'boolean') return { ok: false, reason: 'background.autoStart must be a boolean when provided' }
    if (bg.main !== undefined && typeof bg.main !== 'string') return { ok: false, reason: 'background.main must be a string when provided' }
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
