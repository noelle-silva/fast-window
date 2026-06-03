export type FwLaunchInfo = {
  launched: boolean
  standalone: boolean
  mode: string
}

export type DataDirStatus = {
  dataDir: string
  defaultDataDir: string
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

export type VendorStatus = {
  ready: boolean
  runtimeVersion: string
  cliVersion: string
  runtimePath: string
  cliPath: string
  licensePath: string
  error?: string
}

export type SetupMode = 'global'

export type EverythingChannel = 'dev' | 'release'

export type RuntimeStatus = {
  ready: boolean
  instanceName: string
  mode: SetupMode
  version?: string
  configPath: string
  databasePath: string
  error?: string
}

export type SetupState = {
  schemaVersion: number
  mode: SetupMode
  instanceName: string
  serviceName: string
  runtimeVersion: string
  runtimeSha256: string
  enabledAt?: string
  updatedAt: string
}

export type SetupInfo = {
  configured: boolean
  state: SetupState
  availableModes: SetupMode[]
  requiresConsent: SetupMode[]
}

export type HealthInfo = {
  ok: boolean
  channel: EverythingChannel
  dataDir: string
  packageDir: string
  time: string
  vendor: VendorStatus
  setup: SetupState
  runtime: RuntimeStatus
  errors: string[]
}

export type SearchResult = {
  name: string
  path: string
  fullPath: string
  kind: 'file' | 'folder' | 'unknown'
  size: string
  modifiedAt: string
}

export type SearchResponse = {
  query: string
  limit: number
  scopePath: string
  results: SearchResult[]
}

export const SEARCH_LAYOUTS = ['list', 'compact', 'detail', 'grid'] as const

export type SearchLayout = typeof SEARCH_LAYOUTS[number]

export type AppPhase = 'starting' | 'ready' | 'failed'

export type AppView = 'search' | 'settings'

export const DEFAULT_LAUNCH_INFO: FwLaunchInfo = {
  launched: false,
  standalone: true,
  mode: 'standalone',
}

export const DEFAULT_SEARCH_LIMIT = 120

export const DEFAULT_SEARCH_LAYOUT: SearchLayout = SEARCH_LAYOUTS[0]
