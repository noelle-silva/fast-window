import { describe, expect, it } from 'vitest'
import { normalizeWorkspace, saveWorkspace } from './workspaceBridge'

describe('工作区读取契约', () => {
  it('把运行时健康状态合并到对应目录上，不改变登记事实', () => {
    const workspace = normalizeWorkspace({
      id: 'ws-health',
      name: '健康工作区',
      directories: [
        { path: 'E:/project', alias: '主目录', description: '代码' },
        { path: 'E:/moved', alias: '被移动目录', description: '' },
      ],
      health: {
        status: 'degraded',
        directories: [
          { path: 'E:/project', status: 'available' },
          { path: 'E:/moved', status: 'missing' },
        ],
      },
      prompt: '',
      registeredRoleIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    expect(workspace?.directories).toEqual([
      { path: 'E:/project', alias: '主目录', description: '代码', health: { status: 'available' } },
      { path: 'E:/moved', alias: '被移动目录', description: '', health: { status: 'missing' } },
    ])
  })

  it('没有健康信息时目录保持原样，旧数据照常可用', () => {
    const workspace = normalizeWorkspace({
      id: 'ws-plain',
      name: '普通工作区',
      directories: [{ path: 'E:/project', alias: '主目录', description: '' }],
      prompt: '',
      registeredRoleIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(workspace?.directories).toEqual([{ path: 'E:/project', alias: '主目录', description: '' }])
  })

  // 描述是给人看的备注：随工作区文档读写，多行内容原样保留（只去首尾空白）。
  it('描述随工作区文档读写，多行内容原样保留', async () => {
    const workspace = normalizeWorkspace({
      id: 'ws-note',
      name: '带备注工作区',
      description: '  临时重构项目\n搞完就删  ',
      prompt: '',
      directories: [],
      registeredRoleIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(workspace?.description).toBe('临时重构项目\n搞完就删')

    const requests: any[] = []
    const netRequest = async (req: any) => {
      requests.push(req)
      return { status: 204 }
    }
    await saveWorkspace(netRequest, workspace as any)

    expect(requests[0].method).toBe('POST')
    expect(requests[0].path).toBe('/api/workspaces')
    expect(requests[0].body.description).toBe('临时重构项目\n搞完就删')
    expect(requests[0].body.prompt).toBe('')
  })
})
