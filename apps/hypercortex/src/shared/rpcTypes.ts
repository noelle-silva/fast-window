import type { HyperCortexFavoritesDocV1 } from '../favorites'
import type { NoteRefIndex } from '../noteRefs'
import type { HyperCortexIndexV1, HyperCortexMetadataV1, NoteMeta, VaultScope } from '../core'
import type { HyperCortexTrashItem } from '../trash'
import type { HyperCortexNoteResourceRef } from '../noteSchema'
import type { HyperCortexNoteFaceSettingsV2 } from '../noteFaces'

export type RpcScope = VaultScope
export type ScopeParams = { scope: RpcScope }

export type LoadPackageParams = ScopeParams & { packageDir: string }
export type LoadManifestParams = LoadPackageParams
export type TryReadManifestParams = LoadPackageParams
export type LoadFaceParams = LoadPackageParams & { faceId: string }
export type DeleteFaceParams = LoadPackageParams & { faceId: string }
export type DeleteHtmlFaceParams = LoadPackageParams
export type SaveHtmlFaceFixedScaleParams = LoadPackageParams & { fixedScale: number | null }

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
}

export type SavePackageParams = ScopeParams & { input: SavePackageInput }
export type CreateNoteParams = SavePackageParams

export type SaveFaceInput = SavePackageInput & {
  faceId: string
  kind: string
  content: string
  settings?: HyperCortexNoteFaceSettingsV2 | null
}

export type SaveFaceParams = ScopeParams & { input: SaveFaceInput }
export type SaveHtmlFaceParams = ScopeParams & { input: SavePackageInput & { html: string } }
export type RebuildIndexParams = ScopeParams & { idx: HyperCortexIndexV1 }

export type ImportFilesParams = ScopeParams & { inputs: { name?: string; dataUrl: string }[] }
export type ReadAssetDataUrlParams = ScopeParams & { assetId: string; ext?: string }
export type DeleteAssetParams = ScopeParams & { assetId: string; ext?: string }
export type GetVideoThumbnailParams = ScopeParams & { path: string; width?: number | null; height?: number | null }

export type SaveRefIndexParams = ScopeParams & { idx: NoteRefIndex }
export type UpdateRefsForNoteParams = ScopeParams & { noteId: string; body: string }
export type RemoveNoteFromRefIndexParams = ScopeParams & { noteId: string }

export type SaveMetadataParams = { meta: HyperCortexMetadataV1 }
export type SaveFavoritesParams = { doc: HyperCortexFavoritesDocV1 }

export type MoveNoteToTrashParams = ScopeParams & { note: NoteMeta }
export type PermanentlyDeleteNoteDirParams = ScopeParams & { noteId: string; dir: string }
export type RestoreTrashItemParams = ScopeParams & { item: HyperCortexTrashItem }
export type MaybeAutoCleanupTrashParams = ScopeParams & { days: number }

export type HostOpenDirParams = { dir: string }
