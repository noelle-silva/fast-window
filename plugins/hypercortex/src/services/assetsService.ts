import type { Api, VaultScope } from '../core'
import { getAssetBlobUrl as getAssetBlobUrlWithReader } from '../assetBlobUrl'
import { deleteAssetFromPool, importFilesToAssetPool, listAssetsInPool, readAssetAsDataUrl } from '../assetPool'
import { ensureAssetsIndex } from '../assetStore'
import type { AssetsService, FileGateway } from '../gateway/types'

export function createAssetsService(api: Api, files: FileGateway): AssetsService {
  const service: AssetsService = {
    ensureAssetsIndex: (scope: VaultScope) => ensureAssetsIndex(api, scope),
    listAssets: (scope: VaultScope) => listAssetsInPool(api, scope),
    importFiles: (scope, inputs) => importFilesToAssetPool(api, scope, inputs),
    readAssetDataUrl: (scope, assetId, ext) => readAssetAsDataUrl(api, scope, assetId, ext),
    deleteAsset: (scope, assetId, ext) => deleteAssetFromPool(api, scope, assetId, ext),
    getVideoThumbnail: (scope, path, width = 320, height = 180) => files.getThumbnail({ scope, path, width, height }),
    getAssetBlobUrl: (scope, assetId, ext) => getAssetBlobUrlWithReader(service, scope, assetId, ext),
  }
  return service
}
