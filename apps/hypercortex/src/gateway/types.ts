import type { VaultScope } from '../core'
import type { AssetPoolItem, HyperCortexAssetsIndexV1 } from '../assetStore'
import type { HyperCortexFavoritesDocV1 } from '../favorites'
import type { NoteRefIndex } from '../noteRefs'
import type {
  HyperCortexHtmlFaceDoc,
  HyperCortexNoteFaceDoc,
} from '../notePackage'
import type { HyperCortexNoteManifestV1, HyperCortexNoteResourceRef } from '../noteSchema'
import type { HyperCortexIndexV1, HyperCortexMetadataV1, HyperCortexNoteDoc, NoteMeta } from '../core'
import type { HyperCortexTrashItem } from '../trash'

export type HostGateway = {
  toast: (message: string) => Promise<void>
  back: () => Promise<void>
  startDragging: () => Promise<void>
  getDataDirStatus: () => Promise<DataDirStatus>
  pickDataDir: () => Promise<DataDirStatus | null>
  importLegacyData: () => Promise<LegacyDataImportResult | null>
  getLibraryDir: () => Promise<string>
  openDir: (dir: string) => Promise<void>
}

export type DataDirStatus = {
  dataDir: string
  defaultDataDir: string
  configuredDataDir?: string | null
  writable: boolean
  error?: string | null
}

export type LegacyDataImportResult = {
  imported: boolean
  sourceDir: string
  files: string[]
  skipped: string[]
}

export type ClipboardGateway = {
  writeText: (text: string) => Promise<void>
}

export type NotesService = {
  saveNotePackage: (scope: VaultScope, input: Parameters<typeof import('../notePackage').saveNotePackage>[2]) => Promise<{ meta: NoteMeta; doc: HyperCortexNoteDoc }>
  loadNotePackage: (scope: VaultScope, packageDir: string) => Promise<HyperCortexNoteDoc>
  loadNoteManifest: (scope: VaultScope, packageDir: string) => Promise<HyperCortexNoteManifestV1>
  tryReadNoteManifest: (scope: VaultScope, packageDir: string) => Promise<HyperCortexNoteManifestV1 | null>
  loadNoteFace: (scope: VaultScope, packageDir: string, faceId: string) => Promise<HyperCortexNoteFaceDoc>
  saveNoteFace: (scope: VaultScope, input: Parameters<typeof import('../notePackage').saveNoteFace>[2]) => Promise<{ meta: NoteMeta; faceDoc: HyperCortexNoteFaceDoc; manifest: HyperCortexNoteManifestV1 }>
  deleteNoteFace: (scope: VaultScope, packageDir: string, faceId: string) => Promise<HyperCortexNoteManifestV1>
  loadHtmlFace: (scope: VaultScope, packageDir: string) => Promise<HyperCortexHtmlFaceDoc>
  saveHtmlFace: (scope: VaultScope, input: Parameters<typeof import('../notePackage').saveHtmlFace>[2]) => Promise<{ meta: NoteMeta; htmlFace: HyperCortexHtmlFaceDoc }>
  deleteHtmlFace: (scope: VaultScope, packageDir: string) => Promise<HyperCortexHtmlFaceDoc>
  saveHtmlFaceFixedScale: (scope: VaultScope, packageDir: string, fixedScale: number | null) => Promise<void>
  loadNoteIndex: (scope: VaultScope) => Promise<HyperCortexIndexV1>
  rebuildNoteIndexFromFs: (scope: VaultScope, idx: HyperCortexIndexV1) => Promise<HyperCortexIndexV1>
  createEmptyNote: (scope: VaultScope, input: Parameters<typeof import('../notePackage').saveNotePackage>[2]) => Promise<{ meta: NoteMeta; doc: HyperCortexNoteDoc }>
}

