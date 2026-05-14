import * as React from 'react'
import type { AssetUploadTaskSnapshot, HyperCortexGateway } from '../gateway'
import { isPollingUploadTask, mergeUploadTasks, upsertUploadTask } from './assetUploadTasks'

const ASSET_UPLOAD_TASK_POLL_MS = 500

type Params = {
  gateway: HyperCortexGateway
  onTasksSettled?: () => Promise<void> | void
}

export function useAssetUploadTasks({ gateway, onTasksSettled }: Params) {
  const [tasks, setTasks] = React.useState<AssetUploadTaskSnapshot[]>([])
  const handledSettledTaskIdsRef = React.useRef<Set<string>>(new Set())

  const hasPollingTasks = React.useMemo(() => tasks.some(isPollingUploadTask), [tasks])

  const refreshTasks = React.useCallback(async () => {
    const nextTasks = await gateway.assets.listUploadTasks()
    setTasks(prev => mergeUploadTasks(prev, nextTasks))
    const hasNewSettledTask = nextTasks.some(task => {
      if (task.status !== 'completed' && task.status !== 'failed' && task.status !== 'canceled') return false
      if (handledSettledTaskIdsRef.current.has(task.id)) return false
      handledSettledTaskIdsRef.current.add(task.id)
      return true
    })
    if (hasNewSettledTask) {
      await onTasksSettled?.()
    }
  }, [gateway, onTasksSettled])

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
  }, [])

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
