import type { ClipboardHistorySettings, ClipboardHistoryThemeId } from './types'

export const APP_ID = 'clipboard-history'

export const CLIPBOARD_PAGE_SIZE = 40

export const CLIPBOARD_HISTORY_THEME_IDS: ClipboardHistoryThemeId[] = [
  'calm-blue',
  'catppuccin-latte',
  'rose-pine-dawn',
  'nord-night',
  'catppuccin-mocha',
]

export const DEFAULT_THEME_ID: ClipboardHistoryThemeId = 'calm-blue'

export const DEFAULT_SETTINGS: ClipboardHistorySettings = {
  maxHistory: 50,
  autoMonitor: true,
  pollInterval: 1000,
  collapseLines: 6,
  theme: DEFAULT_THEME_ID,
}
