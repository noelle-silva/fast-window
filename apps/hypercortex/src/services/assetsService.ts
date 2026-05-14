import { getAssetBlobUrl as getAssetBlobUrlWithReader } from '../assetBlobUrl'
import type { AssetsService } from '../gateway/types'
import type { BackgroundClient } from '../gateway/backgroundClient'
import { HyperCortexRpc } from '../shared/rpcMethods'

export function createAssetsService(background: BackgroundClient): AssetsService {
  const service: AssetsService = {
    ensureAssetsIndex: scope => background.invoke(HyperCortexRpc.assets.ensureIndex, { scope }),
    listAssets: scope => background.invoke(HyperCortexRpc.assets.list, { scope }),
    startUpload: (scope, files) => background.invoke(HyperCortexRpc.assets.uploadStart, { scope, files }),
    listUploadTasks: () => background.invoke(HyperCortexRpc.assets.uploadList, {}),
    pauseUploadTask: taskId => background.invoke(HyperCortexRpc.assets.uploadPause, { taskId }),
    resumeUploadTask: taskId => background.invoke(HyperCortexRpc.assets.uploadResume, { taskId }),
    cancelUploadTask: taskId => background.invoke(HyperCortexRpc.assets.uploadCancel, { taskId }),
    readAssetDataUrl: (scope, assetId, ext) => background.invoke(HyperCortexRpc.assets.readDataUrl, { scope, assetId, ext }),
    deleteAsset: (scope, assetId, ext) => background.invoke(HyperCortexRpc.assets.delete, { scope, assetId, ext }),
    getThumbnail: (scope, assetId, ext, width = 320, height = 180) => background.invoke(HyperCortexRpc.assets.getThumbnail, { scope, assetId, ext, width, height }),
    rebuildThumbnail: (scope, assetId, ext, width = 320, height = 180) => background.invoke(HyperCortexRpc.assets.rebuildThumbnail, { scope, assetId, ext, width, height }),
    rebuildAllThumbnails: (scope, width = 320, height = 180) => background.invoke(HyperCortexRpc.assets.rebuildAllThumbnails, { scope, width, height }),
    getVideoThumbnail: (scope, path, width = 320, height = 180) => background.invoke(HyperCortexRpc.assets.getVideoThumbnail, { scope, path, width, height }),
    getAssetBlobUrl: (scope, assetId, ext) => getAssetBlobUrlWithReader(service, scope, assetId, ext),
  }
  return service
}
