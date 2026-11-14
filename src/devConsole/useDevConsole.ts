import { useCallback, useEffect, useRef, useState } from 'react'
import { getAppStatuses } from '../apps/appLauncher'
import type { AppStatus, RegisteredApp } from '../apps/types'
import {
  loadAppCatalog,
  loadDevConsoleServerStatus,
  normalizeHostActionError,
  runHostCommand,
} from './devConsoleApi'
import type {
  DevConsoleServerStatus,
  HostActionError,
  HostActionResponse,
} from './devConsoleApi'

export type DevConsoleExecution = {
  id: number
  at: number
  command: string
  phase: 'running' | 'done' | 'failed'
  response?: HostActionResponse
  error?: HostActionError
}

/// Dev 控制台的运行状态。
///
/// 只维护三份事实：应用清单（含运行态）、脚本入口状态、执行流水。
/// 每一次执行结束都重新拉取前两份，保证窗口显示的状态跟随宿主真实运行态。
export function useDevConsole() {
  const [apps, setApps] = useState<RegisteredApp[]>([])
  const [statuses, setStatuses] = useState<Record<string, AppStatus>>({})
  const [serverStatus, setServerStatus] = useState<DevConsoleServerStatus | null>(null)
  const [executions, setExecutions] = useState<DevConsoleExecution[]>([])
  const nextExecutionId = useRef(1)

  const refresh = useCallback(async () => {
    const [catalog, server] = await Promise.all([
      loadAppCatalog().catch(() => [] as RegisteredApp[]),
      loadDevConsoleServerStatus().catch(() => null),
    ])

    setApps(catalog)
    setServerStatus(server)

    if (catalog.length === 0) {
      setStatuses({})
      return
    }

    const nextStatuses = await getAppStatuses(catalog.map(app => app.id))
      .catch<Record<string, AppStatus>>(() => ({}))
    setStatuses(nextStatuses)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = useCallback(async (command: string) => {
    const trimmed = command.trim()
    if (!trimmed) return

    const id = nextExecutionId.current++
    setExecutions(previous => [
      { id, at: Date.now(), command: trimmed, phase: 'running' },
      ...previous,
    ])

    try {
      const response = await runHostCommand(trimmed)
      setExecutions(previous => previous.map(entry => (
        entry.id === id ? { ...entry, phase: 'done', response } : entry
      )))
    } catch (error) {
      const normalized = normalizeHostActionError(error)
      setExecutions(previous => previous.map(entry => (
        entry.id === id ? { ...entry, phase: 'failed', error: normalized } : entry
      )))
    } finally {
      void refresh()
    }
  }, [refresh])

  return { apps, statuses, serverStatus, executions, run, refresh }
}