export type AssetsService = {
  ensureAssetsIndex: (scope: VaultScope) => Promise<HyperCortexAssetsIndexV1>
  listAssets: (scope: VaultScope) => Promise<AssetPoolItem[]>
  startUpload: (scope: VaultScope, files: LocalAssetFile[]) => Promise<AssetUploadTaskSnapshot>
  listUploadTasks: () => Promise<AssetUploadTaskSnapshot[]>
  pauseUploadTask: (taskId: string) => Promise<AssetUploadTaskSnapshot>
  resumeUploadTask: (taskId: string) => Promise<AssetUploadTaskSnapshot>
  cancelUploadTask: (taskId: string) => Promise<AssetUploadTaskSnapshot>
  readAssetDataUrl: (scope: VaultScope, assetId: string, ext?: string) => Promise<string>
  deleteAsset: (scope: VaultScope, assetId: string, ext?: string) => Promise<void>
  getThumbnail: (scope: VaultScope, assetId: string, ext?: string, width?: number, height?: number) => Promise<ThumbnailResult>
  rebuildThumbnail: (scope: VaultScope, assetId: string, ext?: string, width?: number, height?: number) => Promise<ThumbnailResult>
  rebuildAllThumbnails: (scope: VaultScope, width?: number, height?: number) => Promise<ThumbnailRebuildReport>
  getVideoThumbnail: (scope: VaultScope, path: string, width?: number, height?: number) => Promise<string>
  getAssetBlobUrl: (scope: VaultScope, assetId: string, ext: string) => Promise<string>
}

export type LocalAssetFile = {
  path?: string
  name?: string
  displayName?: string
  mime?: string
  size?: number
  dataBase64?: string
}

export type AssetUploadTaskStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'canceled'
export type AssetUploadFileStatus = 'pending' | 'running' | 'completed' | 'failed' | 'canceled'

export type AssetUploadTaskSnapshot = {
  id: string
  scope: VaultScope
  status: AssetUploadTaskStatus
  files: AssetUploadFileSnapshot[]
  result?: HyperCortexNoteResourceRef[]
  error?: string
  totalBytes: number
  uploadedBytes: number
  progress: number
  currentFileId?: string
  createdMs: number
  startedMs?: number
  updatedMs: number
  completedMs?: number
}

export type AssetUploadFileSnapshot = {
  id: string
  name: string
  path: string
  size: number
  uploadedBytes: number
  progress: number
  status: AssetUploadFileStatus
  error?: string
  resource?: HyperCortexNoteResourceRef
}

export type ThumbnailResult = {
  dataUrl: string
  cached: boolean
  mediaKind: string
  width: number
  height: number
}

export type ThumbnailRebuildReport = {
  total: number
  rebuilt: number
  skipped: number
  failed: number
  failures: { asset: string; path: string; error: string }[]
  width: number
  height: number
  startedMs: number
  completedMs: number
}

export type FavoritesService = {
  ensureFavorites: () => Promise<HyperCortexFavoritesDocV1>
  tryLoadFavorites: () => Promise<HyperCortexFavoritesDocV1 | null>
  saveFavorites: (doc: HyperCortexFavoritesDocV1) => Promise<void>
}

export type TrashService = {
  listTrashItems: (scope: VaultScope) => Promise<HyperCortexTrashItem[]>
  moveNoteToTrash: (scope: VaultScope, note: NoteMeta) => Promise<{ trashDir: string }>
  permanentlyDeleteNoteDir: (scope: VaultScope, noteId: string, dir: string) => Promise<void>
  restoreTrashItem: (scope: VaultScope, item: HyperCortexTrashItem) => Promise<{ meta: NoteMeta }>
  maybeAutoCleanupTrash: (scope: VaultScope, days: number) => Promise<{ deletedCount: number }>
}

export type RefsService = {
  loadRefIndex: (scope: VaultScope) => Promise<NoteRefIndex>
  saveRefIndex: (scope: VaultScope, idx: NoteRefIndex) => Promise<void>
  updateRefsForNote: (scope: VaultScope, noteId: string, body: string) => Promise<NoteRefIndex>
  removeNoteFromRefIndex: (scope: VaultScope, noteId: string) => Promise<NoteRefIndex>
}

export type MetadataService = {
  tryLoadMetadata: () => Promise<HyperCortexMetadataV1 | null>
  ensureMetadata: () => Promise<HyperCortexMetadataV1>
  saveMetadata: (meta: HyperCortexMetadataV1) => Promise<void>
}

export type HyperCortexGateway = {
  host: HostGateway
  clipboard: ClipboardGateway
  notes: NotesService
  assets: AssetsService
  favorites: FavoritesService
  trash: TrashService
  refs: RefsService
  metadata: MetadataService
}

export type { HyperCortexHtmlFaceDoc, HyperCortexTrashItem }
