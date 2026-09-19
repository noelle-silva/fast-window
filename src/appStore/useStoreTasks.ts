import { useEffect, useRef, useState } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  listStoreTasks,
  STORE_TASKS_CHANGED_EVENT,
  type StoreTaskSnapshot,
  type StoreTasksChangedPayload,
} from './storeTasks'

export type StoreTasksMap = Map<string, StoreTaskSnapshot>

/**
 * 商店任务订阅：先建立事件订阅、再拉取快照，按 updatedAtMs 合并，
 * 保证任务进度与状态在页面往返后保留，也不会被迟到的快照覆盖新进度。
 * 任务由宿主侧驱动，本 hook 只观察，不拥有任务生命周期。
 */
export function useStoreTasks(
  onFinished?: (task: StoreTaskSnapshot) => void,
): StoreTasksMap {
  const [tasks, setTasks] = useState<StoreTasksMap>(() => new Map())
  const tasksRef = useRef(tasks)
  const onFinishedRef = useRef(onFinished)
  onFinishedRef.current = onFinished

  useEffect(() => {
    let disposed = false
    let unlisten: UnlistenFn | null = null

    const upsert = (task: StoreTaskSnapshot, fromEvent: boolean) => {
      const prev = tasksRef.current.get(task.appId)
      if (prev && prev.updatedAtMs > task.updatedAtMs) return
      const next = new Map(tasksRef.current)
      next.set(task.appId, task)
      tasksRef.current = next
      if (disposed) return
      setTasks(next)
      if (fromEvent && prev?.status === 'running' && task.status !== 'running') {
        onFinishedRef.current?.(task)
      }
    }

    const remove = (appId: string) => {
      if (!tasksRef.current.has(appId)) return
      const next = new Map(tasksRef.current)
      next.delete(appId)
      tasksRef.current = next
      if (disposed) return
      setTasks(next)
    }

    void (async () => {
      unlisten = await listen<StoreTasksChangedPayload>(STORE_TASKS_CHANGED_EVENT, event => {
        const payload = event.payload
        if (payload?.task) upsert(payload.task, true)
        else if (payload?.removedAppId) remove(payload.removedAppId)
      })
      const snapshot = await listStoreTasks()
      if (disposed) return
      for (const task of snapshot) upsert(task, false)
    })().catch(error => {
      console.warn('[app-store] failed to subscribe store tasks:', error)
    })

    return () => {
      disposed = true
      if (unlisten) unlisten()
    }
  }, [])

  return tasks
}
