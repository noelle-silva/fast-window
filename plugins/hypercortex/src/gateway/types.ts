import type { Api, VaultScope } from '../core'
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

export type FileGateway = Api['files'] & {
  getThumbnail: (req: { scope: VaultScope; path: string; width?: number | null; height?: number | null }) => Promise<string>
}

export type HostGateway = {
  toast: (message: string) => Promise<void>
  back: () => Promise<void>
  startDragging: () => Promise<void>
  getLibraryDir: () => Promise<string>
  pickLibraryDir: () => Promise<string | null>
  openDir: (dir: string) => Promise<void>
}

export type ClipboardGateway = Api['clipboard']

export type LowLevelGateway = {
  host: HostGateway
  files: FileGateway
  clipboard: ClipboardGateway
}

type WithoutApi<F> = F extends (api: Api, ...args: infer P) => infer R ? (...args: P) => R : never

export type NotesService = {
  saveNotePackage: WithoutApi<typeof import('../notePackage').saveNotePackage>
  loadNotePackage: WithoutApi<typeof import('../notePackage').loadNotePackage>
  loadNoteManifest: WithoutApi<typeof import('../notePackage').loadNoteManifest>
  tryReadNoteManifest: WithoutApi<typeof import('../notePackage').tryReadNoteManifest>
  loadNoteFace: WithoutApi<typeof import('../notePackage').loadNoteFace>
  saveNoteFace: WithoutApi<typeof import('../notePackage').saveNoteFace>
  deleteNoteFace: WithoutApi<typeof import('../notePackage').deleteNoteFace>
  loadHtmlFace: WithoutApi<typeof import('../notePackage').loadHtmlFace>
  saveHtmlFace: WithoutApi<typeof import('../notePackage').saveHtmlFace>
  deleteHtmlFace: WithoutApi<typeof import('../notePackage').deleteHtmlFace>
  saveHtmlFaceFixedScale: WithoutApi<typeof import('../notePackage').saveHtmlFaceFixedScale>
  loadNoteIndex: (scope: VaultScope) => Promise<HyperCortexIndexV1>
  rebuildNoteIndexFromFs: (scope: VaultScope, idx: HyperCortexIndexV1) => Promise<HyperCortexIndexV1>
  createEmptyNote: (scope: VaultScope, input: Parameters<typeof import('../notePackage').saveNotePackage>[2]) => Promise<{ meta: NoteMeta; doc: HyperCortexNoteDoc }>
}

export type AssetsService = {
  ensureAssetsIndex: (scope: VaultScope) => Promise<HyperCortexAssetsIndexV1>
  listAssets: (scope: VaultScope) => Promise<AssetPoolItem[]>
  importFiles: (scope: VaultScope, inputs: { name?: string; dataUrl: string }[]) => Promise<HyperCortexNoteResourceRef[]>
  readAssetDataUrl: (scope: VaultScope, assetId: string, ext?: string) => Promise<string>
  deleteAsset: (scope: VaultScope, assetId: string, ext?: string) => Promise<void>
  getVideoThumbnail: (scope: VaultScope, path: string, width?: number, height?: number) => Promise<string>
  getAssetBlobUrl: (scope: VaultScope, assetId: string, ext: string) => Promise<string>
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

export type HyperCortexGateway = LowLevelGateway & {
  notes: NotesService
  assets: AssetsService
  favorites: FavoritesService
  trash: TrashService
  refs: RefsService
  metadata: MetadataService
}

export type { HyperCortexHtmlFaceDoc, HyperCortexTrashItem }
