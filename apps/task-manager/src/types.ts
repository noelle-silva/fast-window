export type TaskItem = {
  id: string
  title: string
  description: string
  createdAt: string
  updatedAt: string
}

export type TaskBoard = {
  id: string
  title: string
  description: string
  tasks: TaskItem[]
  createdAt: string
  updatedAt: string
}

export type TaskDraft = {
  title: string
  description: string
}

export type FwLaunchInfo = {
  launched: boolean
  standalone: boolean
  mode: string
}

export type DataDirStatus = {
  dataDir: string
  defaultDataDir: string
  configuredDataDir?: string | null
  writable: boolean
  error?: string | null
}

export type DirectClient = {
  request<T>(method: string, params?: unknown): Promise<T>
  close(): void
}

export const DEFAULT_LAUNCH_INFO: FwLaunchInfo = {
  launched: false,
  standalone: true,
  mode: 'standalone',
}
