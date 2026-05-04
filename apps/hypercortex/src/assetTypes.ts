export type AssetEntry = {
  relPath: string
  fileName: string
  displayName?: string
  assetId: string
  ext: string
  kind: string
  size: number
  modifiedMs: number
  thumbnailUrl?: string
}

export function assetRefKey(asset: Pick<AssetEntry, 'assetId' | 'ext'>): string {
  const assetId = String(asset.assetId || '').trim()
  const ext = String(asset.ext || '').trim().toLowerCase()
  return ext ? `${assetId}.${ext}` : assetId
}

export function assetTabId(asset: Pick<AssetEntry, 'assetId' | 'ext'>): string {
  return `asset:${assetRefKey(asset)}`
}

