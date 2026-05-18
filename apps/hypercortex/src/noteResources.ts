import type { HyperCortexNoteResourceRef } from './noteSchema'

export function mergeNoteResources(
  current: HyperCortexNoteResourceRef[],
  added: HyperCortexNoteResourceRef[],
): HyperCortexNoteResourceRef[] {
  const map = new Map<string, HyperCortexNoteResourceRef>()
  for (const item of [...current, ...added]) {
    const assetId = String(item?.assetId || '').trim()
    if (!assetId) continue
    const ext = String(item?.ext || '').trim().toLowerCase()
    const key = ext ? `${assetId}.${ext}` : assetId
    map.set(key, {
      assetId,
      mime: String(item?.mime || '').trim() || undefined,
      ext: ext || undefined,
      kind: String(item?.kind || '').trim() || undefined,
      name: String(item?.name || '').trim() || undefined,
    })
  }
  return Array.from(map.values())
}
