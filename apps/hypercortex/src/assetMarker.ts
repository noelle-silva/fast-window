import type { HyperCortexNoteResourceRef } from './noteSchema'

export function buildAssetMarker(asset: Pick<HyperCortexNoteResourceRef, 'assetId' | 'ext' | 'kind'>): string {
  const assetId = String(asset.assetId || '').trim()
  const ext = String(asset.ext || '').trim().toLowerCase()
  const ref = ext ? `${assetId}.${ext}` : assetId
  const defaultWidth = asset.kind === 'image' ? 320 : asset.kind === 'video' ? 480 : 0
  return defaultWidth ? `{{asset:${ref}||${defaultWidth}}}` : `{{asset:${ref}}}`
}

export function buildAssetMarkerBlock(assets: Pick<HyperCortexNoteResourceRef, 'assetId' | 'ext' | 'kind'>[]): string {
  return assets.map(buildAssetMarker).filter(Boolean).join('\n')
}

export function formatAssetMarkerInsertion(markerBlock: string, before: string, after: string): string {
  const insert = String(markerBlock || '')
  if (!insert) return ''
  const prefix = before && !/\s$/.test(before) ? '\n' : ''
  const suffix = after && !/^\s/.test(after) ? '\n' : ''
  return `${prefix}${insert}${suffix}`
}
