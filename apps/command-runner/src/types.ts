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

export type CustomShell = {
  id: string
  name: string
  exePath: string
  argsTemplate: string
}

export type ShellInfo = {
  id: string
  name: string
  builtin: boolean
  available: boolean
  exePath: string
  argsTemplate?: string
}

export type Repo = {
  id: string
  name: string
  path: string
  shellId: string
  createdAt: string
}

export type CloseMode = 'keep-open' | 'countdown' | 'close-immediately'

export type CommandItem = {
  id: string
  repoId: string
  name: string
  script: string
  note: string
  confirmBeforeRun: boolean
  shellId: string
  closeMode: string
  countdownSeconds: number
  createdAt: string
  updatedAt: string
}

export type CommandDraft = {
  repoId: string
  name: string
  script: string
  note: string
  confirmBeforeRun: boolean
  shellId: string
  closeMode: string
  countdownSeconds: number
}

export type AppSettings = {
  schemaVersion: number
  dataVersion: number
  defaultShellId: string
  defaultCloseMode: string
  defaultCountdownSeconds: number
  customShells: CustomShell[]
  updatedAt: string
}
