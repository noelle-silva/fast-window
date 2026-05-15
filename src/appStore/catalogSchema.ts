import type { AppDisplayMode, RegisteredAppCommand } from '../apps/types'
import { parseSemverStrict } from './semver'
import type {
  LegacyPluginStoreEntry,
  LegacyPluginStoreIconRef,
  StoreAppEntry,
  StoreCatalog,
  StoreDownloadAsset,
  StoreImageIconRef,
} from './catalogTypes'

const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/
const SHA256_RE = /^[a-fA-F0-9]{64}$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, field: string, required = true): string {
  if (typeof value !== 'string') {
    if (!required && value === undefined) return ''
    throw new Error(`${field} must be a string`)
  }
  const s = value.trim()
  if (required && !s) throw new Error(`${field} is required`)
  return s
}

function safeId(value: unknown, field: string): string {
  const id = text(value, field)
  if (!SAFE_ID_RE.test(id)) throw new Error(`${field} is invalid`)
  return id
}

function semver(value: unknown, field: string): string {
  const version = text(value, field)
  if (!parseSemverStrict(version)) throw new Error(`${field} must be strict semver x.y.z`)
  return version
}

function httpsUrl(value: unknown, field: string): string {
  const url = text(value, field)
  if (!/^https:\/\//i.test(url)) throw new Error(`${field} must be an https URL`)
  return url
}

function sha256(value: unknown, field: string): string {
  const hash = text(value, field).toLowerCase()
  if (!SHA256_RE.test(hash)) throw new Error(`${field} must be a sha256 hex string`)
  return hash
}

function optionalDisplayMode(value: unknown, field: string): AppDisplayMode | undefined {
  if (value === undefined) return undefined
  if (value === 'default' || value === 'window' || value === 'top') return value
  throw new Error(`${field} must be default | window | top`)
}

function optionalSizeBytes(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`)
  return value
}

function parseImageIcon(value: unknown, field: string): StoreImageIconRef {
  if (!isPlainObject(value)) throw new Error(`${field} must be an icon object`)
  const type = text(value.type, `${field}.type`)
  if (type === 'url') return { type, url: httpsUrl(value.url, `${field}.url`) }
  if (type === 'data') {
    const dataUrl = text(value.dataUrl, `${field}.dataUrl`)
    if (!dataUrl.startsWith('data:image/')) throw new Error(`${field}.dataUrl must be a data:image URL`)
    return { type, dataUrl }
  }
  throw new Error(`${field}.type must be url | data`)
}

function parseLegacyPluginIcon(value: unknown, field: string): LegacyPluginStoreIconRef | undefined {
  if (value === undefined) return undefined
  if (!isPlainObject(value)) throw new Error(`${field} must be an icon object`)
  const type = text(value.type, `${field}.type`)
  if (type === 'emoji') {
    const emoji = text(value.value, `${field}.value`)
    if (emoji.length > 8) throw new Error(`${field}.value is too long`)
    return { type, value: emoji }
  }
  if (type === 'url' || type === 'data') return parseImageIcon(value, field)
  throw new Error(`${field}.type is unsupported`)
}

function parseCommands(value: unknown, field: string): RegisteredAppCommand[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  const out: RegisteredAppCommand[] = []
  const seen = new Set<string>()
  for (const [index, item] of value.entries()) {
    if (!isPlainObject(item)) throw new Error(`${field}[${index}] must be an object`)
    const id = safeId(item.id, `${field}[${index}].id`)
    if (seen.has(id)) throw new Error(`${field}[${index}].id is duplicated`)
    seen.add(id)
    const title = text(item.title, `${field}[${index}].title`)
    const hotkey = item.hotkey === undefined ? undefined : text(item.hotkey, `${field}[${index}].hotkey`)
    out.push(hotkey ? { id, title, hotkey } : { id, title })
  }
  return out
}

function parseAsset(value: unknown, field: string): StoreDownloadAsset {
  if (!isPlainObject(value)) throw new Error(`${field} must be an object`)
  const sizeBytes = optionalSizeBytes(value.sizeBytes, `${field}.sizeBytes`)
  return {
    downloadUrl: httpsUrl(value.downloadUrl, `${field}.downloadUrl`),
    sha256: sha256(value.sha256, `${field}.sha256`),
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
  }
}

function parseAppEntry(value: unknown, index: number): StoreAppEntry {
  const field = `apps[${index}]`
  if (!isPlainObject(value)) throw new Error(`${field} must be an object`)
  if (!isPlainObject(value.platforms)) throw new Error(`${field}.platforms must be an object`)
  return {
    id: safeId(value.id, `${field}.id`),
    name: text(value.name, `${field}.name`),
    description: text(value.description, `${field}.description`),
    version: semver(value.version, `${field}.version`),
    icon: parseImageIcon(value.icon, `${field}.icon`),
    platforms: {
      windows: parseAsset(value.platforms.windows, `${field}.platforms.windows`),
    },
    displayMode: optionalDisplayMode(value.displayMode, `${field}.displayMode`),
    commands: parseCommands(value.commands, `${field}.commands`),
  }
}

function parseRequires(value: unknown, field: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  const out: string[] = []
  for (const [index, item] of value.entries()) {
    const cap = text(item, `${field}[${index}]`)
    if (cap.length > 256 || cap.includes('\n') || cap.includes('\r')) throw new Error(`${field}[${index}] is invalid`)
    out.push(cap)
  }
  out.sort()
  return out.filter((item, index) => index === 0 || item !== out[index - 1])
}

function parsePluginEntry(value: unknown, index: number): LegacyPluginStoreEntry {
  const field = `plugins[${index}]`
  if (!isPlainObject(value)) throw new Error(`${field} must be an object`)
  return {
    id: safeId(value.id, `${field}.id`),
    name: text(value.name, `${field}.name`),
    description: text(value.description, `${field}.description`),
    version: semver(value.version, `${field}.version`),
    icon: parseLegacyPluginIcon(value.icon, `${field}.icon`),
    downloadUrl: httpsUrl(value.downloadUrl, `${field}.downloadUrl`),
    sha256: sha256(value.sha256, `${field}.sha256`),
    requires: parseRequires(value.requires, `${field}.requires`),
  }
}

export function parseStoreCatalog(raw: unknown): StoreCatalog {
  if (!isPlainObject(raw)) throw new Error('store catalog must be an object')
  if (raw.catalogVersion !== 2) throw new Error('unsupported catalogVersion; expected 2')
  if (!Array.isArray(raw.apps)) throw new Error('catalog.apps must be an array')
  if (!Array.isArray(raw.plugins)) throw new Error('catalog.plugins must be an array')

  const generatedAt = raw.generatedAt === undefined ? undefined : text(raw.generatedAt, 'generatedAt')
  const apps = raw.apps.map(parseAppEntry).sort((a, b) => a.name.localeCompare(b.name))
  const plugins = raw.plugins.map(parsePluginEntry).sort((a, b) => a.name.localeCompare(b.name))
  return { catalogVersion: 2, ...(generatedAt ? { generatedAt } : {}), apps, plugins }
}
