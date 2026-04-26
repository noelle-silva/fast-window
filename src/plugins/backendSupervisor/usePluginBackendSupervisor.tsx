import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import BackgroundPluginHost from '../BackgroundPluginHost'
import type { PluginCapability, PluginManifest } from '../pluginContract'
import { resolveBackendLifecycle } from './backendLifecycle'

export type BackendSupervisorPlugin = {
  id: string
  disabled?: boolean
  manifest?: PluginManifest
  requires?: PluginCapability[]
  backgroundCode?: string
}

export type BackendSupervisorController = {
  startBackend: (pluginId: string, reason?: string) => void
  stopBackend: (pluginId: string, reason?: string) => void
  reconcileNow: () => void
  isRunning: (pluginId: string) => boolean
}

const DEFAULT_ON_DEMAND_IDLE_MS = 2 * 60 * 1000
const DEFAULT_SHORT_LIVED_GRACE_MS = 1500

function uniqStable(list: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const it of list) {
    if (seen.has(it)) continue
    seen.add(it)
    out.push(it)
  }
  return out
}

function isV3ProcessBackend(p: BackendSupervisorPlugin) {
  return Number(p.manifest?.apiVersion ?? 2) >= 3 && !!String(p.manifest?.background?.main || '').trim()
}

function isLegacyIframeBackend(p: BackendSupervisorPlugin) {
  return Number(p.manifest?.apiVersion ?? 2) < 3 && !!p.backgroundCode && !!p.manifest?.background
}

