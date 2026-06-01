import { assetRefKey, type AssetEntry } from './assetTypes'

export type AssetThumbnailPatch = Pick<AssetEntry, 'thumbnailUrl' | 'thumbnailError'>

export type AssetThumbnailResultMaps = {
  thumbnailUrlsByKey: ReadonlyMap<string, string>
  thumbnailErrorsByKey: ReadonlyMap<string, string>
}

export function mergeAssetThumbnailState(nextAssets: AssetEntry[], previousAssets: AssetEntry[]): AssetEntry[] {
  const previousByKey = new Map(previousAssets.map(asset => [assetRefKey(asset), asset]))
  return nextAssets.map(asset => {
    const previous = previousByKey.get(assetRefKey(asset))
    if (!previous?.thumbnailUrl || !isSameAssetFileVersion(asset, previous)) return asset
    return { ...asset, thumbnailUrl: previous.thumbnailUrl }
  })
}

export function updateAssetThumbnailState(assets: AssetEntry[], target: AssetEntry, patch: AssetThumbnailPatch): AssetEntry[] {
  return assets.map(asset => (isSameAssetFileVersion(asset, target) ? { ...asset, ...patch } : asset))
}

export function applyAssetThumbnailResults(assets: AssetEntry[], { thumbnailUrlsByKey, thumbnailErrorsByKey }: AssetThumbnailResultMaps): AssetEntry[] {
  return assets.map(asset => {
    const key = assetRefKey(asset)
    const thumbnailUrl = thumbnailUrlsByKey.get(key)
    if (thumbnailUrl) return { ...asset, thumbnailUrl, thumbnailError: undefined }
    const thumbnailError = thumbnailErrorsByKey.get(key)
    return thumbnailError ? { ...asset, thumbnailUrl: undefined, thumbnailError } : asset
  })
}

export function isSameAssetFileVersion(left: AssetEntry, right: AssetEntry): boolean {
  return assetRefKey(left) === assetRefKey(right) && left.size === right.size && left.modifiedMs === right.modifiedMs
}
