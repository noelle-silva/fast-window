export interface Task {
  /** 唯一ID（时间戳 + 随机数） */
  id: string
  /** 任务标题 */
  title: string
  /** 任务描述 */
  description: string
  /** 是否完成 */
  done: boolean
  /** 创建时间戳 */
  createdAt: number
  /** 子任务是否折叠 */
  collapsed: boolean
  /** 子任务列表（递归结构，支持无限嵌套） */
  children: Task[]
}

export interface TaskData {
  version: 1
  /** 顶层任务列表 */
  tasks: Task[]
}

// 生成唯一ID的工具函数
export function generateId(): string {
  const ts = Date.now().toString(36)
  const rnd = Math.random().toString(36).slice(2, 10)
  return `${ts}-${rnd}`
}

// 创建新任务的工厂函数（只需传title，其余给默认值）
export function createTask(title: string): Task {
  return {
    id: generateId(),
    title,
    description: '',
    done: false,
    createdAt: Date.now(),
    collapsed: false,
    children: [],
  }
}

// 创建空的 TaskData
export function createEmptyTaskData(): TaskData {
  return { version: 1, tasks: [] }
}

