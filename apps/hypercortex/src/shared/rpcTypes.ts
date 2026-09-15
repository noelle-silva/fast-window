import type { HyperCortexFavoritesDocV1 } from '../favorites'
import type { HyperCortexIndexV1, HyperCortexMetadataV1, NoteMeta, VaultScope } from '../core'
import type { HyperCortexTrashItem } from '../gateway/types'
import type { HyperCortexNoteResourceRef } from '../noteSchema'
import type { HyperCortexNoteFaceSettingsV2 } from '../noteFaces'

export type RpcScope = VaultScope
export type ScopeParams = { scope: RpcScope }

export type LoadPackageParams = ScopeParams & { packageDir: string }
export type LoadManifestParams = LoadPackageParams
export type TryReadManifestParams = LoadPackageParams
export type LoadFaceParams = LoadPackageParams & { faceId: string }
export type DeleteFaceParams = LoadPackageParams & { faceId: string; mode: 'trash' | 'permanent' }
export type SaveFaceSettingsParams = LoadPackageParams & { faceId: string; settings: HyperCortexNoteFaceSettingsV2 }

export type SavePackageInput = {
  id?: string
  packageDir?: string
  title?: string
  description?: string
  body?: string
  tags?: string[]
  createdAtMs?: number
  resources?: HyperCortexNoteResourceRef[]
  saveTextFace?: boolean
  faceKinds?: string[]
}

export type SavePackageParams = ScopeParams & { input: SavePackageInput }
export type CreateNoteParams = SavePackageParams

export type SaveFaceInput = SavePackageInput & {
  faceId: string
  kind: string
  content: string
  settings?: HyperCortexNoteFaceSettingsV2 | null
}

export type SaveFaceContentInput = {
  faceId: string
  kind: string
  content: string
}

export type SaveFacesInput = SavePackageInput & { faces: SaveFaceContentInput[] }

export type SaveFaceParams = ScopeParams & { input: SaveFaceInput }
export type SaveFacesParams = ScopeParams & { input: SaveFacesInput }
export type SaveFaceOrderParams = LoadPackageParams & { faceOrder: string[] }
export type SaveHtmlFaceParams = ScopeParams & { input: SavePackageInput & { html: string } }
export type RebuildIndexParams = ScopeParams & { idx: HyperCortexIndexV1 }

export type StartAssetUploadParams = ScopeParams & { files: { path?: string; name?: string; displayName?: string; size?: number; deleteSourceAfterUpload?: boolean }[] }
export type AssetUploadTaskControlParams = { taskId: string }
export type ReadAssetDataUrlParams = ScopeParams & { assetId: string; ext?: string }
export type DeleteAssetParams = ScopeParams & { assetId: string; ext?: string }
export type GetVideoThumbnailParams = ScopeParams & { path: string; width?: number | null; height?: number | null }

export type SaveMetadataParams = { meta: HyperCortexMetadataV1 }
export type SaveFavoritesParams = { doc: HyperCortexFavoritesDocV1 }

export type MoveNoteToTrashParams = ScopeParams & { note: NoteMeta }
export type MoveAssetToTrashParams = ScopeParams & { assetId: string; ext?: string }
export type PermanentlyDeleteNoteDirParams = ScopeParams & { noteId: string; dir: string }
export type PermanentlyDeleteTrashItemParams = ScopeParams & { item: HyperCortexTrashItem }
export type RestoreTrashItemParams = ScopeParams & { item: HyperCortexTrashItem }
export type MaybeAutoCleanupTrashParams = ScopeParams & { days: number }

export type HostOpenDirParams = { dir: string }
