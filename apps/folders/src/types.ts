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

export type CollectionGroup = { id: string; name: string }

export type CollectionGridLayout = { x: number; y: number }

export type DesktopEntryKind = 'item' | 'container'

export type DesktopIcon =
  | { kind: 'color'; color: string }
  | { kind: 'image'; assetId: string }

export type DesktopWallpaperView = { x: number; y: number; scale: number }

export type DesktopWallpaperPreset = { id: string; name: string; assetId: string; view: DesktopWallpaperView }

export type DesktopWallpaper = { activeId: string; presets: DesktopWallpaperPreset[] }

export type CategoryDesktopWallpaper = { categoryId: CollectionCategoryId; wallpaper?: DesktopWallpaper }

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

export type CollectionTarget =
  | { kind: 'folder'; path: string }
  | { kind: 'url'; url: string }
  | { kind: 'file'; path: string }

export type CollectionItem = {
  id: string
  name: string
  target: CollectionTarget
  groupId: string
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
  id: CollectionCategoryId
  groups: CollectionGroup[]
  items: CollectionItem[]
  containers: CollectionContainer[]
  desktop: CollectionDesktopState
}

export type CategoryWorkspaceView = CategoryWorkspace & {
  schemaVersion: number
  dataVersion: number
}

export type CollectionsDoc = {
  schemaVersion: number
  dataVersion: number
  activeCategoryId: CollectionCategoryId
  categories: CategoryWorkspace[]
  updatedAt: string
}

export type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export type DirectClient = {
  request<T>(method: string, params?: unknown): Promise<T>
  assetUrl(assetId: string): string
  close(): void
}

export type Phase = 'starting' | 'ready' | 'data-error' | 'failed'

export type CollectionItemFormState = {
  name: string
  target: string
  groupId: string
  newGroupName: string
}

export type GroupFormState = { id: string; name: string }

export type ContainerFormState = { id: string; name: string }

export type IconEditorState = { id: string; label: string; icon?: DesktopIcon } | null

export type ConfirmState = { kind: 'item' | 'group' | 'container' | 'data-reset'; id: string; label: string } | null

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

export type ContextMenuState = { entry: DesktopGridEntry; x: number; y: number } | null

// Compatibility alias for visual grid modules that still describe square icon layout geometry.
export type FolderGridLayout = CollectionGridLayout
