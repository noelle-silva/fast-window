import { BG_TICK_INTERVAL, DEFAULT_SETTINGS, TASK_KIND_CLIPBOARD_WATCH } from '../shared/constants'
import {
  isDeleted,
  isSameHistory,
  mergeHistoryItems,
  normalizeDeletedMap,
  normalizeHistoryItems,
  normalizeHostSnapshotItems,
  normalizeSettings,
} from '../shared/historyDomain'
import type { ClipboardHistoryGateway } from '../gateway/types'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function startLegacyBackground(gateway: ClipboardHistoryGateway): void {
  const bgState = {
    monitorTaskId: '',
    settings: { ...DEFAULT_SETTINGS },
    history: [] as any[],
    deleted: {} as Record<string, number>,
    ticking: false,
  }

  function bgIsDeleted(item: any): boolean {
    return isDeleted(item, bgState.deleted)
  }

  function bgNormalizeHistoryItems(raw: unknown, limit = bgState.settings.maxHistory) {
    return normalizeHistoryItems(raw, limit)
  }

  function bgMergeHistoryItems(primary: unknown, secondary: unknown, limit = bgState.settings.maxHistory) {
    return mergeHistoryItems(primary, secondary, limit)
  }

  function bgNormalizeHostSnapshotItems(result: unknown) {
    return normalizeHostSnapshotItems(result, bgState.settings.maxHistory)
  }

  async function bgSaveHistoryIfChanged(next: any[]) {
    if (isSameHistory(bgState.history, next)) return
    bgState.history = next
    await gateway.storage.saveHistory(bgState.history).catch(() => {})
  }

  async function bgLoadState() {
    const [savedHistory, savedSettings, savedDeleted] = await Promise.all([
      gateway.storage.loadHistory().catch(() => null),
      gateway.storage.loadSettings().catch(() => null),
      gateway.storage.loadDeletedHistory().catch(() => null),
    ])

    // 只在读到对象时才采用，避免失败读导致默认值误覆盖用户数据。
    const settingsOk = isPlainObject(savedSettings)
    if (settingsOk) bgState.settings = normalizeSettings(savedSettings)

    const deletedOk = isPlainObject(savedDeleted)
    if (deletedOk) bgState.deleted = normalizeDeletedMap(savedDeleted)

    const limit = settingsOk ? bgState.settings.maxHistory : 1000
    bgState.history = bgNormalizeHistoryItems(savedHistory, limit).filter((it) => !bgIsDeleted(it))

    if (Array.isArray(savedHistory)) await gateway.storage.saveHistory(bgState.history).catch(() => {})
    if (settingsOk) await gateway.storage.saveSettings(bgState.settings).catch(() => {})
    if (deletedOk) await gateway.storage.saveDeletedHistory(bgState.deleted).catch(() => {})
  }

  function bgPickRunningMonitorTask(tasks: unknown) {
    if (!Array.isArray(tasks)) return null
    return (
      tasks.find((t: any) => {
        const status = String(t && t.status ? t.status : '')
        const kind = String(t && t.kind ? t.kind : '')
        return (status === 'queued' || status === 'running') && kind === TASK_KIND_CLIPBOARD_WATCH
      }) || null
    )
  }

  async function bgEnsureMonitorTaskRunning() {
    if (!bgState.settings.autoMonitor) {
      if (bgState.monitorTaskId) {
        await gateway.monitor.cancelTask(bgState.monitorTaskId).catch(() => {})
      }
      bgState.monitorTaskId = ''
      return
    }

    if (bgState.monitorTaskId) return

    const recentTasks = await gateway.monitor.listRecentTasks(40).catch(() => [])
    const runningTask = bgPickRunningMonitorTask(recentTasks)
    if (runningTask && runningTask.id) {
      bgState.monitorTaskId = String(runningTask.id)
      return
    }

    const task = await gateway.monitor
      .startClipboardWatch({
        intervalMs: bgState.settings.pollInterval,
        maxHistory: bgState.settings.maxHistory,
      })
      .catch(() => null)
    const tid = String(task && task.id ? task.id : '').trim()
    if (tid) bgState.monitorTaskId = tid
  }

  async function bgPollMonitorTask() {
    const tid = String(bgState.monitorTaskId || '').trim()
    if (!tid) return

    const task = await gateway.monitor.getTask(tid).catch(() => null)
    if (!task) {
      bgState.monitorTaskId = ''
      return
    }

    const status = String(task.status || '')
    if (status === 'queued' || status === 'running' || status === 'succeeded') {
      const result = task && task.result && typeof task.result === 'object' ? task.result : {}
      const snapshotItems = bgNormalizeHostSnapshotItems(result).filter((it) => !bgIsDeleted(it))
      const base = (Array.isArray(bgState.history) ? bgState.history : []).filter((it) => !bgIsDeleted(it))
      const merged = bgMergeHistoryItems(base, snapshotItems, bgState.settings.maxHistory)
      await bgSaveHistoryIfChanged(merged)
    }

    if (status === 'succeeded' || status === 'failed' || status === 'canceled') {
      bgState.monitorTaskId = ''
    }
  }

  async function bgTick() {
    if (bgState.ticking) return
    bgState.ticking = true
    try {
      const savedSettings = await gateway.storage.loadSettings().catch(() => null)
      if (isPlainObject(savedSettings)) {
        const nextSettings = normalizeSettings(savedSettings)
        const settingsChanged = JSON.stringify(nextSettings) !== JSON.stringify(bgState.settings)
        if (settingsChanged) {
          bgState.settings = nextSettings
          const normalized = bgNormalizeHistoryItems(bgState.history, bgState.settings.maxHistory)
          await bgSaveHistoryIfChanged(normalized)
          bgState.monitorTaskId = ''
        }
      }

      const savedDeleted = await gateway.storage.loadDeletedHistory().catch(() => null)
      if (isPlainObject(savedDeleted)) bgState.deleted = normalizeDeletedMap(savedDeleted)
      const filtered = (Array.isArray(bgState.history) ? bgState.history : []).filter((it) => !bgIsDeleted(it))
      await bgSaveHistoryIfChanged(filtered)

      await bgEnsureMonitorTaskRunning()
      await bgPollMonitorTask()
    } finally {
      bgState.ticking = false
    }
  }

  void bgLoadState().finally(() => {
    void bgTick()
    setInterval(() => {
      void bgTick()
    }, BG_TICK_INTERVAL)
  })
}
