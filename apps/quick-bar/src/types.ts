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

export type ResultPopupStatus = 'loading' | 'done' | 'error'

export type ResultPopupPayload = {
  title: string
  status: ResultPopupStatus
  text?: string | null
  errorText?: string | null
}

export type ShortcutStatus = {
  shortcut: string
  enabled: boolean
  error?: string | null
}

export type ToolbarDisplayMode = 'shortcut' | 'automatic'

export type ToolbarDisplayModeStatus = {
  mode: ToolbarDisplayMode
  error?: string | null
}

export type DirectClient = {
  request<T>(method: string, params?: unknown): Promise<T>
  close(): void
}

export type RegistryButton = {
  id: string
  app: Record<string, unknown>
  appId: string
  capabilityId: string
  title: string
  icon: string
  config: Record<string, unknown>
  enabled?: boolean
  createdAt: string
}

export const DEFAULT_LAUNCH_INFO: FwLaunchInfo = {
  launched: false,
  standalone: true,
  mode: 'standalone',
}
