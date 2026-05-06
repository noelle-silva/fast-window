import type { ClipboardHistorySettings } from './types'

export const APP_ID = 'clipboard-history'

export const CLIPBOARD_PAGE_SIZE = 40

export const DEFAULT_SETTINGS: ClipboardHistorySettings = {
  maxHistory: 50,
  autoMonitor: true,
  pollInterval: 1000,
  collapseLines: 6,
}
