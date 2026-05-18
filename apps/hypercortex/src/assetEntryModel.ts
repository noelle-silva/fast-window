import { kindFromMime, mimeFromExt } from './core'
import type { AssetEntry } from './assetTypes'
import type { AssetPoolItem } from './assetStore'

export function parseAssetFileName(name: string): { assetId: string; ext: string } {
  const s = String(name || '').trim()
  const dotIdx = s.lastIndexOf('.')
  if (dotIdx <= 0) return { assetId: s, ext: '' }
  return { assetId: s.slice(0, dotIdx), ext: s.slice(dotIdx + 1).toLowerCase() }
}

export function buildAssetEntry(item: AssetPoolItem): AssetEntry {
  const parsed = parseAssetFileName(item.name)
  const assetId = String(item.assetId || parsed.assetId || '').trim()
  const ext = String(item.ext || parsed.ext || '').trim().toLowerCase()
  const mime = String(item.mime || (ext ? mimeFromExt(ext) : '') || '').trim()
  const kind = String(item.kind || (mime ? kindFromMime(mime) : '') || 'document').trim()
  return {
    relPath: String(item.relPath || '').trim(),
    fileName: String(item.name || (ext ? `${assetId}.${ext}` : assetId)).trim(),
    displayName: String(item.displayName || '').trim() || undefined,
    sourceName: String(item.sourceName || '').trim() || undefined,
    assetId,
    ext,
    kind,
    mime: mime || undefined,
    size: Number(item.size) || 0,
    createdAtMs: Number(item.createdAtMs) || undefined,
    uploadedAtMs: Number(item.uploadedAtMs) || undefined,
    updatedAtMs: Number(item.updatedAtMs) || undefined,
    modifiedMs: Number(item.modifiedMs) || 0,
    remark: String(item.remark || '').trim() || undefined,
    tags: Array.isArray(item.tags) ? item.tags.map(tag => String(tag || '').trim()).filter(Boolean) : [],
  }
}

export function buildAssetEntries(items: AssetPoolItem[]): AssetEntry[] {
  return (Array.isArray(items) ? items : []).map(buildAssetEntry)
}
