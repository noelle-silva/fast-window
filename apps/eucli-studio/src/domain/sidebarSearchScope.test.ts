import { describe, expect, it } from 'vitest'
import { sidebarSearchScopeKey } from './sidebarSearchScope'

describe('侧边栏搜索词的范围', () => {
  it('工作区页签只认视图与页签：点选工作区不换范围', () => {
    const base = {
      view: 'workspace' as const,
      tab: 'workspaces' as const,
      activeRoleId: 'role-a',
      activeWorkspaceId: 'ws-1',
    }
    expect(sidebarSearchScopeKey(base)).toBe(
      sidebarSearchScopeKey({ ...base, activeRoleId: 'role-b', activeWorkspaceId: 'ws-2' }),
    )
  })

  it('工作区会话页签的范围带上工作区与角色', () => {
    const base = {
      view: 'workspace' as const,
      tab: 'session' as const,
      activeRoleId: 'role-a',
      activeWorkspaceId: 'ws-1',
    }
    const key = sidebarSearchScopeKey(base)
    expect(sidebarSearchScopeKey({ ...base, activeRoleId: 'role-b' })).not.toBe(key)
    expect(sidebarSearchScopeKey({ ...base, activeWorkspaceId: 'ws-2' })).not.toBe(key)
  })

  it('角色历史页签只跟当前角色走', () => {
    const base = {
      view: 'role' as const,
      tab: 'history' as const,
      activeRoleId: 'role-a',
      activeWorkspaceId: 'ws-1',
    }
    const key = sidebarSearchScopeKey(base)
    expect(sidebarSearchScopeKey({ ...base, activeRoleId: 'role-b' })).not.toBe(key)
    expect(sidebarSearchScopeKey({ ...base, activeWorkspaceId: 'ws-2' })).toBe(key)
  })

  it('同一个页签名在不同视图下是两份范围', () => {
    const base = { tab: 'roles' as const, activeRoleId: 'role-a', activeWorkspaceId: 'ws-1' }
    expect(sidebarSearchScopeKey({ ...base, view: 'role' })).not.toBe(
      sidebarSearchScopeKey({ ...base, view: 'workspace' }),
    )
  })
})
