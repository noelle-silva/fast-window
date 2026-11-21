// 商店目录（catalog.json）的纯数据操作：形态校验、重建、上架、下架与发布版本策略。不碰网络与文件。

import { compareSemverStrict, isSafeId, parseSemverStrict } from './fast-window-dev-store-common.mjs'

export function assertStoreCatalogShape(catalog, label = 'catalog') {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) throw new Error(`${label} 必须是对象`)
  if (catalog.catalogVersion !== 2) throw new Error(`${label}.catalogVersion 必须为 2`)
  if (!Array.isArray(catalog.apps)) throw new Error(`${label}.apps 必须是数组`)
  if (!Array.isArray(catalog.plugins)) throw new Error(`${label}.plugins 必须是数组`)
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

function normalizeHostEntry(host) {
  if (host === undefined) return undefined
  if (!host || typeof host !== 'object' || Array.isArray(host)) throw new Error('catalog.host 必须是对象')
  if (host.id !== 'fast-window') throw new Error('catalog.host.id 必须是 fast-window')
  if (!String(host.name || '').trim()) throw new Error('catalog.host.name 不能为空')
  if (!parseSemverStrict(host.version)) throw new Error('catalog.host.version 必须是 x.y.z 格式')
  const windows = host.platforms?.windows
  if (!windows || typeof windows !== 'object' || Array.isArray(windows)) throw new Error('catalog.host.platforms.windows 必须是对象')
  if (windows.installerType !== 'msi') throw new Error('catalog.host.platforms.windows.installerType 必须是 msi')
  const sizeBytes = windows.sizeBytes
  if (sizeBytes !== undefined && (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0)) {
    throw new Error('catalog.host.platforms.windows.sizeBytes 必须是非负整数')
  }
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

function sortByName(entries) {
  return [...entries].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')))
}

function entryId(entry) {
  return String(entry?.id || '').trim()
}

// 按覆盖项重建目录：保留宿主条目，应用与插件按名称排序，刷新生成时间。
export function buildStoreCatalog(catalog, overrides = {}) {
  assertStoreCatalogShape(catalog)
  const pick = key => (Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : catalog[key])
  const generatedAt = String(overrides.generatedAt || new Date().toISOString()).trim()
  const host = normalizeHostEntry(pick('host'))
  return {
    catalogVersion: 2,
    generatedAt,
    ...(host ? { host } : {}),
    apps: sortByName(pick('apps')),
    plugins: sortByName(pick('plugins')),
  }
}

export function upsertStoreApp(catalog, appEntry, generatedAt = new Date().toISOString()) {
  assertStoreCatalogShape(catalog)
  const apps = catalog.apps.filter(app => entryId(app) !== appEntry.id)
  apps.push(appEntry)
  return buildStoreCatalog(catalog, { generatedAt, apps })
}

export function removeStoreApp(catalog, appId, generatedAt = new Date().toISOString()) {
  assertStoreCatalogShape(catalog)
  if (!isSafeId(appId)) throw new Error(`app id 不合法: ${appId || '(empty)'}`)
  const removed = catalog.apps.find(app => entryId(app) === appId) || null
  if (!removed) throw new Error(`远端 catalog 中不存在应用: ${appId}`)
  const apps = catalog.apps.filter(app => entryId(app) !== appId)
  return { catalog: buildStoreCatalog(catalog, { generatedAt, apps }), removed }
}

// 发布版本策略：同版本禁止覆盖、版本号必须递增。
export function assertAppPublishVersionPolicy(catalog, appId, version) {
  const published = catalog.apps.find(app => entryId(app) === appId)
  if (!published) return
  const publishedVersion = String(published.version || '').trim()
  const cmp = compareSemverStrict(version, publishedVersion)
  if (cmp === 0) throw new Error(`该应用版本已发布，严禁覆盖: ${appId}@${version}`)
  if (cmp < 0) throw new Error(`应用版本号必须递增: ${appId} 云端=${publishedVersion} 本地=${version}`)
}
