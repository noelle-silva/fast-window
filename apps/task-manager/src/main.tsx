import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Alert, Box, Button, CircularProgress, CssBaseline, ThemeProvider, Typography } from '@mui/material'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { CreateDialog } from './components/CreateDialog'
import { TaskBoardCard } from './components/TaskBoardCard'
import { TaskBoardPage } from './components/TaskBoardPage'
import { TaskDetailDialog } from './components/TaskDetailDialog'
import { TaskTopbar } from './components/TaskTopbar'
import { createDirectClient } from './directClient'
import { useTaskBoards } from './taskBackend'
import { taskTheme } from './theme'
import type { DataDirStatus, DirectClient, FwLaunchInfo, TaskBoard, TaskDraft, TaskItem } from './types'
import { DEFAULT_LAUNCH_INFO } from './types'
import './styles.css'

const appWindow = getCurrentWindow()

function errorMessage(error: unknown, fallback: string): string {
  return String((error as { message?: string })?.message || error || fallback)
}

function App() {
  const [launchInfo, setLaunchInfo] = React.useState<FwLaunchInfo>(DEFAULT_LAUNCH_INFO)
  const [client, setClient] = React.useState<DirectClient | null>(null)
  const [phase, setPhase] = React.useState<'starting' | 'ready' | 'failed'>('starting')
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState<DataDirStatus | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [activeBoardId, setActiveBoardId] = React.useState<string | null>(null)
  const [createMode, setCreateMode] = React.useState<'board' | 'task' | null>(null)
  const [selectedTask, setSelectedTask] = React.useState<{ boardId: string; taskId: string } | null>(null)
  const { boards, loading: boardsLoading, error: boardsError, addBoard, addTask, updateTask } = useTaskBoards(client)
  const readyRef = React.useRef(false)
  const clientRef = React.useRef<DirectClient | null>(null)
  const connectIdRef = React.useRef(0)
  const activeBoardIdRef = React.useRef<string | null>(null)
  const boardsRef = React.useRef<TaskBoard[]>([])
  const backendReady = phase === 'ready' && Boolean(client)
  const controlsDisabled = !backendReady || busy || boardsLoading
  const visibleError = error || boardsError || status?.error || null

  const activeBoard = boards.find(board => board.id === activeBoardId) || null
  const selectedTaskBoard = selectedTask ? boards.find(board => board.id === selectedTask.boardId) || null : null
  const selectedTaskItem = selectedTask && selectedTaskBoard
    ? selectedTaskBoard.tasks.find(task => task.id === selectedTask.taskId) || null
    : null

  const markAppReady = React.useCallback(() => {
    if (readyRef.current) return
    readyRef.current = true
    void invoke('app_ready').catch(() => {})
  }, [])

  const refreshStatus = React.useCallback(async () => {
    const next = await invoke<DataDirStatus>('data_dir_status').catch(() => null)
    setStatus(next)
    return next
  }, [])

  const closeActiveClient = React.useCallback(() => {
    clientRef.current?.close()
    clientRef.current = null
    setClient(null)
  }, [])

  const installClient = React.useCallback((nextClient: DirectClient) => {
    clientRef.current?.close()
    clientRef.current = nextClient
    setClient(nextClient)
  }, [])

  const connect = React.useCallback(async (options?: { restartBackend?: boolean }) => {
    const connectId = ++connectIdRef.current
    let nextClient: DirectClient | null = null
    setBusy(true)
    setError(null)
    setPhase('starting')
    closeActiveClient()
    try {
      if (options?.restartBackend) await invoke('restart_backend')
      nextClient = await createDirectClient()
      await nextClient.request<Record<string, unknown>>('taskManager.health')
      if (connectIdRef.current !== connectId) {
        nextClient.close()
        return
      }
      installClient(nextClient)
      setPhase('ready')
      await refreshStatus()
    } catch (e) {
      nextClient?.close()
      if (connectIdRef.current === connectId) {
        setPhase('failed')
        setError(errorMessage(e, '启动 Task Manager 后台失败'))
        await refreshStatus()
      }
    } finally {
      if (connectIdRef.current === connectId) setBusy(false)
    }
  }, [closeActiveClient, installClient, refreshStatus])

  React.useEffect(() => {
    activeBoardIdRef.current = activeBoardId
  }, [activeBoardId])

  React.useEffect(() => {
    boardsRef.current = boards
  }, [boards])

  React.useEffect(() => {
    if (!activeBoardId || activeBoard) return
    setActiveBoardId(null)
    setSelectedTask(null)
  }, [activeBoard, activeBoardId])

  React.useEffect(() => {
    if (selectedTask && !selectedTaskItem) setSelectedTask(null)
  }, [selectedTask, selectedTaskItem])

  const openCreateBoard = React.useCallback(() => {
    setSelectedTask(null)
    setCreateMode('board')
  }, [])

  const openCreateTask = React.useCallback(() => {
    setSelectedTask(null)
    setCreateMode('task')
  }, [])

  const handleCommand = React.useCallback((command: string | null) => {
    if (command === 'new-board') openCreateBoard()
    if (command === 'new-task') {
      if (!activeBoardIdRef.current && boardsRef.current[0]) setActiveBoardId(boardsRef.current[0].id)
      openCreateTask()
    }
  }, [openCreateBoard, openCreateTask])

  React.useEffect(() => {
    markAppReady()
  }, [markAppReady])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const [nextLaunchInfo, nextInitialCommand] = await Promise.all([
        invoke<FwLaunchInfo>('fw_launch_info').catch(() => DEFAULT_LAUNCH_INFO),
        invoke<string | null>('fw_initial_command').catch(() => null),
      ])
      if (cancelled) return
      setLaunchInfo(nextLaunchInfo)
      await refreshStatus()
      if (cancelled) return
      await connect()
      if (!cancelled) handleCommand(nextInitialCommand)
    })()
    return () => {
      cancelled = true
    }
  }, [connect, handleCommand, refreshStatus])

  React.useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false
    void listen<{ command?: string }>('fw-app-command', event => {
      const command = String(event.payload?.command || '').trim()
      if (command) handleCommand(command)
    })
      .then(nextUnlisten => {
        if (cancelled) nextUnlisten()
        else unlisten = nextUnlisten
      })
      .catch(() => {})
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [handleCommand])

  React.useEffect(() => () => {
    connectIdRef.current += 1
    clientRef.current?.close()
    clientRef.current = null
  }, [])

  const createBoard = React.useCallback(async (draft: TaskDraft) => {
    if (controlsDisabled) return
    setBusy(true)
    setError(null)
    try {
      const board = await addBoard(draft)
      if (board) {
        setActiveBoardId(board.id)
        setCreateMode(null)
      }
    } catch (e) {
      setError(errorMessage(e, '创建任务分组失败'))
    } finally {
      setBusy(false)
    }
  }, [addBoard, controlsDisabled])

  const createTask = React.useCallback(async (draft: TaskDraft) => {
    if (controlsDisabled) return
    const target = activeBoard || boards[0]
    if (!target) {
      setError('请先创建任务分组')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const task = await addTask(target.id, draft)
      if (task) {
        setActiveBoardId(target.id)
        setCreateMode(null)
      }
    } catch (e) {
      setError(errorMessage(e, '创建任务失败'))
    } finally {
      setBusy(false)
    }
  }, [activeBoard, addTask, boards, controlsDisabled])

  const openTaskDetail = React.useCallback((task: TaskItem) => {
    if (!activeBoard) return
    setSelectedTask({ boardId: activeBoard.id, taskId: task.id })
  }, [activeBoard])

  const pasteTask = React.useCallback(async (draft: TaskDraft) => {
    if (controlsDisabled || !activeBoard) return
    setBusy(true)
    setError(null)
    try {
      await addTask(activeBoard.id, draft)
    } catch (e) {
      setError(errorMessage(e, '粘贴创建任务失败'))
    } finally {
      setBusy(false)
    }
  }, [activeBoard, addTask, controlsDisabled])

  const saveTaskEdit = React.useCallback(async (draft: TaskDraft) => {
    if (controlsDisabled || !selectedTask) return
    setBusy(true)
    setError(null)
    try {
      const task = await updateTask(selectedTask.boardId, selectedTask.taskId, draft)
      if (!task) throw new Error('任务标题不能为空')
    } catch (e) {
      setError(errorMessage(e, '保存任务失败'))
      throw e
    } finally {
      setBusy(false)
    }
  }, [controlsDisabled, selectedTask, updateTask])

  return (
    <ThemeProvider theme={taskTheme}>
      <CssBaseline />
      <main className="tm-app">
      <TaskTopbar
        standalone={launchInfo.standalone}
        disabled={controlsDisabled}
        onCreateBoard={openCreateBoard}
        onStartDragging={() => appWindow.startDragging()}
        windowActions={{
          minimize: () => appWindow.minimize(),
          toggleMaximize: () => appWindow.toggleMaximize(),
          closeToTray: () => invoke('hide_to_tray'),
        }}
      />

      {visibleError ? (
        <Alert className="tm-status-alert" severity="error" variant="outlined" action={
          phase === 'failed' ? <Button size="small" disabled={busy} onClick={() => connect({ restartBackend: true })}>重试</Button> : null
        }>
          {visibleError}
        </Alert>
      ) : null}

      {phase === 'starting' || boardsLoading ? (
        <Box className="tm-service-panel" role="status" aria-live="polite">
          <CircularProgress size={24} />
          <Typography component="span" color="text.secondary" sx={{ fontSize: 13, fontWeight: 700 }}>正在连接本地服务</Typography>
        </Box>
      ) : null}

      {phase === 'ready' && !boardsLoading ? (
        activeBoard ? (
          <TaskBoardPage
            board={activeBoard}
            disabled={controlsDisabled}
            onBack={() => {
              setSelectedTask(null)
              setActiveBoardId(null)
            }}
            onCreateTask={openCreateTask}
            onOpenTask={openTaskDetail}
            onPasteTask={pasteTask}
          />
        ) : (
          <section className="tm-board-grid" aria-label="任务分组">
            {boards.map(board => (
              <TaskBoardCard key={board.id} board={board} onOpen={() => setActiveBoardId(board.id)} />
            ))}
          </section>
        )
      ) : null}

      {phase === 'failed' ? (
        <Box className="tm-service-panel" role="status" aria-live="polite">
          <Typography component="strong" sx={{ fontSize: 15, fontWeight: 900 }}>本地服务未启动</Typography>
          <Button size="small" disabled={busy} onClick={() => connect({ restartBackend: true })}>重新连接</Button>
        </Box>
      ) : null}

      {createMode === 'board' ? (
        <CreateDialog title="新建任务分组" submitLabel="创建分组" disabled={controlsDisabled} submitting={busy} onSubmit={createBoard} onClose={() => setCreateMode(null)} />
      ) : null}

      {createMode === 'task' ? (
        <CreateDialog title="新建任务" submitLabel="保存任务" disabled={controlsDisabled} submitting={busy} onSubmit={createTask} onClose={() => setCreateMode(null)} />
      ) : null}

      {selectedTaskItem ? (
        <TaskDetailDialog
          task={selectedTaskItem}
          disabled={controlsDisabled}
          submitting={busy}
          onSave={saveTaskEdit}
          onClose={() => setSelectedTask(null)}
        />
      ) : null}
      </main>
    </ThemeProvider>
  )
}

const host = document.getElementById('app')
if (host) createRoot(host).render(<App />)
