import { createEmptyTaskData, createTask, type Task, type TaskData } from '../model/types'

type FastWindowFs = {
  readText(path: string): Promise<string>
  writeText(path: string, content: string): Promise<void>
}

type FastWindow = {
  fs: FastWindowFs
}

const TASKS_PATH = 'tasks.json'

function getFastWindow(): FastWindow {
  // 约束：允许对 window.fastWindow 使用 any，其它地方禁止 any
  const fw = (window as any).fastWindow as FastWindow | undefined
  if (!fw?.fs?.readText || !fw?.fs?.writeText) {
    throw new Error('fastWindow.fs 不可用：请确认运行在 fast-window 宿主环境中')
  }
  return fw
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function coerceTask(value: unknown): Task | null {
  if (!isRecord(value)) return null

  const id = typeof value.id === 'string' ? value.id : null
  const title = typeof value.title === 'string' ? value.title : null
  if (!id || !title) return null

  const description = typeof value.description === 'string' ? value.description : ''
  const done = typeof value.done === 'boolean' ? value.done : false
  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : Date.now()
  const collapsed = typeof value.collapsed === 'boolean' ? value.collapsed : false
  const children = Array.isArray(value.children)
    ? value.children.map(coerceTask).filter((t): t is Task => t !== null)
    : []

  return { id, title, description, done, createdAt, collapsed, children }
}

function coerceTaskData(value: unknown): TaskData {
  if (!isRecord(value)) return createEmptyTaskData()
  if (value.version !== 1) return createEmptyTaskData()
  const tasks = Array.isArray(value.tasks)
    ? value.tasks.map(coerceTask).filter((t): t is Task => t !== null)
    : []
  return { version: 1, tasks }
}

export async function loadTasks(): Promise<TaskData> {
  try {
    const text = await getFastWindow().fs.readText(TASKS_PATH)
    const parsed: unknown = JSON.parse(text)
    return coerceTaskData(parsed)
  } catch {
    return createEmptyTaskData()
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let latestJson = ''
let pendingResolves: Array<() => void> = []
let pendingRejects: Array<(err: unknown) => void> = []

export function saveTasks(data: TaskData): Promise<void> {
  latestJson = JSON.stringify(data, null, 2)

  if (saveTimer) clearTimeout(saveTimer)

  const p = new Promise<void>((resolve, reject) => {
    pendingResolves.push(resolve)
    pendingRejects.push(reject)
  })

  saveTimer = setTimeout(async () => {
    saveTimer = null

    const resolves = pendingResolves
    const rejects = pendingRejects
    pendingResolves = []
    pendingRejects = []

    try {
      await getFastWindow().fs.writeText(TASKS_PATH, latestJson)
      resolves.forEach((r) => r())
    } catch (err) {
      rejects.forEach((rej) => rej(err))
    }
  }, 500)

  return p
}

function mapTasks(
  tasks: Task[],
  targetId: string,
  mapper: (task: Task) => Task,
): { tasks: Task[]; changed: boolean } {
  let changed = false
  const next = tasks.map((t) => {
    if (t.id === targetId) {
      changed = true
      return mapper(t)
    }

    const child = mapTasks(t.children, targetId, mapper)
    if (child.changed) {
      changed = true
      return { ...t, children: child.tasks }
    }

    return t
  })

  return { tasks: changed ? next : tasks, changed }
}

function removeFromTasks(tasks: Task[], targetId: string): { tasks: Task[]; removed: boolean } {
  let removed = false

  const next: Task[] = []
  for (const t of tasks) {
    if (t.id === targetId) {
      removed = true
      continue
    }

    const child = removeFromTasks(t.children, targetId)
    if (child.removed) {
      removed = true
      next.push({ ...t, children: child.tasks })
    } else {
      next.push(t)
    }
  }

  return { tasks: removed ? next : tasks, removed }
}

function setDoneDeep(task: Task, done: boolean): Task {
  if (task.children.length === 0) return { ...task, done }
  return { ...task, done, children: task.children.map((c) => setDoneDeep(c, done)) }
}

export function addTask(data: TaskData, parentId: string | null, title: string): TaskData {
  const newTask = createTask(title)

  if (parentId === null) {
    return { ...data, tasks: [...data.tasks, newTask] }
  }

  const updated = mapTasks(data.tasks, parentId, (t) => ({ ...t, children: [...t.children, newTask] }))
  return updated.changed ? { ...data, tasks: updated.tasks } : data
}

export function removeTask(data: TaskData, taskId: string): TaskData {
  const updated = removeFromTasks(data.tasks, taskId)
  return updated.removed ? { ...data, tasks: updated.tasks } : data
}

export function toggleDone(data: TaskData, taskId: string): TaskData {
  const updated = mapTasks(data.tasks, taskId, (t) => setDoneDeep(t, !t.done))
  return updated.changed ? { ...data, tasks: updated.tasks } : data
}

export function toggleCollapsed(data: TaskData, taskId: string): TaskData {
  const updated = mapTasks(data.tasks, taskId, (t) => ({ ...t, collapsed: !t.collapsed }))
  return updated.changed ? { ...data, tasks: updated.tasks } : data
}

export function updateTask(
  data: TaskData,
  taskId: string,
  updates: Partial<Pick<Task, 'title' | 'description'>>,
): TaskData {
  const updated = mapTasks(data.tasks, taskId, (t) => {
    const title = updates.title ?? t.title
    const description = updates.description ?? t.description
    if (title === t.title && description === t.description) return t
    return { ...t, title, description }
  })

  return updated.changed ? { ...data, tasks: updated.tasks } : data
}

