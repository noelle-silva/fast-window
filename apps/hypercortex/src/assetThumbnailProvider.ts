import type { VaultScope } from './core'
import type { AssetEntry } from './assetTypes'
import type { HyperCortexGateway } from './gateway'
import { pickAssetDisplayName } from './assetDisplayName'
import { createDocxThumbnailDataUrl, renderDocxArrayBufferToHtml } from './docxDocumentRenderer'

type ThumbnailRequest = {
  gateway: HyperCortexGateway
  scope: VaultScope
  asset: AssetEntry
  width?: number
  height?: number
  force?: boolean
}

export async function loadAssetThumbnail(request: ThumbnailRequest): Promise<string> {
  if (isDocxAsset(request.asset)) {
    return renderDocxThumbnail(request)
  }
  const width = request.width || 320
  const height = request.height || 180
  const result = request.force
    ? await request.gateway.assets.rebuildThumbnail(request.scope, request.asset.assetId, request.asset.ext, width, height)
    : await request.gateway.assets.getThumbnail(request.scope, request.asset.assetId, request.asset.ext, width, height)
  return String(result.dataUrl || '')
}

function isDocxAsset(asset: Pick<AssetEntry, 'kind' | 'ext'>): boolean {
  return asset.kind === 'document' && String(asset.ext || '').trim().toLowerCase() === 'docx'
}

async function renderDocxThumbnail({ gateway, scope, asset, width = 320, height = 180 }: ThumbnailRequest): Promise<string> {
  const blobUrl = await gateway.assets.getAssetBlobUrl(scope, asset.assetId, asset.ext)
  const response = await fetch(blobUrl)
  if (!response.ok) throw new Error(`读取 Word 文件失败：${response.status}`)
  const result = await renderDocxArrayBufferToHtml(await response.arrayBuffer())
  if (result.warnings) console.warn('[HyperCortex][word-thumb] mammoth warnings:', result.warnings)
  const title = pickAssetDisplayName({ indexName: asset.displayName, sourceName: asset.sourceName, ext: asset.ext })
  return createDocxThumbnailDataUrl(result, title, width, height)
}
