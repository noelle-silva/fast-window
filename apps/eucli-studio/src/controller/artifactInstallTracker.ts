import type { ArtifactInstallState } from '../domain/release'
import { isArtifactBusy } from '../domain/release'

// ArtifactInstallStateMap 是每个发布物一条安装状态的索引；key 为发布物 ID。
export type ArtifactInstallStateMap = Record<string, ArtifactInstallState>

export type ArtifactInstallTrackerDeps = {
  loadState: (id: string) => Promise<ArtifactInstallState | null>
  cancel: (id: string) => Promise<ArtifactInstallState | null>
  loadOperations: () => Promise<ArtifactInstallState[]>
  getStates: () => ArtifactInstallStateMap
  setStates: (states: ArtifactInstallStateMap) => void
  onTerminal: (id: string, state: ArtifactInstallState) => void
  onError?: (message: string) => void
}

const POLL_INTERVAL_MS = 1000

// createArtifactInstallTracker 是工具与插件共用的安装任务跟踪机制：
// 批量查询恢复任务事实，运行中任务按固定节奏对账，终态触发收尾回调。
// 它不持有业务状态，只把事实写回调用方提供的状态索引。
export function createArtifactInstallTracker(deps: ArtifactInstallTrackerDeps) {
  const tracked = new Set<string>()
  let timer: ReturnType<typeof setInterval> | null = null
  let disposed = false

  function applyOne(id: string, state: ArtifactInstallState) {
    const current = deps.getStates()
    deps.setStates({ ...current, [id]: state })
  }

  function isTrackedRunning(id: string) {
    return tracked.has(id)
  }

  function stopTimerIfIdle() {
    if (tracked.size) return
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function ensureTimer() {
    if (disposed || timer || !tracked.size) return
    timer = setInterval(() => {
      void refreshTracked()
    }, POLL_INTERVAL_MS)
  }

  // refreshOne 对账单条任务：仍忙碌则保持跟踪，进入终态则触发收尾。
  async function refreshOne(id: string): Promise<void> {
    if (disposed || !tracked.has(id)) return
    const state = await deps.loadState(id).catch(() => null)
    if (disposed || !state || !tracked.has(id)) return
    applyOne(id, state)
    if (isArtifactBusy(state)) return
    tracked.delete(id)
    stopTimerIfIdle()
    deps.onTerminal(id, state)
  }

  async function refreshTracked(): Promise<void> {
    const ids = Array.from(tracked)
    await Promise.all(ids.map((id) => refreshOne(id)))
  }

  // track 登记一个刚发起的任务，并立即对账一次。
  function track(id: string) {
    const normalized = String(id || '').trim()
    if (!normalized || disposed) return
    tracked.add(normalized)
    ensureTimer()
    void refreshOne(normalized)
  }

  // sync 用批量事实恢复全部任务：运行中的进入跟踪，终态写入状态索引。
  async function sync(): Promise<void> {
    if (disposed) return
    const operations = await deps.loadOperations().catch(() => null)
    if (disposed || !operations) return
    const next = { ...deps.getStates() }
    for (const state of operations) {
      const id = String(state?.artifact?.id || '').trim()
      if (!id) continue
      next[id] = state
      if (isArtifactBusy(state)) tracked.add(id)
      else tracked.delete(id)
    }
    deps.setStates(next)
    ensureTimer()
    stopTimerIfIdle()
  }

  // cancel 请求业务端取消任务；返回的终态直接写回并触发收尾。
  async function cancel(id: string): Promise<ArtifactInstallState | null> {
    const normalized = String(id || '').trim()
    if (!normalized || disposed) return null
    const state = await deps.cancel(normalized).catch((error: any) => {
      deps.onError?.(String(error?.message || error || '取消安装失败'))
      return null
    })
    if (disposed || !state) return null
    applyOne(normalized, state)
    if (isArtifactBusy(state)) {
      tracked.add(normalized)
      ensureTimer()
      return state
    }
    tracked.delete(normalized)
    stopTimerIfIdle()
    deps.onTerminal(normalized, state)
    return state
  }

  function dispose() {
    disposed = true
    tracked.clear()
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  return { track, sync, cancel, dispose, isTrackedRunning }
}
