import type { AiChatShowToast } from '../gateway/capabilities'
import type { TaskNode, TaskScope, TaskTree } from '../domain/taskTree'
import {
  createTaskNode,
  deleteTaskNode,
  loadTaskTree,
  moveTaskNode,
  reorderTaskChildren,
  saveTaskTree,
} from './taskTreeClient'

// 任务树的客户端动作：只做请求转发与提示。
// 结构规矩（id 唯一、不能移进自己的子树、排序必须完整）全部由服务端判定。

export function createTaskTreeController(deps: {
  getNetRequest: () => ((req: any) => Promise<any>) | undefined
  showToast?: AiChatShowToast
}) {
  const { getNetRequest, showToast } = deps

  function requireNetRequest() {
    const netRequest = getNetRequest()
    if (typeof netRequest !== 'function') throw new Error('业务端请求通道不可用')
    return netRequest
  }

  async function run<T>(label: string, task: () => Promise<T>): Promise<T> {
    try {
      return await task()
    } catch (error: any) {
      const message = String(error?.message || error || label)
      showToast?.(message, { kind: 'error' })
      throw error
    }
  }

  return {
    notifyTaskTree: (message: string, kind: 'error' | 'success' = 'error') => {
      showToast?.(String(message ?? ''), { kind })
    },

    loadTaskTree: (scope: TaskScope, ownerId: string): Promise<TaskTree> =>
      run('加载任务失败', () => loadTaskTree(requireNetRequest(), scope, ownerId)),

    saveTaskTree: (scope: TaskScope, ownerId: string, tree: TaskTree): Promise<TaskTree> =>
      run('保存任务失败', async () => {
        const saved = await saveTaskTree(requireNetRequest(), scope, ownerId, tree)
        showToast?.('任务已保存', { kind: 'success' })
        return saved
      }),

    createTaskNode: (scope: TaskScope, ownerId: string, parentId: string, node: TaskNode): Promise<TaskTree> =>
      run('新建任务失败', async () => {
        const saved = await createTaskNode(requireNetRequest(), scope, ownerId, parentId, node)
        showToast?.('任务已新建', { kind: 'success' })
        return saved
      }),

    deleteTaskNode: (scope: TaskScope, ownerId: string, taskId: string): Promise<TaskTree> =>
      run('删除任务失败', async () => {
        const saved = await deleteTaskNode(requireNetRequest(), scope, ownerId, taskId)
        showToast?.('任务已删除', { kind: 'success' })
        return saved
      }),

    moveTaskNode: (scope: TaskScope, ownerId: string, taskId: string, toParentId: string): Promise<TaskTree> =>
      run('移动任务失败', async () => {
        const saved = await moveTaskNode(requireNetRequest(), scope, ownerId, taskId, toParentId)
        showToast?.('任务已移动', { kind: 'success' })
        return saved
      }),

    reorderTaskChildren: (scope: TaskScope, ownerId: string, parentId: string, taskIds: string[]): Promise<TaskTree> =>
      run('排序失败', () => reorderTaskChildren(requireNetRequest(), scope, ownerId, parentId, taskIds)),
  }
}
