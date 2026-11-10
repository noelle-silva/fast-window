import { describe, expect, it } from 'vitest'
import {
  createTaskNode,
  deleteTaskNode,
  loadTaskTree,
  moveTaskNode,
  reorderTaskChildren,
  saveTaskTree,
} from './taskTreeClient'
import { TASK_TREE_ENDPOINTS } from './taskTreeEndpoints'
import type { TaskNode } from '../domain/taskTree'

const EMPTY_TREE = { tasks: [] }

function createRecorder() {
  const calls: Array<{ method: string; path: string; body?: any }> = []
  const netRequest = async (req: any) => {
    calls.push({ method: req.method, path: String(req.path), body: req.body })
    return { body: EMPTY_TREE }
  }
  return { calls, netRequest }
}

function node(id: string): TaskNode {
  return { id, name: '', description: '', content: '', children: [], createdAt: '', updatedAt: '' }
}

describe('任务树请求路径', () => {
  it('把归属查询放在作用域根路径上', async () => {
    const { calls, netRequest } = createRecorder()

    await loadTaskTree(netRequest, 'role', 'role-1')
    await saveTaskTree(netRequest, 'role', 'role-1', EMPTY_TREE)

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /api/tasks/role?ownerId=role-1',
      'PUT /api/tasks/role?ownerId=role-1',
    ])
  })

  it('子路径排在归属查询之前', async () => {
    const { calls, netRequest } = createRecorder()

    await deleteTaskNode(netRequest, 'workspace', 'ws-1', 't1')
    await moveTaskNode(netRequest, 'workspace', 'ws-1', 't1', '')

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'DELETE /api/tasks/workspace/nodes/t1?ownerId=ws-1',
      'POST /api/tasks/workspace/nodes/t1/move?ownerId=ws-1',
    ])
  })

  it('新建与排序只提交必要字段', async () => {
    const { calls, netRequest } = createRecorder()

    await createTaskNode(netRequest, 'role', 'role-1', 'parent-1', node('new-1'))
    await reorderTaskChildren(netRequest, 'role', 'role-1', 'parent-1', ['b', 'a'])

    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/api/tasks/role/nodes?ownerId=role-1',
      body: { parentId: 'parent-1', node: { id: 'new-1' } },
    })
    expect(calls[1]).toMatchObject({
      method: 'PUT',
      path: '/api/tasks/role/order?ownerId=role-1',
      body: { parentId: 'parent-1', taskIds: ['b', 'a'] },
    })
  })

  it('根级用空串表达，不被当成缺参数', async () => {
    const { calls, netRequest } = createRecorder()

    await createTaskNode(netRequest, 'role', 'role-1', '', node('root-1'))
    await reorderTaskChildren(netRequest, 'role', 'role-1', '', ['a'])

    expect(calls[0].body.parentId).toBe('')
    expect(calls[1].body.parentId).toBe('')
  })

  it('对需要转义的 id 做编码', async () => {
    const { calls, netRequest } = createRecorder()

    await deleteTaskNode(netRequest, 'role', 'role-1', 'a/b')

    expect(calls[0].path).toBe('/api/tasks/role/nodes/a%2Fb?ownerId=role-1')
  })

  it('缺归属时当场失败', async () => {
    const { netRequest } = createRecorder()

    await expect(loadTaskTree(netRequest, 'role', '')).rejects.toThrow('请先选择归属')
  })
})

describe('任务树端点表', () => {
  it('每条端点都声明方法与作用域路径', () => {
    const entries = Object.entries(TASK_TREE_ENDPOINTS)
    expect(entries).toHaveLength(6)

    for (const [, endpoint] of entries) {
      expect(['GET', 'PUT', 'POST', 'DELETE']).toContain(endpoint.method)
      expect(endpoint.path.startsWith('tasks/')).toBe(true)
      expect(endpoint.path).toContain(':scope')
    }
  })
})
