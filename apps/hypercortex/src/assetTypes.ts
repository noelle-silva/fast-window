export type AssetEntry = {
  relPath: string
  fileName: string
  displayName?: string
  sourceName?: string
  assetId: string
  ext: string
  kind: string
  mime?: string
  size: number
  createdAtMs?: number
  uploadedAtMs?: number
  updatedAtMs?: number
  modifiedMs: number
  remark?: string
  tags?: string[]
  thumbnailUrl?: string
  thumbnailError?: string
}

export function assetRefKey(asset: Pick<AssetEntry, 'assetId' | 'ext'>): string {
  const assetId = String(asset.assetId || '').trim()
  const ext = String(asset.ext || '').trim().toLowerCase()
  return ext ? `${assetId}.${ext}` : assetId
}

export function assetTabId(asset: Pick<AssetEntry, 'assetId' | 'ext'>): string {
  return `asset:${assetRefKey(asset)}`
}

