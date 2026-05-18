import { ASSETS_DIR, kindFromMime, mimeFromExt, type Api, type VaultScope, monthFolder } from './core'

type AssetCategory = 'images' | 'videos' | 'docs'

export const ASSETS_INDEX_FILE = 'hypercortex-assets-index.json'

export type AssetsIndexEntryV2 = {
  metadataVersion: 2
  assetId: string
  ext: string
  path: string
  kind: string
  mime?: string
  size: number
  createdAtMs: number
  uploadedAtMs: number
  updatedAtMs: number
  modifiedMs: number
  sourceName?: string
  displayName?: string
  remark?: string
  tags: string[]
}

export type HyperCortexAssetsIndexV2 = {
  version: 2
  assets: Record<string, AssetsIndexEntryV2>
}

export type AssetPoolItem = {
  relPath: string
  name: string
  assetId: string
  ext: string
  kind: string
  mime?: string
  sourceName?: string
  displayName?: string
  remark?: string
  tags: string[]
  size: number
  createdAtMs: number
  uploadedAtMs: number
  updatedAtMs: number
  modifiedMs: number
}

const ASSET_INDEX_VERSION = 2
const ASSET_METADATA_VERSION = 2

const __indexCache: Partial<Record<VaultScope, HyperCortexAssetsIndexV2>> = {}

function assetKey(assetId: string, ext?: string): string {
  const id = String(assetId || '').trim()
  const e = String(ext || '').trim().toLowerCase().replace(/^\./, '')
  return e ? `${id}.${e}` : id
}

function assetFileName(assetId: string, ext?: string): string {
  const key = assetKey(assetId, ext)
  return key
}

function assetExtFromFileName(name: string): { assetId: string; ext: string } {
  const s = String(name || '').trim()
  const dotIdx = s.lastIndexOf('.')
  if (dotIdx <= 0) return { assetId: s, ext: '' }
  return { assetId: s.slice(0, dotIdx), ext: s.slice(dotIdx + 1).toLowerCase() }
}

function monthFolderFromMs(ms: number): string {
  const n = Number(ms)
  if (Number.isFinite(n) && n > 0) return monthFolder(new Date(n))
  return monthFolder()
}

function kindToCategory(kind: string): AssetCategory {
  const k = String(kind || '').trim().toLowerCase()
  if (k === 'image') return 'images'
  if (k === 'video') return 'videos'
  // 约定：音频也归到 videos（“音视频”一类），满足“图片/视频/文档”三分法
  if (k === 'audio') return 'videos'
  return 'docs'
}

async function readJsonOrNull(api: Api, scope: VaultScope, path: string): Promise<any | null> {
  try {
    const raw = await api.files.readText({ scope, path })
    return JSON.parse(raw || 'null')
  } catch {
    return null
  }
}

async function writeJson(api: Api, scope: VaultScope, path: string, value: any): Promise<void> {
  await api.files.writeText({ scope, path, text: JSON.stringify(value, null, 2), overwrite: true })
}

export async function ensureAssetsIndex(api: Api, scope: VaultScope): Promise<HyperCortexAssetsIndexV2> {
  const cached = __indexCache[scope]
  if (cached) return cached
  const parsed = await readJsonOrNull(api, scope, ASSETS_INDEX_FILE)
  if (parsed && typeof parsed === 'object' && parsed.assets && typeof parsed.assets === 'object') {
    __indexCache[scope] = migrateAssetsIndex(parsed)
    if (parsed.version !== ASSET_INDEX_VERSION) await writeJson(api, scope, ASSETS_INDEX_FILE, __indexCache[scope]).catch(() => {})
    return __indexCache[scope]!
  }
  const fresh: HyperCortexAssetsIndexV2 = { version: ASSET_INDEX_VERSION, assets: {} }
  await writeJson(api, scope, ASSETS_INDEX_FILE, fresh).catch(() => {})
  __indexCache[scope] = fresh
  return fresh
}

export async function saveAssetsIndex(api: Api, scope: VaultScope, idx: HyperCortexAssetsIndexV2): Promise<void> {
  __indexCache[scope] = idx
  await writeJson(api, scope, ASSETS_INDEX_FILE, idx)
}

async function upsertIndex(
  api: Api,
  scope: VaultScope,
  assetId: string,
  ext: string,
  entry: Partial<AssetsIndexEntryV2>,
): Promise<void> {
  const idx = await ensureAssetsIndex(api, scope)
  const key = assetKey(assetId, ext)
  const next: HyperCortexAssetsIndexV2 = {
    version: ASSET_INDEX_VERSION,
    assets: {
      ...idx.assets,
      [key]: normalizeAssetMetadata(key, { ...(idx.assets[key] || {}), ...entry }),
    },
  }
  await saveAssetsIndex(api, scope, next).catch(() => {})
}

