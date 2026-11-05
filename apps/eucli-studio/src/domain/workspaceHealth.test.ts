import { describe, expect, it } from 'vitest'
import {
  normalizeWorkspaceDirectoryHealth,
  workspaceDirectoryHealthByPath,
  workspaceDirectoryHealthLabel,
  workspaceDirectoryNeedsRepair,
  workspaceUnavailableDirectoryCount,
} from './workspaceHealth'

describe('工作区目录健康状态', () => {
  it('只接受已知状态，并保留可诊断的细节', () => {
    expect(normalizeWorkspaceDirectoryHealth({ status: 'missing' })).toEqual({ status: 'missing' })
    expect(normalizeWorkspaceDirectoryHealth({ status: 'unavailable', detail: 'access denied' })).toEqual({ status: 'unavailable', detail: 'access denied' })
    expect(normalizeWorkspaceDirectoryHealth({ status: 'unknown' })).toBeNull()
    expect(normalizeWorkspaceDirectoryHealth(null)).toBeNull()
  })

  it('按路径合并健康条目', () => {
    const byPath = workspaceDirectoryHealthByPath([
      { path: 'E:/project', status: 'available' },
      { path: 'E:/moved', status: 'missing' },
      { path: '', status: 'missing' },
    ])
    expect(byPath.get('E:/project')).toEqual({ status: 'available' })
    expect(byPath.get('E:/moved')).toEqual({ status: 'missing' })
    expect(byPath.size).toBe(2)
  })

  it('只有非 available 的目录才算需要修复', () => {
    expect(workspaceDirectoryNeedsRepair({ health: { status: 'available' } })).toBe(false)
    expect(workspaceDirectoryNeedsRepair({ health: { status: 'missing' } })).toBe(true)
    expect(workspaceDirectoryNeedsRepair({})).toBe(false)
    expect(workspaceUnavailableDirectoryCount({
      directories: [
        { path: 'E:/a', health: { status: 'available' } },
        { path: 'E:/b', health: { status: 'missing' } },
        { path: 'E:/c', health: { status: 'not_directory' } },
      ],
    })).toBe(2)
  })

  it('把不可访问的底层错误一并展示，其余状态用中文标签', () => {
    expect(workspaceDirectoryHealthLabel({ status: 'missing' })).toBe('路径不存在')
    expect(workspaceDirectoryHealthLabel({ status: 'unavailable', detail: 'access denied' })).toBe('无法访问：access denied')
  })
})
