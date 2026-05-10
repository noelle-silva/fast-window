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

export type FoldersDataHealth = {
  ok: boolean
  error?: string
  schemaVersion?: number
  dataVersion?: number
}

export type FoldersHealth = {
  ok: boolean
  dataDir: string
  time: string
  data: FoldersDataHealth
}

export type FolderGroup = { id: string; name: string }

export type FolderGridLayout = { x: number; y: number }

export type DesktopEntryKind = 'folder' | 'container'

export type DesktopIcon =
  | { kind: 'color'; color: string }
  | { kind: 'image'; assetId: string }

export type DesktopWallpaper = { assetId: string }

export type DesktopIconLayout = { rowGap: number; columnGap: number; iconScale: number }

export type DesktopState = { wallpaper?: DesktopWallpaper; iconLayout: DesktopIconLayout }

export type DesktopContainer = {
  id: string
  name: string
  groupId: string
  pageOrder: number
  createdAt: string
  updatedAt: string
  createdAtMs: number
  updatedAtMs: number
  layout?: FolderGridLayout
}

export type DesktopAssetKind = 'icon' | 'wallpaper'

export type DesktopAsset = { id: string; kind: DesktopAssetKind }

export type FolderItem = {
  id: string
  name: string
  path: string
  groupId: string
  pageOrder: number
  containerId?: string
  createdAt: string
  updatedAt: string
  createdAtMs: number
  updatedAtMs: number
  layout?: FolderGridLayout
  containerLayout?: FolderGridLayout
  icon?: DesktopIcon
}

export type FoldersDoc = {
  schemaVersion: number
  dataVersion: number
  groups: FolderGroup[]
  items: FolderItem[]
  containers: DesktopContainer[]
  desktop: DesktopState
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

export type FolderFormState = {
  name: string
  path: string
  groupId: string
  newGroupName: string
}

export type GroupFormState = { id: string; name: string }

export type ContainerFormState = { id: string; name: string }

export type IconEditorState = { id: string; label: string; icon?: DesktopIcon } | null

export type ConfirmState = { kind: 'folder' | 'group' | 'container' | 'data-reset'; id: string; label: string } | null

export type DesktopGridEntry = {
  kind: DesktopEntryKind
  id: string
  name: string
  layout?: FolderGridLayout
  icon?: DesktopIcon
  item?: FolderItem
  container?: DesktopContainer
  itemCount?: number
}

export type ContextMenuState = { entry: DesktopGridEntry; x: number; y: number } | null
