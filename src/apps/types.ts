export type AppDisplayMode = 'default' | 'window' | 'top'

export type AppActivationAction = 'toggle' | 'show' | 'hide' | 'close'

export type AppHotkeyLaunchBehavior = 'launch' | 'runningOnly'

export interface RegisteredAppShortcut {
  id: string
  title: string
  icon?: string
  hotkey?: string
}

export interface AppCapabilityDescriptor {
  id: string
  title: string
  icon?: string
  hotkey?: string
  description?: string
  configFields?: AppCapabilityConfigField[]
  config?: Record<string, unknown>
}

export interface AppCapabilityConfigField {
  id: string
  label: string
  optionSource: string
}

export interface AppCapabilityOption {
  value: string
  label: string
}

export interface InstalledAppInfo {
  id: string
  name: string
  version: string
  path: string
  icon: string
  displayMode: AppDisplayMode
  commands: RegisteredAppShortcut[]
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
  commands: RegisteredAppShortcut[]
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

export interface RegisteredAppCapabilitySelection {
  appId: string
  capabilityId: string
  title: string
  icon?: string
  description?: string
  configFields?: AppCapabilityConfigField[]
  config?: Record<string, unknown>
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
