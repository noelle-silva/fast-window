export const PLUGIN_ID = 'clipboard-history'

export const TASK_KIND_CLIPBOARD_WATCH = 'clipboard.watch'
export const TASK_QUERY_INTERVAL = 250
export const BG_TICK_INTERVAL = 600
export const CLIPBOARD_PAGE_SIZE = 40

export const DEFAULT_SETTINGS = {
  maxHistory: 50,
  autoMonitor: true,
  pollInterval: 1000,
  collapseLines: 6,
} as const