async function removeFromIndex(api: Api, scope: VaultScope, assetId: string, ext: string): Promise<void> {
  const idx = await ensureAssetsIndex(api, scope)
  const key = assetKey(assetId, ext)
  if (!idx.assets[key]) return
  const nextAssets = { ...idx.assets }
  delete nextAssets[key]
  await saveAssetsIndex(api, scope, { version: ASSET_INDEX_VERSION, assets: nextAssets }).catch(() => {})
}

async function findAssetPathByScanning(api: Api, scope: VaultScope, fileName: string): Promise<string | null> {
  // 新结构：Assets/<category>/<yyyy-mm>/<fileName>
  for (const cat of ['images', 'videos', 'docs'] as const) {
    const catDir = `${ASSETS_DIR}/${cat}`
    const monthDirs = await api.files.listDir({ scope, dir: catDir }).catch(() => [])
    for (const monthDir of monthDirs) {
      if (!monthDir.isDirectory) continue
      const month = String(monthDir.name || '').trim()
      if (!/^\d{4}-\d{2}$/.test(month)) continue
      const items = await api.files.listDir({ scope, dir: `${catDir}/${month}` }).catch(() => [])
      if (items.some(e => e.isFile && e.name === fileName)) return `${catDir}/${month}/${fileName}`
    }
  }

  return null
}

export async function resolveAssetRelPath(api: Api, scope: VaultScope, assetId: string, ext?: string): Promise<string> {
  const fileName = assetFileName(assetId, ext)
  const { assetId: id0, ext: ext0 } = assetExtFromFileName(fileName)

  const idx = await ensureAssetsIndex(api, scope)
  const key = assetKey(id0, ext0)
  const hit = idx.assets[key]?.path
  if (hit) return hit

  const found = await findAssetPathByScanning(api, scope, fileName)
  if (!found) throw new Error('资源文件不存在')

  await upsertIndex(api, scope, id0, ext0, { path: found }).catch(() => {})
  return found
}

export async function getAssetWriteRelPath(
  api: Api,
  scope: VaultScope,
  assetId: string,
  ext: string,
  kind: string,
  nowMs = Date.now(),
): Promise<string> {
  const idx = await ensureAssetsIndex(api, scope)
  const key = assetKey(assetId, ext)
  const hit = idx.assets[key]?.path
  if (hit) return hit

  const cat = kindToCategory(kind)
  const month = monthFolderFromMs(nowMs)
  const fileName = assetFileName(assetId, ext)
  return `${ASSETS_DIR}/${cat}/${month}/${fileName}`
}

export async function deleteAssetById(api: Api, scope: VaultScope, assetId: string, ext?: string): Promise<void> {
  const fileName = assetFileName(assetId, ext)
  const { assetId: id0, ext: ext0 } = assetExtFromFileName(fileName)
  const relPath = await resolveAssetRelPath(api, scope, id0, ext0)
  await api.files.delete({ scope, path: relPath })
  await removeFromIndex(api, scope, id0, ext0).catch(() => {})
}

export async function recordAssetWritten(
  api: Api,
  scope: VaultScope,
  input: { assetId: string; ext: string; relPath: string; kind?: string; size?: number; modifiedMs?: number; displayName?: string },
): Promise<void> {
  const assetId = String(input.assetId || '').trim()
  const ext = String(input.ext || '').trim().toLowerCase().replace(/^\./, '')
  const relPath = String(input.relPath || '').trim()
  if (!assetId || !relPath) return
  const displayName0 = String(input.displayName || '').trim()
  const displayName = displayName0 ? displayName0.slice(0, 180).trim() : ''
  await upsertIndex(api, scope, assetId, ext, {
    metadataVersion: ASSET_METADATA_VERSION,
    assetId,
    ext,
    path: relPath,
    kind: String(input.kind || '').trim() || undefined,
    mime: mimeFromExt(ext) || undefined,
    size: Number(input.size) > 0 ? Number(input.size) : undefined,
    createdAtMs: Number(input.modifiedMs) > 0 ? Number(input.modifiedMs) : Date.now(),
    uploadedAtMs: Number(input.modifiedMs) > 0 ? Number(input.modifiedMs) : Date.now(),
    updatedAtMs: Date.now(),
    modifiedMs: Number(input.modifiedMs) > 0 ? Number(input.modifiedMs) : undefined,
    sourceName: displayName || undefined,
    displayName: displayName || undefined,
    tags: [],
  }).catch(() => {})
}

