import type { ClipboardHistorySettings, ClipboardMonitorSnapshot } from '../shared/types'
import { readTextClipboard } from './textClipboard'

export type ClipboardMonitor = {
  start(): void
  stop(): void
  restart(settings: ClipboardHistorySettings): void
  snapshot(): ClipboardMonitorSnapshot
}

export function createClipboardMonitor(options: {
  settings: ClipboardHistorySettings
  onChange(item: { type: 'text'; content: string; time: number }): Promise<void>
  log?(message: string, extra?: unknown): void
}): ClipboardMonitor {
  let settings = options.settings
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let stopped = true
  let latestText = ''
  let latest = null as ClipboardMonitorSnapshot['latest']

  async function tick() {
    if (stopped || running) return
    running = true
    try {
      const text = await readTextClipboard()
      if (text && text !== latestText) {
        latestText = text
        latest = { type: 'text', content: text, time: Date.now() }
        await options.onChange(latest)
      }
    } catch (error: any) {
      options.log?.('monitor tick failed', String(error?.message || error))
    } finally {
      running = false
      if (!stopped) timer = setTimeout(tick, Math.max(200, settings.pollInterval))
    }
  }

  function start() {
    if (!stopped) return
    stopped = false
    timer = setTimeout(tick, 0)
  }

  function stop() {
    stopped = true
    if (timer) clearTimeout(timer)
    timer = null
  }

  return {
    start,
    stop,
    restart(nextSettings) {
      settings = nextSettings
      stop()
      if (settings.autoMonitor) start()
    },
    snapshot() {
      return { latest, items: latest ? [latest] : [] }
    },
  }
}
