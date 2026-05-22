import * as React from 'react'
import type { HyperCortexGateway } from '../gateway'
import type { AssetUploadTaskSnapshot } from '../gateway/types'
import { isPollingUploadTask, mergeUploadTasks, upsertUploadTask } from './assetUploadTasks'

const ASSET_UPLOAD_TASK_POLL_MS = 500

type Params = {
  gateway: HyperCortexGateway
  onTasksSettled?: () => Promise<void> | void
}

function isSettledUploadTask(task: AssetUploadTaskSnapshot): boolean {
  return task.status === 'completed' || task.status === 'failed' || task.status === 'canceled'
}

export function useAssetUploadTasks({ gateway, onTasksSettled }: Params) {
  const [tasks, setTasks] = React.useState<AssetUploadTaskSnapshot[]>([])
  const handledSettledTaskIdsRef = React.useRef<Set<string>>(new Set())

  const hasPollingTasks = React.useMemo(() => tasks.some(isPollingUploadTask), [tasks])

  const markSettledTaskHandled = React.useCallback((task: AssetUploadTaskSnapshot) => {
    if (!isSettledUploadTask(task)) return false
    if (handledSettledTaskIdsRef.current.has(task.id)) return false
    handledSettledTaskIdsRef.current.add(task.id)
    return true
  }, [])

  const notifyTasksSettled = React.useCallback(async () => {
    await onTasksSettled?.()
  }, [onTasksSettled])

  const refreshTasks = React.useCallback(async () => {
    const nextTasks = await gateway.assets.listUploadTasks()
    setTasks(prev => mergeUploadTasks(prev, nextTasks))
    const hasNewSettledTask = nextTasks.some(markSettledTaskHandled)
    if (hasNewSettledTask) {
      await notifyTasksSettled()
    }
  }, [gateway, markSettledTaskHandled, notifyTasksSettled])

  React.useEffect(() => {
    void refreshTasks().catch(() => {})
  }, [refreshTasks])

  React.useEffect(() => {
    if (!hasPollingTasks) return
    const timer = window.setInterval(() => {
      void refreshTasks().catch(() => {})
    }, ASSET_UPLOAD_TASK_POLL_MS)
    return () => window.clearInterval(timer)
  }, [hasPollingTasks, refreshTasks])

  const upsertTask = React.useCallback((task: AssetUploadTaskSnapshot) => {
    setTasks(prev => upsertUploadTask(prev, task))
    if (markSettledTaskHandled(task)) void notifyTasksSettled().catch(() => {})
  }, [markSettledTaskHandled, notifyTasksSettled])

  const pauseTask = React.useCallback(async (taskId: string) => {
    const task = await gateway.assets.pauseUploadTask(taskId)
    upsertTask(task)
  }, [gateway, upsertTask])

  const resumeTask = React.useCallback(async (taskId: string) => {
    const task = await gateway.assets.resumeUploadTask(taskId)
    upsertTask(task)
  }, [gateway, upsertTask])

  const cancelTask = React.useCallback(async (taskId: string) => {
    const task = await gateway.assets.cancelUploadTask(taskId)
    upsertTask(task)
  }, [gateway, upsertTask])

  return {
    tasks,
    upsertTask,
    pauseTask,
    resumeTask,
    cancelTask,
    refreshTasks,
  }
}
