import type { AssetUploadTaskSnapshot } from '../gateway/types'

export type AssetUploadTaskView = 'active' | 'failed' | 'completed'

export const ASSET_UPLOAD_TASK_VIEWS: AssetUploadTaskView[] = ['active', 'failed', 'completed']

export function isActiveUploadTask(task: AssetUploadTaskSnapshot): boolean {
  return task.status === 'queued' || task.status === 'running' || task.status === 'paused'
}

export function isFailedUploadTask(task: AssetUploadTaskSnapshot): boolean {
  return task.status === 'failed'
}

export function isCompletedUploadTask(task: AssetUploadTaskSnapshot): boolean {
  return task.status === 'completed' || task.status === 'canceled'
}

export function filterUploadTasksByView(tasks: AssetUploadTaskSnapshot[], view: AssetUploadTaskView): AssetUploadTaskSnapshot[] {
  if (view === 'active') return tasks.filter(isActiveUploadTask)
  if (view === 'failed') return tasks.filter(isFailedUploadTask)
  return tasks.filter(isCompletedUploadTask)
}

export function uploadTaskViewLabel(view: AssetUploadTaskView): string {
  if (view === 'active') return '上传中'
  if (view === 'failed') return '失败'
  return '已完成'
}

export function uploadTaskViewEmptyText(view: AssetUploadTaskView): string {
  if (view === 'active') return '没有正在上传的任务'
  if (view === 'failed') return '没有失败的任务'
  return '还没有完成的任务'
}

export function isPollingUploadTask(task: AssetUploadTaskSnapshot): boolean {
  return task.status === 'queued' || task.status === 'running'
}

export function upsertUploadTask(tasks: AssetUploadTaskSnapshot[], task: AssetUploadTaskSnapshot): AssetUploadTaskSnapshot[] {
  const index = tasks.findIndex(item => item.id === task.id)
  if (index < 0) return sortUploadTasks([task, ...tasks])
  const next = tasks.slice()
  next[index] = task
  return sortUploadTasks(next)
}

export function mergeUploadTasks(current: AssetUploadTaskSnapshot[], incoming: AssetUploadTaskSnapshot[]): AssetUploadTaskSnapshot[] {
  const byId = new Map<string, AssetUploadTaskSnapshot>()
  for (const task of current) byId.set(task.id, task)
  for (const task of incoming) byId.set(task.id, task)
  return sortUploadTasks(Array.from(byId.values()))
}

export function sortUploadTasks(tasks: AssetUploadTaskSnapshot[]): AssetUploadTaskSnapshot[] {
  return tasks.slice().sort((a, b) => Number(b.createdMs || 0) - Number(a.createdMs || 0))
}

export function formatUploadBytes(bytes: number): string {
  const value = Number(bytes || 0)
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function clampUploadProgress(progress: number): number {
  const value = Number(progress || 0)
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 100) return 100
  return value
}

export function uploadTaskStatusText(task: AssetUploadTaskSnapshot): string {
  if (task.status === 'queued') return '等待中'
  if (task.status === 'running') return '上传中'
  if (task.status === 'paused') return '已暂停'
  if (task.status === 'completed') return '已完成'
  if (task.status === 'failed') return '出错'
  if (task.status === 'canceled') return '已取消'
  return '未知'
}

export function uploadTaskTitle(task: AssetUploadTaskSnapshot): string {
  const files = Array.isArray(task.files) ? task.files : []
  if (files.length === 1) return files[0]?.name || '附件上传'
  return `${files.length} 个附件`
}

export function uploadTaskError(task: AssetUploadTaskSnapshot): string {
  if (task.error) return task.error
  const failed = task.files?.find(file => file.error)
  return failed?.error || ''
}
