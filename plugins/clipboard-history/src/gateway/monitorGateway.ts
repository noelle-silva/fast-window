import { TASK_KIND_CLIPBOARD_WATCH } from '../shared/constants'
import type { MonitorGateway } from './types'
import type { V2HostAdapter } from './v2HostAdapter'

export function createMonitorGateway(adapter: V2HostAdapter): MonitorGateway {
  return {
    listRecentTasks: (limit) => adapter.tasks.list(limit),
    startClipboardWatch: (payload) => adapter.tasks.create({ kind: TASK_KIND_CLIPBOARD_WATCH, payload }),
    getTask: (taskId) => adapter.tasks.get(taskId),
    cancelTask: (taskId) => adapter.tasks.cancel(taskId),
  }
}
