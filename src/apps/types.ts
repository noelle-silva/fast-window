export type AppDisplayMode = 'default' | 'window' | 'top'

export type AppActivationAction = 'toggle' | 'show' | 'hide' | 'close'

export interface RegisteredAppCommand {
  id: string
  title: string
  hotkey?: string
}

export interface RegisteredApp {
  id: string
  name: string
  icon: string
  path: string
  hotkey?: string
  displayMode: AppDisplayMode
  commands: RegisteredAppCommand[]
  autoStart: boolean
  windowWidth?: number
  windowHeight?: number
  windowX?: number
  windowY?: number
}

export type AppStatus = {
  running: boolean
  pid?: number
  startedAt?: number
  exitCode?: number
}
