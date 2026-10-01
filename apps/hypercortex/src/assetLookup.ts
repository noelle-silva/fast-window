import { kindFromMime, mimeFromExt } from './core'
import type { AssetEntry } from './assetTypes'
import { buildAssetEntry } from './assetEntryModel'

// 附件索引（assets 表）→ 附件条目的统一查找：按索引键与按 assetId 两套索引，
// 供主界面收藏夹页与收藏夹导航栏共用，保证同一附件在两处的解析结果一致。

export type AssetLookup = {
  byKey: Record<string, AssetEntry>
  byAssetId: Record<string, AssetEntry>
}

export function buildAssetLookup(assetIndex?: Record<string, any>): AssetLookup {
  const byKey: Record<string, AssetEntry> = {}
  const byAssetId: Record<string, AssetEntry> = {}
  if (!assetIndex) return { byKey, byAssetId }

  for (const [k, v] of Object.entries(assetIndex)) {
    if (!v || typeof v !== 'object') continue
    const raw = v as any
    const key = String(k || '').trim()
    const dotIdx = key.lastIndexOf('.')
    const assetId = String(raw.assetId || (dotIdx > 0 ? key.slice(0, dotIdx) : key)).trim()
    const ext = String(raw.ext || (dotIdx > 0 ? key.slice(dotIdx + 1) : '')).trim().toLowerCase()
    const relPath = String(raw.relPath || raw.path || '').trim()
    if (!assetId || !relPath) continue
    const mime = mimeFromExt(ext)
    const kind = String(raw.kind || '').trim() || (mime ? kindFromMime(mime) : 'document')
    const asset = buildAssetEntry({
      relPath,
      name: String(raw.fileName || key || (ext ? `${assetId}.${ext}` : assetId)),
      assetId,
      ext,
      kind: kind || 'document',
      mime: String(raw.mime || '').trim() || undefined,
      sourceName: String(raw.sourceName || '').trim() || undefined,
      displayName: String(raw.displayName || '').trim() || undefined,
      remark: String(raw.remark || '').trim() || undefined,
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      size: Number(raw.size || 0) || 0,
      createdAtMs: Number(raw.createdAtMs || 0) || 0,
      uploadedAtMs: Number(raw.uploadedAtMs || 0) || 0,
      updatedAtMs: Number(raw.updatedAtMs || 0) || 0,
      modifiedMs: Number(raw.modifiedMs || 0) || 0,
    })
    const refKey = ext ? `${assetId}.${ext}` : assetId
    byKey[key || refKey] = asset
    byKey[refKey] = asset
    byAssetId[assetId] = asset
  }
  return { byKey, byAssetId }
}

/** 按收藏夹引用的 targetId（附件键或 assetId）解析出附件条目。 */
export function resolveAssetRef(lookup: AssetLookup, targetId: string): AssetEntry | undefined {
  const id = String(targetId || '').trim()
  if (!id) return undefined
  return lookup.byKey[id] || lookup.byAssetId[id]
}
