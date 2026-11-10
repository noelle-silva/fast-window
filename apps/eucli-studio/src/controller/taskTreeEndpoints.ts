import type { TaskScope } from '../domain/taskTree'
import { fillPath, withQuery, type EbNetRequest, type PathQuery } from './netPath'

// 任务树的请求底座：端点表与 apps/eucli-box/src/gateway-system/routes.go 一一对应。
// 与提示词库同一套规则：作用域走路径、归属 id 走查询参数，路径拼装交给 netPath。

const API_PREFIX = '/api/'

export const TASK_TREE_ENDPOINTS = {
  loadTree: { method: 'GET', path: 'tasks/:scope' },
  saveTree: { method: 'PUT', path: 'tasks/:scope' },
  createNode: { method: 'POST', path: 'tasks/:scope/nodes' },
  deleteNode: { method: 'DELETE', path: 'tasks/:scope/nodes/:taskId' },
  moveNode: { method: 'POST', path: 'tasks/:scope/nodes/:taskId/move' },
  reorderChildren: { method: 'PUT', path: 'tasks/:scope/order' },
} as const

export type TaskTreeEndpoint = (typeof TASK_TREE_ENDPOINTS)[keyof typeof TASK_TREE_ENDPOINTS]

// 任务只有角色与工作区两个作用域，没有全局：归属必须选好，缺了就当场失败。
export function taskScopeQuery(ownerId: string): PathQuery {
  const owner = String(ownerId ?? '').trim()
  if (!owner) throw new Error('请先选择归属')
  return { ownerId: owner }
}

export async function callTaskEndpoint<T>(options: {
  netRequest: EbNetRequest
  endpoint: TaskTreeEndpoint
  scope: TaskScope
  ownerId: string
  params?: Record<string, string>
  query?: PathQuery
  body?: unknown
  normalize: (raw: unknown) => T
}): Promise<T> {
  const { netRequest, endpoint, scope, ownerId, params = {}, query = {}, body, normalize } = options
  const path = withQuery(`${API_PREFIX}${fillPath(endpoint.path, { ...params, scope })}`, {
    ...taskScopeQuery(ownerId),
    ...query,
  })
  const response = await netRequest({ method: endpoint.method, path, body })
  return normalize(response?.body)
}
