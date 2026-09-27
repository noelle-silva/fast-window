import type { HyperCortexNoteResourceRef } from './noteSchema'

// 资产引用标记的生成规则：协议双实现——后端 backend-go/helpers.go 的 assetMarker 是数据侧实现
// （上传结果携带的 marker），默认宽度规则（图片 320、视频 480）改动时两端必须同步。
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
