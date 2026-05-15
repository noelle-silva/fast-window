export type AppDisplayMode = 'default' | 'window' | 'top'

export type AppActivationAction = 'toggle' | 'show' | 'hide' | 'close'

export type AppHotkeyLaunchBehavior = 'launch' | 'runningOnly'

export interface RegisteredAppCommand {
  id: string
  title: string
  hotkey?: string
}

export interface InstalledAppInfo {
  id: string
  name: string
  version: string
  path: string
  icon: string
  displayMode: AppDisplayMode
  commands: RegisteredAppCommand[]
}

export interface RegisteredApp {
  id: string
  name: string
  icon: string
  path: string
  version?: string
  hotkey?: string
  hotkeyLaunchBehavior?: AppHotkeyLaunchBehavior
  displayMode: AppDisplayMode
  commands: RegisteredAppCommand[]
  availableCommands?: RegisteredAppCommand[]
  autoStart: boolean
  windowWidth?: number
  windowHeight?: number
  windowX?: number
  windowY?: number
}

export interface AppRegistrationEditRequest {
  appId: string
  requestId: number
}

export type RegisteredAppUpdatePatch = Partial<Omit<RegisteredApp, 'id' | 'hotkey' | 'hotkeyLaunchBehavior'>> & {
  hotkey?: string | null
  hotkeyLaunchBehavior?: AppHotkeyLaunchBehavior | null
}

export type AppStatus = {
  running: boolean
  pid?: number
  startedAt?: number
  exitCode?: number
}

export type AppStopMethod = 'graceful' | 'killed' | 'alreadyStopped'

export type AppStopResult = {
  stopped: boolean
  method: AppStopMethod
}
