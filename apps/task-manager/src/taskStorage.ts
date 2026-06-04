import * as React from 'react'
import type { TaskBoard, TaskDraft, TaskItem } from './types'

const STORAGE_KEY = 'fast-window.task-manager.boards.v1'

const ACCENTS = ['#7c3aed', '#0ea5e9', '#16a34a', '#f97316', '#db2777', '#475569']
const REMOVED_SEED_BOARD_IDS = new Set(['today', 'ideas'])

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeDraft(draft: TaskDraft): TaskDraft {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
  }
}

function createTask(draft: TaskDraft): TaskItem {
  const normalized = normalizeDraft(draft)
  return {
    id: createId('task'),
    title: normalized.title,
    description: normalized.description,
    createdAt: new Date().toISOString(),
  }
}

function createBoard(draft: TaskDraft, index: number): TaskBoard {
  const normalized = normalizeDraft(draft)
  return {
    id: createId('board'),
    title: normalized.title,
    description: normalized.description,
    accent: ACCENTS[index % ACCENTS.length],
    tasks: [],
    createdAt: new Date().toISOString(),
  }
}

function loadBoards(): TaskBoard[] {
  try {
    const text = localStorage.getItem(STORAGE_KEY)
    if (!text) return []
    const value = JSON.parse(text)
    return Array.isArray(value) ? value.filter(board => !REMOVED_SEED_BOARD_IDS.has(String(board?.id || ''))) : []
  } catch {
    return []
  }
}

export function useTaskBoards() {
  const [boards, setBoards] = React.useState<TaskBoard[]>(loadBoards)

  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(boards))
  }, [boards])

  const addBoard = React.useCallback((draft: TaskDraft) => {
    const normalized = normalizeDraft(draft)
    if (!normalized.title) return null
    const board = createBoard(normalized, boards.length)
    setBoards(current => [...current, board])
    return board
  }, [boards.length])

  const addTask = React.useCallback((boardId: string, draft: TaskDraft) => {
    const normalized = normalizeDraft(draft)
    if (!normalized.title) return null
    const task = createTask(normalized)
    setBoards(current => current.map(board => (
      board.id === boardId ? { ...board, tasks: [...board.tasks, task] } : board
    )))
    return task
  }, [])

  return { boards, addBoard, addTask }
}