export function usePluginBackendSupervisor(params: {
  plugins: BackendSupervisorPlugin[]
  activePluginId?: string | null
  onDemandIdleMs?: number
  shortLivedGraceMs?: number
}) {
  const { plugins, activePluginId } = params
  const onDemandIdleMs = params.onDemandIdleMs ?? DEFAULT_ON_DEMAND_IDLE_MS
  const shortLivedGraceMs = params.shortLivedGraceMs ?? DEFAULT_SHORT_LIVED_GRACE_MS

  const [runningIds, setRunningIds] = useState<string[]>([])
  const runningSetRef = useRef<Set<string>>(new Set())
  const processRunningRef = useRef<Set<string>>(new Set())

  const forcedRunningRef = useRef<Set<string>>(new Set())
  const forcedStoppedRef = useRef<Set<string>>(new Set())
  const stopTimerRef = useRef<Map<string, number>>(new Map())

  const pluginsById = useMemo(() => {
    const m = new Map<string, BackendSupervisorPlugin>()
    for (const p of plugins) m.set(p.id, p)
    return m
  }, [plugins])

  const clearStopTimer = useCallback((pluginId: string) => {
    const t = stopTimerRef.current.get(pluginId)
    if (t) window.clearTimeout(t)
    stopTimerRef.current.delete(pluginId)
  }, [])

  const stopNow = useCallback(
    (pluginId: string, reason: string) => {
      clearStopTimer(pluginId)
      if (processRunningRef.current.has(pluginId)) {
        processRunningRef.current.delete(pluginId)
        void invoke('plugin_backend_stop', { pluginId }).catch(e => console.error(`[backend-supervisor] stop process backend failed "${pluginId}" (${reason})`, e))
      }
      setRunningIds(prev => {
        if (!prev.includes(pluginId)) return prev
        const next = prev.filter(id => id !== pluginId)
        runningSetRef.current = new Set(next)
        console.log(`[backend-supervisor] stop "${pluginId}" (${reason})`)
        return next
      })
    },
    [clearStopTimer],
  )

  const ensureRunning = useCallback((pluginId: string, reason: string) => {
    clearStopTimer(pluginId)
    const p = pluginsById.get(pluginId)
    if (p && isV3ProcessBackend(p)) {
      if (!processRunningRef.current.has(pluginId)) {
        processRunningRef.current.add(pluginId)
        void invoke('plugin_backend_start', {
          req: {
            pluginId,
            main: String(p.manifest?.background?.main || ''),
            runtime: p.manifest?.background?.runtime,
          },
        }).catch(e => {
          processRunningRef.current.delete(pluginId)
          console.error(`[backend-supervisor] start process backend failed "${pluginId}" (${reason})`, e)
        })
        console.log(`[backend-supervisor] start process backend "${pluginId}" (${reason})`)
      }
      return
    }
    setRunningIds(prev => {
      if (prev.includes(pluginId)) return prev
      const next = uniqStable(prev.concat(pluginId))
      runningSetRef.current = new Set(next)
      console.log(`[backend-supervisor] start "${pluginId}" (${reason})`)
      return next
    })
  }, [clearStopTimer, pluginsById])

  const scheduleStop = useCallback(
    (pluginId: string, delayMs: number, reason: string) => {
      clearStopTimer(pluginId)
      const t = window.setTimeout(() => stopNow(pluginId, reason), Math.max(0, delayMs))
      stopTimerRef.current.set(pluginId, t)
    },
    [clearStopTimer, stopNow],
  )

  const reconcileRef = useRef<() => void>(() => {})

  const reconcile = useCallback(() => {
    const activeId = String(activePluginId || '')
    const forcedRunning = forcedRunningRef.current
    const forcedStopped = forcedStoppedRef.current

    const knownIds = new Set<string>()
    for (const p of plugins) knownIds.add(p.id)

    // 先把“已经不存在的/被禁用/无后端代码”的运行实例关掉（快速失败，别留幽灵进程）
    for (const id of Array.from(runningSetRef.current)) {
      const p = pluginsById.get(id)
      const shouldKeep = !!p && !p.disabled && (isLegacyIframeBackend(p) || isV3ProcessBackend(p))
      if (!shouldKeep) stopNow(id, 'plugin-unavailable')
    }

    for (const id of Array.from(processRunningRef.current)) {
      const p = pluginsById.get(id)
      const shouldKeep = !!p && !p.disabled && isV3ProcessBackend(p)
      if (!shouldKeep) stopNow(id, 'plugin-unavailable')
    }

    for (const p of plugins) {
      if (!p || !p.id) continue
      if (p.disabled) {
        if (runningSetRef.current.has(p.id)) stopNow(p.id, 'disabled')
        continue
      }
      if (!isLegacyIframeBackend(p) && !isV3ProcessBackend(p)) continue

      const resolved = resolveBackendLifecycle(p.manifest)
      if (!resolved) continue

      if (forcedStopped.has(p.id)) {
        if (runningSetRef.current.has(p.id)) stopNow(p.id, 'forced-stopped')
        continue
      }

      const isForcedRunning = forcedRunning.has(p.id)
      const isActive = activeId && p.id === activeId

      if (resolved.lifecycle === 'resident') {
        ensureRunning(p.id, resolved.source === 'manifest' ? 'resident(manifest)' : 'resident(legacy)')
        continue
      }

      if (resolved.lifecycle === 'on_demand') {
        if (isForcedRunning || isActive) {
          ensureRunning(p.id, isForcedRunning ? 'forced-running' : 'active')
        } else if (runningSetRef.current.has(p.id) || processRunningRef.current.has(p.id)) {
          scheduleStop(p.id, onDemandIdleMs, 'on_demand-idle')
        }
        continue
      }

      // short_lived：更像“一次工作会话”，不追求长期保活；不需要时应尽快退出（由宿主统一托管）。
      if (resolved.lifecycle === 'short_lived') {
        if (isForcedRunning || isActive) {
          ensureRunning(p.id, isForcedRunning ? 'forced-running' : 'active')
        } else if (runningSetRef.current.has(p.id) || processRunningRef.current.has(p.id)) {
          scheduleStop(p.id, shortLivedGraceMs, 'short_lived-exit')
        }
        continue
      }
    }

    // 清理 timer：如果插件已经不在列表里，就别让 timer 误杀别人
    for (const [id, t] of Array.from(stopTimerRef.current.entries())) {
      if (knownIds.has(id)) continue
      window.clearTimeout(t)
      stopTimerRef.current.delete(id)
    }
  }, [
    activePluginId,
    ensureRunning,
    onDemandIdleMs,
    plugins,
    pluginsById,
    scheduleStop,
    shortLivedGraceMs,
    stopNow,
  ])

  reconcileRef.current = reconcile

  useEffect(() => {
    reconcile()
  }, [reconcile])

  useEffect(() => {
    return () => {
      for (const t of stopTimerRef.current.values()) window.clearTimeout(t)
      stopTimerRef.current.clear()
      for (const id of Array.from(processRunningRef.current)) {
        void invoke('plugin_backend_stop', { pluginId: id }).catch(() => {})
      }
      processRunningRef.current.clear()
    }
  }, [])

  const startBackend = useCallback((pluginId: string, reason?: string) => {
    forcedStoppedRef.current.delete(pluginId)
    forcedRunningRef.current.add(pluginId)
    console.log(`[backend-supervisor] start requested "${pluginId}" (${reason || 'manual'})`)
    reconcileRef.current()
  }, [])

  const stopBackend = useCallback((pluginId: string, reason?: string) => {
    forcedRunningRef.current.delete(pluginId)
    forcedStoppedRef.current.add(pluginId)
    console.log(`[backend-supervisor] stop requested "${pluginId}" (${reason || 'manual'})`)
    stopNow(pluginId, 'manual-stop')
  }, [stopNow])

  const reconcileNow = useCallback(() => {
    reconcileRef.current()
  }, [])

  const isRunning = useCallback((pluginId: string) => runningSetRef.current.has(pluginId) || processRunningRef.current.has(pluginId), [])

  const runningPlugins = useMemo(() => {
    const out: BackendSupervisorPlugin[] = []
    for (const id of runningIds) {
      const p = pluginsById.get(id)
      if (p && isLegacyIframeBackend(p)) out.push(p)
    }
    return out
  }, [pluginsById, runningIds])

  const backgroundHosts = useMemo(() => {
    return runningPlugins.map(p => (
      <BackgroundPluginHost
        key={`bg-${p.id}`}
        pluginId={p.id}
        pluginCode={p.backgroundCode || ''}
        apiVersion={p.manifest?.apiVersion ?? 2}
        requires={p.requires}
      />
    ))
  }, [runningPlugins])

  const controller: BackendSupervisorController = useMemo(
    () => ({ startBackend, stopBackend, reconcileNow, isRunning }),
    [isRunning, reconcileNow, startBackend, stopBackend],
  )

  return { backgroundHosts, controller }
}
