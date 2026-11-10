import { createDraftCache, useDraftCacheVersion } from '../core/draftCache'
import type { TaskDraft, TaskScope } from './taskTree'

// 任务的未保存草稿：按「作用域 + 归属 + 节点」定位。
// 换层级再回来、甚至把模态窗关掉再打开，改到一半的文字都还在原处等着。
const taskDraftCache = createDraftCache<TaskDraft>()

export function taskDraftKey(scope: TaskScope, ownerId: string, nodeId: string): string {
  return `${scope}:${ownerId}:${nodeId}`
}

export function readTaskDraft(scope: TaskScope, ownerId: string, nodeId: string): TaskDraft | null {
  return taskDraftCache.get(taskDraftKey(scope, ownerId, nodeId))
}

export function writeTaskDraft(scope: TaskScope, ownerId: string, nodeId: string, draft: TaskDraft): void {
  taskDraftCache.set(taskDraftKey(scope, ownerId, nodeId), draft)
}

export function dropTaskDraft(scope: TaskScope, ownerId: string, nodeId: string): void {
  taskDraftCache.remove(taskDraftKey(scope, ownerId, nodeId))
}

export function useTaskDraftVersion(): number {
  return useDraftCacheVersion(taskDraftCache)
}
