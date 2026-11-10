import { normalizeTaskTree, type TaskNode, type TaskScope, type TaskTree } from '../domain/taskTree'
import { TASK_TREE_ENDPOINTS, callTaskEndpoint } from './taskTreeEndpoints'
import type { EbNetRequest } from './netPath'

// 任务树的业务 API：每个函数只说明「用哪个端点、哪些路径参数、哪些请求体」。
// 路径拼装、归属查询与编码统一由 taskTreeEndpoints 负责。

function field(value: unknown) {
  return String(value ?? '').trim()
}

export async function loadTaskTree(netRequest: EbNetRequest, scope: TaskScope, ownerId: string): Promise<TaskTree> {
  return callTaskEndpoint({
    netRequest,
    endpoint: TASK_TREE_ENDPOINTS.loadTree,
    scope,
    ownerId,
    normalize: normalizeTaskTree,
  })
}

export async function saveTaskTree(netRequest: EbNetRequest, scope: TaskScope, ownerId: string, tree: TaskTree): Promise<TaskTree> {
  return callTaskEndpoint({
    netRequest,
    endpoint: TASK_TREE_ENDPOINTS.saveTree,
    scope,
    ownerId,
    body: tree,
    normalize: normalizeTaskTree,
  })
}

// 新建：parentId 为空表示根级；节点的 id 由调用方给出。
export async function createTaskNode(
  netRequest: EbNetRequest,
  scope: TaskScope,
  ownerId: string,
  parentId: string,
  node: TaskNode,
): Promise<TaskTree> {
  return callTaskEndpoint({
    netRequest,
    endpoint: TASK_TREE_ENDPOINTS.createNode,
    scope,
    ownerId,
    body: { parentId: field(parentId), node },
    normalize: normalizeTaskTree,
  })
}

// 删除：服务端会连整棵子树一起删，调用方不需要逐层清理。
export async function deleteTaskNode(netRequest: EbNetRequest, scope: TaskScope, ownerId: string, taskId: string): Promise<TaskTree> {
  return callTaskEndpoint({
    netRequest,
    endpoint: TASK_TREE_ENDPOINTS.deleteNode,
    scope,
    ownerId,
    params: { taskId },
    normalize: normalizeTaskTree,
  })
}

// 移动：来源父级由服务端从树上推出，请求只提交目标；空串表示移到根级。
export async function moveTaskNode(
  netRequest: EbNetRequest,
  scope: TaskScope,
  ownerId: string,
  taskId: string,
  toParentId: string,
): Promise<TaskTree> {
  return callTaskEndpoint({
    netRequest,
    endpoint: TASK_TREE_ENDPOINTS.moveNode,
    scope,
    ownerId,
    params: { taskId },
    body: { toParentId: field(toParentId) },
    normalize: normalizeTaskTree,
  })
}

// 排序：taskIds 必须覆盖该层每个子节点恰好一次；parentId 为空表示根级。
export async function reorderTaskChildren(
  netRequest: EbNetRequest,
  scope: TaskScope,
  ownerId: string,
  parentId: string,
  taskIds: string[],
): Promise<TaskTree> {
  return callTaskEndpoint({
    netRequest,
    endpoint: TASK_TREE_ENDPOINTS.reorderChildren,
    scope,
    ownerId,
    body: { parentId: field(parentId), taskIds },
    normalize: normalizeTaskTree,
  })
}
