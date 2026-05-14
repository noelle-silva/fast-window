import type { VaultScope } from '../core'
import type { HyperCortexGateway } from '../gateway'
import type { AssetUploadTaskSnapshot } from '../gateway/types'
import { pickLocalAssetFiles } from './localAssetFilePicker'

export async function startPickedLocalAssetUploadTask(
  gateway: HyperCortexGateway,
  scope: VaultScope,
): Promise<AssetUploadTaskSnapshot | null> {
  const files = await pickLocalAssetFiles()
  if (!files.length) return null
  return gateway.assets.startUpload(scope, files)
}
