import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline, ThemeProvider } from '@mui/material'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { CreateDialog } from './components/CreateDialog'
import { TaskBoardCard } from './components/TaskBoardCard'
import { TaskBoardDialog } from './components/TaskBoardDialog'
import { TaskTopbar } from './components/TaskTopbar'
import { useTaskBoards } from './taskStorage'
import { taskTheme } from './theme'
import type { FwLaunchInfo, TaskBoard, TaskDraft, TaskItem } from './types'
import { DEFAULT_LAUNCH_INFO } from './types'
import './styles.css'

const appWindow = getCurrentWindow()

function App() {
  const [launchInfo, setLaunchInfo] = React.useState<FwLaunchInfo>(DEFAULT_LAUNCH_INFO)
  const [activeBoardId, setActiveBoardId] = React.useState<string | null>(null)
  const [createMode, setCreateMode] = React.useState<'board' | 'task' | null>(null)
  const [editingTask, setEditingTask] = React.useState<{ boardId: string; task: TaskItem } | null>(null)
  const { boards, addBoard, addTask, updateTask } = useTaskBoards()
  const readyRef = React.useRef(false)
  const activeBoardIdRef = React.useRef<string | null>(null)
  const boardsRef = React.useRef<TaskBoard[]>([])

  const activeBoard = boards.find(board => board.id === activeBoardId) || null
  const editingDraft = React.useMemo<TaskDraft | null>(() => (
    editingTask ? { title: editingTask.task.title, description: editingTask.task.description } : null
  ), [editingTask])

  const markAppReady = React.useCallback(() => {
    if (readyRef.current) return
    readyRef.current = true
    void invoke('app_ready').catch(() => {})
  }, [])

  React.useEffect(() => {
    activeBoardIdRef.current = activeBoardId
  }, [activeBoardId])

  React.useEffect(() => {
    boardsRef.current = boards
  }, [boards])

  const handleCommand = React.useCallback((command: string | null) => {
    if (command === 'new-board') setCreateMode('board')
    if (command === 'new-task') {
      if (!activeBoardIdRef.current && boardsRef.current[0]) setActiveBoardId(boardsRef.current[0].id)
      setCreateMode('task')
    }
  }, [])

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
      handleCommand(nextInitialCommand)
    })()
    return () => {
      cancelled = true
    }
  }, [handleCommand])

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

  const createBoard = React.useCallback((draft: TaskDraft) => {
    const board = addBoard(draft)
    if (board) {
      setActiveBoardId(board.id)
      setCreateMode(null)
    }
  }, [addBoard])

  const createTask = React.useCallback((draft: TaskDraft) => {
    const target = activeBoard || boards[0]
    if (!target) return
    addTask(target.id, draft)
    setActiveBoardId(target.id)
    setCreateMode(null)
  }, [activeBoard, addTask, boards])

  const openTaskEditor = React.useCallback((task: TaskItem) => {
    if (!activeBoard) return
    setEditingTask({ boardId: activeBoard.id, task })
  }, [activeBoard])

  const saveTaskEdit = React.useCallback((draft: TaskDraft) => {
    if (!editingTask) return
    if (updateTask(editingTask.boardId, editingTask.task.id, draft)) setEditingTask(null)
  }, [editingTask, updateTask])

  return (
    <ThemeProvider theme={taskTheme}>
      <CssBaseline />
      <main className="tm-app">
      <TaskTopbar
        standalone={launchInfo.standalone}
        onCreateBoard={() => setCreateMode('board')}
        onStartDragging={() => appWindow.startDragging()}
        windowActions={{
          minimize: () => appWindow.minimize(),
          toggleMaximize: () => appWindow.toggleMaximize(),
          closeToTray: () => invoke('hide_to_tray'),
        }}
      />

      <section className="tm-board-grid" aria-label="任务分组">
        {boards.map(board => (
          <TaskBoardCard key={board.id} board={board} onOpen={() => setActiveBoardId(board.id)} />
        ))}
      </section>

      {activeBoard ? (
        <TaskBoardDialog
          board={activeBoard}
          onCreateTask={() => setCreateMode('task')}
          onEditTask={openTaskEditor}
          onPasteTask={draft => addTask(activeBoard.id, draft)}
          onClose={() => setActiveBoardId(null)}
        />
      ) : null}

      {createMode === 'board' ? (
        <CreateDialog title="新建任务分组" submitLabel="创建分组" onSubmit={createBoard} onClose={() => setCreateMode(null)} />
      ) : null}

      {createMode === 'task' ? (
        <CreateDialog title="新建任务" submitLabel="保存任务" onSubmit={createTask} onClose={() => setCreateMode(null)} />
      ) : null}

      {editingTask && editingDraft ? (
        <CreateDialog
          title="编辑任务"
          submitLabel="保存修改"
          subtitle="修改标题与描述，按 Ctrl+S 也可以保存。"
          initialDraft={editingDraft}
          onSubmit={saveTaskEdit}
          onClose={() => setEditingTask(null)}
        />
      ) : null}
      </main>
    </ThemeProvider>
  )
}

const host = document.getElementById('app')
if (host) createRoot(host).render(<App />)
