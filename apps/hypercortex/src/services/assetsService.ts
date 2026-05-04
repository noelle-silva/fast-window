import { getAssetBlobUrl as getAssetBlobUrlWithReader } from '../assetBlobUrl'
import type { AssetsService } from '../gateway/types'
import type { BackgroundClient } from '../gateway/backgroundClient'
import { HyperCortexRpc } from '../shared/rpcMethods'

export function createAssetsService(background: BackgroundClient): AssetsService {
  const service: AssetsService = {
    ensureAssetsIndex: scope => background.invoke(HyperCortexRpc.assets.ensureIndex, { scope }),
    listAssets: scope => background.invoke(HyperCortexRpc.assets.list, { scope }),
    importFiles: (scope, inputs) => background.invoke(HyperCortexRpc.assets.importFiles, { scope, inputs }),
    readAssetDataUrl: (scope, assetId, ext) => background.invoke(HyperCortexRpc.assets.readDataUrl, { scope, assetId, ext }),
    deleteAsset: (scope, assetId, ext) => background.invoke(HyperCortexRpc.assets.delete, { scope, assetId, ext }),
    getVideoThumbnail: (scope, path, width = 320, height = 180) => background.invoke(HyperCortexRpc.assets.getVideoThumbnail, { scope, path, width, height }),
    getAssetBlobUrl: (scope, assetId, ext) => getAssetBlobUrlWithReader(service, scope, assetId, ext),
  }
  return service
}
