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

export type ToolbarPayload = {
  selectedText: string
  anchorX: number
  anchorY: number
}

export type ShortcutStatus = {
  shortcut: string
  enabled: boolean
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
