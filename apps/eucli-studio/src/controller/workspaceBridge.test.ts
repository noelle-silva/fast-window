import { describe, expect, it } from 'vitest'
import { normalizeWorkspace } from './workspaceBridge'

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
})
