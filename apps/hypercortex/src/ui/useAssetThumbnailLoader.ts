import * as React from 'react'
import type { VaultScope } from '../core'
import { assetRefKey, type AssetEntry } from '../assetTypes'
import { canAssetHaveThumbnail } from '../assetThumbnailCapabilities'
import { loadAssetThumbnail } from '../assetThumbnailProvider'
import { updateAssetThumbnailState } from '../assetThumbnailState'
import type { HyperCortexGateway } from '../gateway'

const DEFAULT_THUMBNAIL_WIDTH = 320
const DEFAULT_THUMBNAIL_HEIGHT = 180

type UseAssetThumbnailLoaderParams = {
  gateway: HyperCortexGateway
  scope: VaultScope
  assets: AssetEntry[]
  setAssets: React.Dispatch<React.SetStateAction<AssetEntry[]>>
  revision: number
  width?: number
  height?: number
}

export function useAssetThumbnailLoader({
  gateway,
  scope,
  assets,
  setAssets,
  revision,
  width = DEFAULT_THUMBNAIL_WIDTH,
  height = DEFAULT_THUMBNAIL_HEIGHT,
}: UseAssetThumbnailLoaderParams) {
  const assetsByKeyRef = React.useRef<Map<string, AssetEntry>>(new Map())

  React.useEffect(() => {
    assetsByKeyRef.current = new Map(assets.map(asset => [assetRefKey(asset), asset]))
  }, [assets])

  const loadPlanKey = React.useMemo(() => buildThumbnailLoadPlanKey(assets), [assets])

  React.useEffect(() => {
    if (!loadPlanKey) return
    let cancelled = false
    const loadPlan = loadPlanKey.split('\n').map(parseThumbnailLoadPlanEntry)

    ;(async () => {
      for (const plannedAsset of loadPlan) {
        if (cancelled) break
        const asset = assetsByKeyRef.current.get(plannedAsset.key)
        if (!asset || !isPendingThumbnailAsset(asset) || !isSameThumbnailSource(asset, plannedAsset)) continue
        try {
          const thumbnailUrl = await loadAssetThumbnail({ gateway, scope, asset, width, height })
          if (cancelled) break
          setAssets(prev => updateAssetThumbnailState(prev, asset, { thumbnailUrl, thumbnailError: undefined }))
        } catch (e: any) {
          if (cancelled) break
          const message = String(e?.message || e || 'unknown error')
          console.warn('[HyperCortex][thumb] auto thumbnail failed:', { asset: assetRefKey(asset), relPath: asset.relPath, message })
          setAssets(prev => updateAssetThumbnailState(prev, asset, { thumbnailUrl: undefined, thumbnailError: message }))
        }
      }
    })()

    return () => { cancelled = true }
  }, [gateway, scope, width, height, revision, loadPlanKey, setAssets])
}

type ThumbnailLoadPlanEntry = {
  key: string
  size: number
  modifiedMs: number
}

function buildThumbnailLoadPlanKey(assets: AssetEntry[]): string {
  return assets
    .filter(canAssetHaveThumbnail)
    .map(asset => `${assetRefKey(asset)}\t${asset.size}\t${asset.modifiedMs}`)
    .join('\n')
}

function parseThumbnailLoadPlanEntry(value: string): ThumbnailLoadPlanEntry {
  const [key = '', size = '0', modifiedMs = '0'] = value.split('\t')
  return { key, size: Number(size) || 0, modifiedMs: Number(modifiedMs) || 0 }
}

function isPendingThumbnailAsset(asset: AssetEntry): boolean {
  return canAssetHaveThumbnail(asset) && !asset.thumbnailUrl && !asset.thumbnailError
}

function isSameThumbnailSource(asset: AssetEntry, plannedAsset: ThumbnailLoadPlanEntry): boolean {
  return assetRefKey(asset) === plannedAsset.key && asset.size === plannedAsset.size && asset.modifiedMs === plannedAsset.modifiedMs
}
