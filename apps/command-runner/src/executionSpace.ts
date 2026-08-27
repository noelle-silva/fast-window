import * as React from 'react'
import type { AppSettings, CommandItem, DirectClient, RunEvent, RunInfo } from './types'
import { resolveCloseMode, resolveCountdownSeconds } from './shellResolve'

export type SpaceEntryStatus = 'running' | 'ended'

export type SpaceEntry = {
  runId: string
  commandId: string
  repoId: string
  commandName: string
  startedAt: string
  status: SpaceEntryStatus
  exitCode: number | null
  lines: Array<{ text: string; stream: 'stdout' | 'stderr' }>
  countdownEndsAt: number | null
  collapsed: boolean
}

type ExecutionSpace = {
  entries: SpaceEntry[]
  runningCountFor: (repoId: string) => number
  stopRun: (runId: string) => Promise<void>
  removeEntry: (runId: string) => void
  toggleCollapse: (runId: string) => void
}

const MAX_LINES_PER_ENTRY = 2000

export function useExecutionSpace(client: DirectClient | null, commands: CommandItem[], settings: AppSettings | null): ExecutionSpace {
  const [entries, setEntries] = React.useState<SpaceEntry[]>([])
  const entriesRef = React.useRef<SpaceEntry[]>([])
  const commandsRef = React.useRef<CommandItem[]>(commands)
  const settingsRef = React.useRef<AppSettings | null>(settings)

  React.useEffect(() => {
    entriesRef.current = entries
  }, [entries])

  React.useEffect(() => {
    commandsRef.current = commands
  }, [commands])

  React.useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  const patchEntry = React.useCallback((runId: string, patch: (entry: SpaceEntry) => SpaceEntry) => {
    setEntries(current => {
      const index = current.findIndex(entry => entry.runId === runId)
      if (index < 0) return current
      const next = [...current]
      next[index] = patch(current[index])
      return next
    })
  }, [])

  const handleEvent = React.useCallback((event: RunEvent) => {
    switch (event.name) {
      case 'run.started': {
        const runId = event.runId
        const commandId = event.commandId
        if (!runId || !commandId) return
        setEntries(current => {
          if (current.some(entry => entry.runId === runId)) return current
          return [...current, {
            runId,
            commandId,
            repoId: event.repoId || '',
            commandName: event.commandName || '',
            startedAt: event.startedAt || '',
            status: 'running',
            exitCode: null,
            lines: [],
            countdownEndsAt: null,
            collapsed: false,
          }]
        })
        return
      }
      case 'run.output': {
        if (!event.runId || event.text === undefined) return
        patchEntry(event.runId, entry => ({
          ...entry,
          lines: [...entry.lines, { text: event.text ?? '', stream: event.stream || 'stdout' }].slice(-MAX_LINES_PER_ENTRY),
        }))
        return
      }
      case 'run.ended': {
        if (!event.runId) return
        const endedEntry = entriesRef.current.find(entry => entry.runId === event.runId)
        const command = commandsRef.current.find(item => item.id === endedEntry?.commandId)
        const closeMode = resolveCloseMode(command || { closeMode: '', countdownSeconds: 0 } as CommandItem, settingsRef.current)
        const countdownSeconds = resolveCountdownSeconds(command || { countdownSeconds: 0 } as CommandItem, settingsRef.current)

        patchEntry(event.runId, entry => ({
          ...entry,
          status: 'ended',
          exitCode: event.exitCode ?? 0,
          countdownEndsAt: closeMode === 'countdown' ? Date.now() + countdownSeconds * 1000 : null,
        }))

        if (closeMode === 'close-immediately') {
          const runId = event.runId
          setEntries(current => current.filter(entry => entry.runId !== runId))
        }
        return
      }
      default:
        return
    }
  }, [patchEntry])

  React.useEffect(() => {
    if (!client) return
    const unsubscribe = client.onEvent(handleEvent)
    return unsubscribe
  }, [client, handleEvent])

  // 连接就绪后同步一次运行快照，恢复断线期间的运行卡片（历史输出从零重新接收）。
  React.useEffect(() => {
    if (!client) return
    let cancelled = false
    void client.request<{ runs: RunInfo[] }>('commandRunner.runs.list').then(snapshot => {
      if (cancelled) return
      setEntries(current => {
        const known = new Set(current.map(entry => entry.runId))
        const restored = snapshot.runs
          .filter(run => !known.has(run.runId))
          .map<SpaceEntry>(run => ({
            runId: run.runId,
            commandId: run.commandId,
            repoId: run.repoId,
            commandName: run.commandName,
            startedAt: run.startedAt,
            status: 'running',
            exitCode: null,
            lines: [],
            countdownEndsAt: null,
            collapsed: false,
          }))
        return restored.length > 0 ? [...current, ...restored] : current
      })
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [client])

  // 倒计时结束的卡片自动移除。
  React.useEffect(() => {
    const timer = window.setInterval(() => {
      setEntries(current => {
        const now = Date.now()
        const expired = current.some(entry => entry.countdownEndsAt !== null && entry.countdownEndsAt <= now)
        if (!expired) return current
        return current.filter(entry => entry.countdownEndsAt === null || entry.countdownEndsAt > now)
      })
    }, 500)
    return () => window.clearInterval(timer)
  }, [])

  const runningCountFor = React.useCallback((repoId: string) =>
    entries.filter(entry => entry.repoId === repoId && entry.status === 'running').length,
  [entries])

  const stopRun = React.useCallback(async (runId: string) => {
    if (!client) return
    await client.request('commandRunner.runs.stop', { runId })
  }, [client])

  const removeEntry = React.useCallback((runId: string) => {
    setEntries(current => {
      const target = current.find(entry => entry.runId === runId)
      if (target?.status === 'running') {
        void stopRun(runId).catch(() => {})
      }
      return current.filter(entry => entry.runId !== runId)
    })
  }, [stopRun])

  const toggleCollapse = React.useCallback((runId: string) => {
    patchEntry(runId, entry => ({ ...entry, collapsed: !entry.collapsed }))
  }, [patchEntry])

  return { entries, runningCountFor, stopRun, removeEntry, toggleCollapse }
}
