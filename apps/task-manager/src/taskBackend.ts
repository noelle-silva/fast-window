import * as React from 'react'
import type { DirectClient, TaskBoard, TaskDraft, TaskItem } from './types'

function errorMessage(error: unknown, fallback: string): string {
  return String((error as { message?: string })?.message || error || fallback)
}

function normalizeDraft(draft: TaskDraft): TaskDraft {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
  }
}

export function useTaskBoards(client: DirectClient | null) {
  const [boards, setBoards] = React.useState<TaskBoard[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const loadIdRef = React.useRef(0)

  const reloadBoards = React.useCallback(async () => {
    const loadId = ++loadIdRef.current
    if (!client) {
      setBoards([])
      setLoading(false)
      setError(null)
      return []
    }
    setLoading(true)
    setError(null)
    try {
      const nextBoards = await client.request<TaskBoard[]>('taskManager.boards.list')
      if (loadIdRef.current === loadId) setBoards(nextBoards)
      return nextBoards
    } catch (e) {
      if (loadIdRef.current === loadId) setError(errorMessage(e, '加载任务失败'))
      throw e
    } finally {
      if (loadIdRef.current === loadId) setLoading(false)
    }
  }, [client])

  React.useEffect(() => {
    void reloadBoards().catch(() => {})
  }, [reloadBoards])

  const addBoard = React.useCallback(async (draft: TaskDraft) => {
    if (!client) return null
    const normalized = normalizeDraft(draft)
    if (!normalized.title) return null
    setError(null)
    try {
      const board = await client.request<TaskBoard>('taskManager.boards.create', normalized)
      setBoards(current => [...current, board])
      return board
    } catch (e) {
      setError(errorMessage(e, '创建任务分组失败'))
      throw e
    }
  }, [client])

  const addTask = React.useCallback(async (boardId: string, draft: TaskDraft) => {
    if (!client) return null
    const normalized = normalizeDraft(draft)
    if (!normalized.title) return null
    setError(null)
    try {
      const task = await client.request<TaskItem>('taskManager.tasks.create', { boardId, ...normalized })
      setBoards(current => current.map(board => (
        board.id === boardId ? { ...board, tasks: [...board.tasks, task], updatedAt: task.updatedAt } : board
      )))
      return task
    } catch (e) {
      setError(errorMessage(e, '创建任务失败'))
      throw e
    }
  }, [client])

  const updateTask = React.useCallback(async (boardId: string, taskId: string, draft: TaskDraft) => {
    if (!client) return null
    const normalized = normalizeDraft(draft)
    if (!normalized.title) return null
    setError(null)
    try {
      const task = await client.request<TaskItem>('taskManager.tasks.update', { boardId, taskId, ...normalized })
      setBoards(current => current.map(board => (
        board.id === boardId
          ? {
              ...board,
              updatedAt: task.updatedAt,
              tasks: board.tasks.map(currentTask => (
                currentTask.id === taskId ? task : currentTask
              )),
            }
          : board
      )))
      return task
    } catch (e) {
      setError(errorMessage(e, '保存任务失败'))
      throw e
    }
  }, [client])

  return { boards, loading, error, reloadBoards, addBoard, addTask, updateTask }
}
