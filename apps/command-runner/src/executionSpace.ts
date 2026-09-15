import * as React from 'react'
import type { AppSettings, CommandItem, DirectClient, RunEvent, RunInfo } from './types'
import { resolveCloseMode, resolveCountdownSeconds } from './shellResolve'

export type SpaceEntryStatus = 'running' | 'ended'

export type SpaceEntryCounts = {
  running: number
  ended: number
}

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
}

type ExecutionSpace = {
  entries: SpaceEntry[]
  countsForRepo: (repoId: string) => SpaceEntryCounts
  countsForCommand: (commandId: string) => SpaceEntryCounts
  stopRun: (runId: string) => Promise<void>
  removeEntry: (runId: string) => void
  entryIndex: (runId: string) => number
  handOffEntry: (oldRunId: string, newRunId: string | undefined, anchorIndex: number) => void
  moveEntry: (activeRunId: string, overRunId: string) => void
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

  const countEntries = React.useCallback((match: (entry: SpaceEntry) => boolean): SpaceEntryCounts => {
    let running = 0
    let ended = 0
    for (const entry of entries) {
      if (!match(entry)) continue
      if (entry.status === 'running') running += 1
      else ended += 1
    }
    return { running, ended }
  }, [entries])

  const countsForRepo = React.useCallback((repoId: string) =>
    countEntries(entry => entry.repoId === repoId),
  [countEntries])

  const countsForCommand = React.useCallback((commandId: string) =>
    countEntries(entry => entry.commandId === commandId),
  [countEntries])

  const stopRun = React.useCallback(async (runId: string) => {
    if (!client) return
    await client.request('commandRunner.runs.stop', { runId })
  }, [client])

  // removeEntry 仅清理已结束的实例；运行中的停止统一由 stopRun（停止按钮）负责。
  const removeEntry = React.useCallback((runId: string) => {
    setEntries(current => current.filter(entry => entry.runId !== runId))
  }, [])

  // entryIndex 返回实例当前的显示位置（不存在时为 -1）；重启发起时用它留存旧实例的位置。
  const entryIndex = React.useCallback((runId: string) =>
    entriesRef.current.findIndex(entry => entry.runId === runId),
  [])

  // handOffEntry 交接重启实例的显示位置：新实例接管发起重启时留存的位置，旧实例退场。
  // 旧卡片若因「立即关闭」等规则提前消失，位置仍由 anchorIndex 保住；
  // 重启未产生新实例（例如重启时命令已切到独立窗口模式）时，仅让旧实例退场。
  const handOffEntry = React.useCallback((oldRunId: string, newRunId: string | undefined, anchorIndex: number) => {
    setEntries(current => {
      const next = current.filter(entry => entry.runId !== oldRunId)
      if (newRunId === undefined || anchorIndex < 0) return next
      const newIndex = next.findIndex(entry => entry.runId === newRunId)
      if (newIndex < 0) return next
      const [adopted] = next.splice(newIndex, 1)
      next.splice(Math.min(anchorIndex, next.length), 0, adopted)
      return next
    })
  }, [])

  // moveEntry 调整运行实例在侧边栏中的显示顺序（entries 数组顺序即显示顺序）。
  const moveEntry = React.useCallback((activeRunId: string, overRunId: string) => {
    setEntries(current => {
      const fromIndex = current.findIndex(entry => entry.runId === activeRunId)
      const toIndex = current.findIndex(entry => entry.runId === overRunId)
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return current
      const next = [...current]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }, [])

  return { entries, countsForRepo, countsForCommand, stopRun, removeEntry, entryIndex, handOffEntry, moveEntry }
}
