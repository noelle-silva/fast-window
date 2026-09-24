import type { VaultScope } from '../core'
import type { AssetPoolItem, HyperCortexAssetsIndexV2 } from '../assetStore'
import type { HyperCortexFavoritesDocV1 } from '../favorites'
import type { NoteRefEntryMap, NoteRefIndex } from '../noteRefs'
import type {
  HyperCortexHtmlFaceDoc,
  HyperCortexNoteFaceDoc,
  HyperCortexNoteFaceSettingsV2,
} from '../noteFaces'
import type { HyperCortexNoteManifestV1, HyperCortexNoteResourceRef } from '../noteSchema'
import type { HyperCortexNoteVersionSnapshot, HyperCortexNoteVersionSummary } from '../noteVersions'
import type { HyperCortexIndexV1, HyperCortexMetadataV1, HyperCortexNoteDoc, NoteMeta } from '../core'
import type { AssetEntry } from '../assetTypes'

export type HyperCortexTrashItem = {
  kind: 'note' | 'asset' | 'face'
  id: string
  title: string
  dir: string
  assetId?: string
  ext?: string
  noteId?: string
  faceId?: string
  createdAtMs: number
  updatedAtMs: number
  deletedAtMs: number
  originalDir: string
}

export type HostGateway = {
  toast: (message: string) => Promise<void>
  back: () => Promise<void>
  startDragging: () => Promise<void>
  getDataDirStatus: () => Promise<DataDirStatus>
  pickDataDir: () => Promise<DataDirStatus | null>
  importLegacyData: () => Promise<LegacyDataImportResult | null>
  getLibraryDir: () => Promise<string>
  openDir: (dir: string) => Promise<void>
  openVaultDir: (scope: VaultScope, dir: string) => Promise<void>
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

export type SaveNotePackageInput = {
  id?: string
  packageDir?: string
  title?: string
  description?: string
  body?: string
  tags?: string[]
  createdAtMs?: number
  resources?: HyperCortexNoteResourceRef[]
  saveTextFace?: boolean
  // 需要确保存在的面类型清单（按顺序）：缺失的类型由后端补齐默认面。
  faceKinds?: string[]
}

export type SaveNoteFaceInput = {
  id?: string
  packageDir?: string
  title?: string
  description?: string
  body?: string
  tags?: string[]
  createdAtMs?: number
  resources?: HyperCortexNoteResourceRef[]
  faceId: string
  kind: string
  content: string
  settings?: HyperCortexNoteFaceSettingsV2 | null
  faceKinds?: string[]
}

// 批量保存时提交的单个面内容（Q24：保存整个笔记所有面）。
export type SaveNoteFaceContentInput = {
  faceId: string
  kind: string
  content: string
}

export type SaveNoteFacesInput = {
  id?: string
  packageDir?: string
  title?: string
  description?: string
  tags?: string[]
  createdAtMs?: number
  resources?: HyperCortexNoteResourceRef[]
  faceKinds?: string[]
  faces: SaveNoteFaceContentInput[]
}

// 笔记包内面设置的补丁：值为 null 表示删除该字段。
export type HyperCortexNoteFaceSettingsPatch = Record<string, unknown>

export type NotesService = {
  loadNoteManifest: (scope: VaultScope, packageDir: string) => Promise<HyperCortexNoteManifestV1>
  tryReadNoteManifest: (scope: VaultScope, packageDir: string) => Promise<HyperCortexNoteManifestV1 | null>
  loadNoteFace: (scope: VaultScope, packageDir: string, faceId: string) => Promise<HyperCortexNoteFaceDoc>
  saveNoteFace: (scope: VaultScope, input: SaveNoteFaceInput) => Promise<{ meta: NoteMeta; faceDoc: HyperCortexNoteFaceDoc; manifest: HyperCortexNoteManifestV1; refs?: NoteRefEntryMap }>
  deleteNoteFace: (scope: VaultScope, packageDir: string, faceId: string, mode: 'trash' | 'permanent') => Promise<{ meta: NoteMeta; manifest: HyperCortexNoteManifestV1; refs?: NoteRefEntryMap }>
  saveNoteFaces: (scope: VaultScope, input: SaveNoteFacesInput) => Promise<{ meta: NoteMeta; doc: HyperCortexNoteDoc; htmlFace: HyperCortexHtmlFaceDoc | null; manifest: HyperCortexNoteManifestV1; refs?: NoteRefEntryMap }>
  saveNoteFaceOrder: (scope: VaultScope, packageDir: string, faceOrder: string[]) => Promise<{ meta: NoteMeta; manifest: HyperCortexNoteManifestV1 }>
  saveFaceSettings: (scope: VaultScope, packageDir: string, faceId: string, settings: HyperCortexNoteFaceSettingsPatch) => Promise<{ meta: NoteMeta; manifest: HyperCortexNoteManifestV1 }>
  publishNoteVersion: (scope: VaultScope, packageDir: string, commitName: string) => Promise<HyperCortexNoteVersionSummary>
  listNoteVersions: (scope: VaultScope, packageDir: string) => Promise<HyperCortexNoteVersionSummary[]>
  loadNoteVersion: (scope: VaultScope, packageDir: string, versionId: string) => Promise<HyperCortexNoteVersionSnapshot>
  restoreNoteVersion: (scope: VaultScope, packageDir: string, versionId: string) => Promise<{ meta: NoteMeta; doc: HyperCortexNoteDoc; manifest: HyperCortexNoteManifestV1; refs?: NoteRefEntryMap }>
  loadNoteIndex: (scope: VaultScope) => Promise<HyperCortexIndexV1>
  rebuildNoteIndexFromFs: (scope: VaultScope, idx: HyperCortexIndexV1) => Promise<HyperCortexIndexV1>
  createEmptyNote: (scope: VaultScope, input: SaveNotePackageInput) => Promise<{ meta: NoteMeta; doc: HyperCortexNoteDoc; manifest: HyperCortexNoteManifestV1 }>
}

export type AssetsService = {
  ensureAssetsIndex: (scope: VaultScope) => Promise<HyperCortexAssetsIndexV2>
  listAssets: (scope: VaultScope) => Promise<AssetPoolItem[]>
  startUpload: (scope: VaultScope, files: LocalAssetFile[]) => Promise<AssetUploadTaskSnapshot>
  listUploadTasks: () => Promise<AssetUploadTaskSnapshot[]>
  pauseUploadTask: (taskId: string) => Promise<AssetUploadTaskSnapshot>
  resumeUploadTask: (taskId: string) => Promise<AssetUploadTaskSnapshot>
  cancelUploadTask: (taskId: string) => Promise<AssetUploadTaskSnapshot>
  readAssetDataUrl: (scope: VaultScope, assetId: string, ext?: string) => Promise<string>
  deleteAsset: (scope: VaultScope, assetId: string, ext?: string) => Promise<void>
  updateAssetMetadata: (scope: VaultScope, assetId: string, ext: string | undefined, metadata: AssetUserMetadataInput) => Promise<AssetPoolItem>
  getThumbnail: (scope: VaultScope, assetId: string, ext?: string, width?: number, height?: number) => Promise<ThumbnailResult>
  rebuildThumbnail: (scope: VaultScope, assetId: string, ext?: string, width?: number, height?: number) => Promise<ThumbnailResult>
  rebuildAllThumbnails: (scope: VaultScope, width?: number, height?: number) => Promise<ThumbnailRebuildReport>
  getVideoThumbnail: (scope: VaultScope, path: string, width?: number, height?: number) => Promise<string>
  getAssetBlobUrl: (scope: VaultScope, assetId: string, ext: string) => Promise<string>
}

export type AssetUserMetadataInput = {
  displayName: string
  remark: string
  tags: string[]
}

export type LocalAssetFile = {
  path?: string
  name?: string
  displayName?: string
  size?: number
  deleteSourceAfterUpload?: boolean
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
  moveAssetToTrash: (scope: VaultScope, assetId: string, ext?: string) => Promise<{ trashDir: string }>
  permanentlyDeleteNoteDir: (scope: VaultScope, noteId: string, dir: string) => Promise<void>
  permanentlyDeleteTrashItem: (scope: VaultScope, item: HyperCortexTrashItem) => Promise<void>
  restoreTrashItem: (scope: VaultScope, item: HyperCortexTrashItem) => Promise<{ meta?: NoteMeta; asset?: AssetEntry }>
  maybeAutoCleanupTrash: (scope: VaultScope, days: number) => Promise<{ deletedCount: number }>
}

export type RefsService = {
  loadRefIndex: (scope: VaultScope) => Promise<NoteRefIndex>
}

export type NoteSearchFaceKind = {
  kind: string
  label: string
}

export type NoteSearchFaceHit = {
  faceId: string
  kind: string
  title: string
  snippet: string
}

export type NoteSearchHit = {
  noteId: string
  title: string
  description: string
  dir: string
  createdAtMs: number
  updatedAtMs: number
  noteFields: string[]
  faceHits: NoteSearchFaceHit[]
}

export type NoteSearchResult = {
  kinds: NoteSearchFaceKind[]
  items: NoteSearchHit[]
}

export type SearchService = {
  listFaceKinds: () => Promise<NoteSearchFaceKind[]>
  queryNotes: (scope: VaultScope, query: string, faceKinds?: string[]) => Promise<NoteSearchResult>
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
  search: SearchService
  metadata: MetadataService
}

export type { HyperCortexHtmlFaceDoc }
