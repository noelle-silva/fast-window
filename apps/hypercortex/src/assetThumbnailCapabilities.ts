import type { AssetEntry } from './assetTypes'

const THUMBNAIL_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'])
const THUMBNAIL_VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv', 'avi'])
const THUMBNAIL_DOCUMENT_EXTENSIONS = new Set([
  'pdf', 'epub', 'docx', 'xlsx', 'pptx',
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'html', 'htm', 'rtf',
])

export function canAssetHaveThumbnail(asset: Pick<AssetEntry, 'kind' | 'ext'>): boolean {
  const ext = normalizeAssetExt(asset.ext)
  if (asset.kind === 'image') return THUMBNAIL_IMAGE_EXTENSIONS.has(ext)
  if (asset.kind === 'video') return THUMBNAIL_VIDEO_EXTENSIONS.has(ext)
  if (asset.kind === 'document') return THUMBNAIL_DOCUMENT_EXTENSIONS.has(ext)
  return false
}

function normalizeAssetExt(ext: unknown): string {
  return String(ext || '').trim().toLowerCase().replace(/^\./, '')
}
