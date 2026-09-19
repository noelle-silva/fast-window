import { parseSemverStrict } from './host-support.mjs'

function assertStoreCatalogBase(catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) throw new Error('catalog 必须是对象')
  if (catalog.catalogVersion !== 2) throw new Error('catalogVersion 必须为 2')
  if (!Array.isArray(catalog.apps)) throw new Error('catalog.apps 必须是数组')
  if (!Array.isArray(catalog.plugins)) throw new Error('catalog.plugins 必须是数组')
}

function assertHttpsUrl(value, field) {
  const url = String(value || '').trim()
  if (!url.startsWith('https://')) throw new Error(`${field} 必须是 https:// URL`)
  return url
}

function assertSha256(value, field) {
  const sha = String(value || '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error(`${field} 必须是 sha256 hex 字符串`)
  return sha
}

function optionalStoreCatalogHost(host) {
  if (host === undefined) return undefined
  if (!host || typeof host !== 'object' || Array.isArray(host)) throw new Error('catalog.host 必须是对象')
  if (host.id !== 'fast-window') throw new Error('catalog.host.id 必须是 fast-window')
  if (!String(host.name || '').trim()) throw new Error('catalog.host.name 不能为空')
  if (!parseSemverStrict(host.version)) throw new Error('catalog.host.version 必须是 x.y.z 格式')
  const windows = host.platforms?.windows
  if (!windows || typeof windows !== 'object' || Array.isArray(windows)) throw new Error('catalog.host.platforms.windows 必须是对象')
  if (windows.installerType !== 'msi') throw new Error('catalog.host.platforms.windows.installerType 必须是 msi')
  const sizeBytes = windows.sizeBytes
  if (sizeBytes !== undefined && (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0)) throw new Error('catalog.host.platforms.windows.sizeBytes 必须是非负整数')
  return {
    id: 'fast-window',
    name: String(host.name).trim(),
    version: String(host.version).trim(),
    platforms: {
      windows: {
        installerType: 'msi',
        downloadUrl: assertHttpsUrl(windows.downloadUrl, 'catalog.host.platforms.windows.downloadUrl'),
        sha256: assertSha256(windows.sha256, 'catalog.host.platforms.windows.sha256'),
        ...(sizeBytes === undefined ? {} : { sizeBytes }),
      },
    },
  }
}

function sortCatalogEntries(entries) {
  return [...entries].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')))
}

export function buildStoreCatalog(catalog, overrides = {}) {
  assertStoreCatalogBase(catalog)
  const generatedAt = String(overrides.generatedAt || new Date().toISOString()).trim()
  const host = optionalStoreCatalogHost(Object.prototype.hasOwnProperty.call(overrides, 'host') ? overrides.host : catalog.host)
  const apps = sortCatalogEntries(Object.prototype.hasOwnProperty.call(overrides, 'apps') ? overrides.apps : catalog.apps)
  const plugins = sortCatalogEntries(Object.prototype.hasOwnProperty.call(overrides, 'plugins') ? overrides.plugins : catalog.plugins)
  return { catalogVersion: 2, generatedAt, ...(host ? { host } : {}), apps, plugins }
}