export async function scanAssetPool(api: Api, scope: VaultScope): Promise<AssetPoolItem[]> {
  const idx = await ensureAssetsIndex(api, scope)
  const items: AssetPoolItem[] = []

  const pushFile = (relPath: string, name: string, size: number, modifiedMs: number) => {
    if (!name) return
    const { assetId, ext } = assetExtFromFileName(name)
    const key = assetKey(assetId, ext)
    const entry = normalizeAssetMetadata(key, { ...(idx.assets[key] || {}), path: relPath, size, modifiedMs })
    items.push(assetPoolItemFromMetadata(entry))
  }

  // new: Assets/<category>/<yyyy-mm>/*
  for (const cat of ['images', 'videos', 'docs'] as const) {
    const catDir = `${ASSETS_DIR}/${cat}`
    const monthDirs = await api.files.listDir({ scope, dir: catDir }).catch(() => [])
    for (const monthDir of monthDirs) {
      if (!monthDir.isDirectory) continue
      const month = String(monthDir.name || '').trim()
      if (!/^\d{4}-\d{2}$/.test(month)) continue
      const fileEntries = await api.files.listDir({ scope, dir: `${catDir}/${month}` }).catch(() => [])
      for (const ent of fileEntries) {
        if (!ent.isFile) continue
        pushFile(`${catDir}/${month}/${ent.name}`, ent.name, ent.size, ent.modifiedMs)
      }
    }
  }

  // 扫描结果回填索引，保证旧数据和缺失索引可恢复。
  let changed = false
  const nextAssets = { ...idx.assets }
  for (const it of items) {
    const { assetId, ext } = assetExtFromFileName(it.name)
    const key = assetKey(assetId, ext)
    const prev = nextAssets[key]
    if (!prev || prev.path !== it.relPath || prev.size !== it.size || prev.modifiedMs !== it.modifiedMs) {
      nextAssets[key] = normalizeAssetMetadata(key, { ...(prev || {}), path: it.relPath, size: it.size, modifiedMs: it.modifiedMs })
      changed = true
    }
  }
  if (changed) await saveAssetsIndex(api, scope, { version: ASSET_INDEX_VERSION, assets: nextAssets }).catch(() => {})

  return items.sort((a, b) => (b.modifiedMs || 0) - (a.modifiedMs || 0))
}

function migrateAssetsIndex(parsed: any): HyperCortexAssetsIndexV2 {
  const assets: Record<string, AssetsIndexEntryV2> = {}
  for (const [key, raw] of Object.entries(parsed.assets || {})) {
    if (!raw || typeof raw !== 'object') continue
    const normalized = normalizeAssetMetadata(key, raw as Partial<AssetsIndexEntryV2>)
    if (!normalized.assetId || !normalized.path) continue
    assets[assetKey(normalized.assetId, normalized.ext)] = normalized
  }
  return { version: ASSET_INDEX_VERSION, assets }
}

function normalizeAssetMetadata(key: string, raw: Partial<AssetsIndexEntryV2>): AssetsIndexEntryV2 {
  const parsed = assetExtFromFileName(key)
  const assetId = String(raw.assetId || parsed.assetId || '').trim()
  const ext = String(raw.ext || parsed.ext || '').trim().toLowerCase().replace(/^\./, '')
  const mime = String(raw.mime || (ext ? mimeFromExt(ext) : '') || '').trim()
  const kind = String(raw.kind || (mime ? kindFromMime(mime) : '') || 'document').trim()
  const modifiedMs = Number(raw.modifiedMs) > 0 ? Number(raw.modifiedMs) : 0
  const createdAtMs = Number(raw.createdAtMs) > 0 ? Number(raw.createdAtMs) : modifiedMs
  const uploadedAtMs = Number(raw.uploadedAtMs) > 0 ? Number(raw.uploadedAtMs) : createdAtMs
  const updatedAtMs = Number(raw.updatedAtMs) > 0 ? Number(raw.updatedAtMs) : createdAtMs
  return {
    metadataVersion: ASSET_METADATA_VERSION,
    assetId,
    ext,
    path: String(raw.path || '').trim(),
    kind,
    mime: mime || undefined,
    size: Number(raw.size) > 0 ? Number(raw.size) : 0,
    createdAtMs,
    uploadedAtMs,
    updatedAtMs,
    modifiedMs,
    sourceName: String(raw.sourceName || '').trim() || undefined,
    displayName: String(raw.displayName || '').trim() || undefined,
    remark: String(raw.remark || '').trim() || undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.map(tag => String(tag || '').trim()).filter(Boolean) : [],
  }
}

function assetPoolItemFromMetadata(entry: AssetsIndexEntryV2): AssetPoolItem {
  return {
    relPath: entry.path,
    name: assetKey(entry.assetId, entry.ext),
    assetId: entry.assetId,
    ext: entry.ext,
    kind: entry.kind,
    mime: entry.mime,
    sourceName: entry.sourceName,
    displayName: entry.displayName,
    remark: entry.remark,
    tags: [...entry.tags],
    size: entry.size,
    createdAtMs: entry.createdAtMs,
    uploadedAtMs: entry.uploadedAtMs,
    updatedAtMs: entry.updatedAtMs,
    modifiedMs: entry.modifiedMs,
  }
}
