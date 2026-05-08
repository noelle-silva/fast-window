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

export type FolderGroup = { id: string; name: string }

export type FolderGridLayout = { x: number; y: number }

export type FolderItem = {
  id: string
  name: string
  path: string
  groupId: string
  createdAt: string
  updatedAt: string
  createdAtMs: number
  updatedAtMs: number
  layout?: FolderGridLayout
}

export type FoldersDoc = {
  schemaVersion: number
  dataVersion: number
  groups: FolderGroup[]
  items: FolderItem[]
  updatedAt: string
}

export type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export type DirectClient = {
  request<T>(method: string, params?: unknown): Promise<T>
  close(): void
}

export type Phase = 'starting' | 'ready' | 'failed'

export type FolderFormState = {
  name: string
  path: string
  groupId: string
  newGroupName: string
}

export type GroupFormState = { id: string; name: string }

export type ConfirmState = { kind: 'folder' | 'group'; id: string; label: string } | null

export type ContextMenuState = { item: FolderItem; x: number; y: number } | null
