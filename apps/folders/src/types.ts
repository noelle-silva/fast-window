export type FwLaunchInfo = { launched: boolean; standalone: boolean; mode: string }

export type DataDirStatus = {
  dataDir: string
  defaultDataDir: string
  configuredDataDir?: string | null
  writable: boolean
  error?: string | null
}

export type BackendEndpoint = {
  mode: 'direct'
  transport: 'local-websocket'
  url: string
  token: string
  protocolVersion: number
}

export type CollectionsDataHealth = {
  ok: boolean
  error?: string
  schemaVersion?: number
  dataVersion?: number
}

export type CollectionsHealth = {
  ok: boolean
  dataDir: string
  time: string
  data: CollectionsDataHealth
}

export type CollectionCategoryId = 'folder' | 'url' | 'file'
export type CollectionViewCategoryId = CollectionCategoryId | 'all'

export type CollectionGroup = { id: string; name: string }

export type CollectionGridLayout = { x: number; y: number }

export type DesktopEntryKind = 'item' | 'container'

export type DesktopIcon =
  | { kind: 'color'; color: string }
  | { kind: 'image'; assetId: string }

export type DesktopWallpaperView = { x: number; y: number; scale: number }

export type DesktopWallpaperPreset = { id: string; name: string; assetId: string; view: DesktopWallpaperView }

export type DesktopWallpaper = { activeId: string; presets: DesktopWallpaperPreset[] }

export type CategoryDesktopWallpaper = { categoryId: CollectionViewCategoryId; wallpaper?: DesktopWallpaper }

export type DesktopWallpaperDeck = { schemaVersion: number; dataVersion: number; categories: CategoryDesktopWallpaper[] }

export type DesktopIconLayout = { rowGap: number; columnGap: number; iconScale: number }

export type CollectionDesktopState = { wallpaper?: DesktopWallpaper; iconLayout: DesktopIconLayout }

export type CollectionContainer = {
  id: string
  name: string
  groupId: string
  pageOrder: number
  createdAt: string
  updatedAt: string
  createdAtMs: number
  updatedAtMs: number
  layout?: CollectionGridLayout
}

export type DesktopAssetKind = 'icon' | 'wallpaper'

export type DesktopAsset = { id: string; kind: DesktopAssetKind }

export type WebIconCandidate = {
  id: string
  label: string
  source: string
  url: string
  mediaType: string
  sizes?: string
  width?: number
  height?: number
  assetId?: string
  dataUrl?: string
}

export type WebIconDiscoveryResult = {
  url: string
  candidates: WebIconCandidate[]
  warnings?: string[]
}

export type WebIconDiscoveryProgress = { active: boolean; found: number }

export type CollectionTarget =
  | { kind: 'folder'; path: string }
  | { kind: 'url'; url: string }
  | { kind: 'file'; path: string }

export type CollectionItem = {
  id: string
  name: string
  target: CollectionTarget
  groupId: string
  sourceCategoryId?: CollectionCategoryId
  sourceItemId?: string
  pageOrder: number
  containerId?: string
  createdAt: string
  updatedAt: string
  createdAtMs: number
  updatedAtMs: number
  layout?: CollectionGridLayout
  containerLayout?: CollectionGridLayout
  icon?: DesktopIcon
}

export type CategoryWorkspace = {
  id: CollectionViewCategoryId
  groups: CollectionGroup[]
  items: CollectionItem[]
  containers: CollectionContainer[]
  desktop: CollectionDesktopState
}

export type CategoryWorkspaceView = CategoryWorkspace & {
  schemaVersion: number
  dataVersion: number
  categoryOrder: CollectionViewCategoryId[]
  uiState: FoldersUiState
}

export type FoldersUiState = {
  activeCategoryId: CollectionViewCategoryId
  groupIdByCategory: Record<CollectionViewCategoryId, string>
}

export type CollectionsDoc = {
  schemaVersion: number
  dataVersion: number
  activeCategoryId: CollectionCategoryId
  categoryOrder: CollectionViewCategoryId[]
  categories: CategoryWorkspace[]
  uiState: FoldersUiState
  updatedAt: string
}

export type AllViewItemCandidate = { categoryId: CollectionCategoryId; item: CollectionItem }

export type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  cancelBackend(): void
  dispose(): void
  onProgress?: (event: string, payload: unknown) => void
  resetTimer(): void
}

export type RequestOptions = {
  onProgress?(event: string, payload: unknown): void
  signal?: AbortSignal
}

export type DirectClient = {
  request<T>(method: string, params?: unknown, options?: RequestOptions): Promise<T>
  assetUrl(assetId: string): string
  close(): void
}

export type Phase = 'starting' | 'ready' | 'data-error' | 'failed'

export type IconAppearanceCandidate = { id: string; label: string; icon?: DesktopIcon; dataUrl?: string }

export type IconAppearanceState = {
  draftIcon: DesktopIcon | null
  draftCandidateId?: string
  draftDataUrl?: string
  candidates: IconAppearanceCandidate[]
}

export type CollectionItemFormState = {
  name: string
  target: string
  groupId: string
  newGroupName: string
  icon: IconAppearanceState
}

export type GroupFormState = { id: string; name: string }

export type ContainerFormState = { id: string; name: string }

export type ConfirmState = { kind: 'item' | 'group' | 'container'; id: string; label: string } | null

export type DesktopGridEntry = {
  kind: DesktopEntryKind
  id: string
  name: string
  layout?: CollectionGridLayout
  icon?: DesktopIcon
  item?: CollectionItem
  container?: CollectionContainer
  itemCount?: number
}

export type EntryContextMenuState = { kind: 'entry'; entry: DesktopGridEntry; x: number; y: number }
export type ContainerItemContextMenuState = { kind: 'container-item'; container: CollectionContainer; item: CollectionItem; x: number; y: number }
export type ContainerBlankContextMenuState = { kind: 'container-blank'; container: CollectionContainer; x: number; y: number }
export type DesktopContextMenuState = { kind: 'desktop'; x: number; y: number }
export type BlankContextMenuState = ContainerBlankContextMenuState | DesktopContextMenuState
export type ContextMenuState = EntryContextMenuState | ContainerItemContextMenuState | ContainerBlankContextMenuState | DesktopContextMenuState | null

// Compatibility alias for visual grid modules that still describe square icon layout geometry.
export type FolderGridLayout = CollectionGridLayout
