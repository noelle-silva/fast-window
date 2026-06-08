export type TaskItem = {
  id: string
  title: string
  description: string
  createdAt: string
}

export type TaskBoard = {
  id: string
  title: string
  description: string
  tasks: TaskItem[]
  createdAt: string
}

export type TaskDraft = {
  title: string
  description: string
}

export type FwLaunchInfo = {
  launched: boolean
  standalone: boolean
  mode: string
}

export const DEFAULT_LAUNCH_INFO: FwLaunchInfo = {
  launched: false,
  standalone: true,
  mode: 'standalone',
}
