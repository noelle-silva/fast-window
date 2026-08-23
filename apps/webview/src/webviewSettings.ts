export type WebviewVideoSpeedPreset = {
  label: string
  rate: number
  shortcut?: string | null
}

export type WebviewSettings = {
  video: {
    defaultRate: number
    maxRate: number
    presets: WebviewVideoSpeedPreset[]
  }
}

export const WEBVIEW_SETTINGS_UPDATED_EVENT = 'webview:settings-updated'

export const MAX_VIDEO_RATE = 16
