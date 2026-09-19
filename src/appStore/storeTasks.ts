import { invoke } from '@tauri-apps/api/core'

export const STORE_TASKS_CHANGED_EVENT = 'fast-window:app-store-tasks-changed'

export type StoreTaskAction = 'install' | 'update'
export type StoreTaskPhase = 'downloading' | 'extracting' | 'applying'
export type StoreTaskStatus = 'running' | 'succeeded' | 'failed' | 'canceled'

export interface StoreTaskProgress {
  done: number
  total?: number
}

export interface StoreTaskSnapshot {
  appId: string
  appName: string
  action: StoreTaskAction
  phase: StoreTaskPhase
  status: StoreTaskStatus
  cancelRequested: boolean
  progress?: StoreTaskProgress
  error?: string
  startedAtMs: number
  updatedAtMs: number
  finishedAtMs?: number
}

export interface StoreTasksChangedPayload {
  task?: StoreTaskSnapshot
  removedAppId?: string
}

export interface StoreTaskStartRequest {
  action: StoreTaskAction
  url: string
  expectedSha256: string
  expectedId: string
  expectedVersion: string
  appName: string
  installDir?: string
}

export async function listStoreTasks(): Promise<StoreTaskSnapshot[]> {
  return invoke<StoreTaskSnapshot[]>('app_store_task_list')
}

export async function startStoreTask(req: StoreTaskStartRequest): Promise<StoreTaskSnapshot> {
  return invoke<StoreTaskSnapshot>('app_store_task_start', { req })
}

export async function cancelStoreTask(appId: string): Promise<StoreTaskSnapshot> {
  return invoke<StoreTaskSnapshot>('app_store_task_cancel', { appId })
}

export async function dismissStoreTask(appId: string): Promise<void> {
  await invoke('app_store_task_dismiss', { appId })
}
