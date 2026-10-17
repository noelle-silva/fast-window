import { beforeEach, describe, expect, it } from 'vitest'
import {
  forgetRoleSession,
  forgetWorkspaceSession,
  getSidebarNavigationMemory,
  rememberRoleId,
  rememberRoleSession,
  rememberWorkspaceId,
  rememberWorkspaceRole,
  rememberWorkspaceSession,
  resetSidebarNavigationMemory,
  setRoleSidebarTab,
  setWorkspaceSidebarTab,
  workspaceSessionKey,
} from './sidebarNavigationMemory'

describe('侧边栏导航记忆', () => {
  beforeEach(() => {
    resetSidebarNavigationMemory()
  })

  it('默认停留段：角色模式为角色，工作区模式为工作区', () => {
    const memory = getSidebarNavigationMemory()
    expect(memory.role.tab).toBe('roles')
    expect(memory.workspace.tab).toBe('workspaces')
  })

  it('按模式分别记住停留段', () => {
    setRoleSidebarTab('history')
    setWorkspaceSidebarTab('session')
    expect(getSidebarNavigationMemory().role.tab).toBe('history')
    expect(getSidebarNavigationMemory().workspace.tab).toBe('session')
  })

  it('角色模式记住角色与各角色的会话', () => {
    rememberRoleId('role-a')
    rememberRoleSession('role-a', 'chat-a1')
    rememberRoleSession('role-b', 'chat-b1')
    expect(getSidebarNavigationMemory().role.roleId).toBe('role-a')
    expect(getSidebarNavigationMemory().role.sessionByRole).toEqual({
      'role-a': 'chat-a1',
      'role-b': 'chat-b1',
    })
  })

  it('工作区模式按工作区记住角色，按工作区加角色记住会话', () => {
    rememberWorkspaceId('ws-1')
    rememberWorkspaceRole('ws-1', 'role-a')
    rememberWorkspaceRole('ws-2', 'role-b')
    rememberWorkspaceSession('ws-1', 'role-a', 'chat-a1')
    rememberWorkspaceSession('ws-2', 'role-b', 'chat-b1')
    const memory = getSidebarNavigationMemory()
    expect(memory.workspace.workspaceId).toBe('ws-1')
    expect(memory.workspace.roleByWorkspace).toEqual({ 'ws-1': 'role-a', 'ws-2': 'role-b' })
    expect(memory.workspace.sessionByWorkspaceRole).toEqual({
      [workspaceSessionKey('ws-1', 'role-a')]: 'chat-a1',
      [workspaceSessionKey('ws-2', 'role-b')]: 'chat-b1',
    })
  })

  it('可以忘掉单个会话位置', () => {
    rememberRoleSession('role-a', 'chat-a1')
    rememberWorkspaceSession('ws-1', 'role-a', 'chat-a1')
    forgetRoleSession('role-a')
    forgetWorkspaceSession('ws-1', 'role-a')
    const memory = getSidebarNavigationMemory()
    expect(memory.role.sessionByRole['role-a']).toBeUndefined()
    expect(memory.workspace.sessionByWorkspaceRole[workspaceSessionKey('ws-1', 'role-a')]).toBeUndefined()
  })

  it('重置后清空全部记忆', () => {
    setRoleSidebarTab('history')
    setWorkspaceSidebarTab('session')
    rememberRoleId('role-a')
    rememberRoleSession('role-a', 'chat-a1')
    rememberWorkspaceId('ws-1')
    rememberWorkspaceRole('ws-1', 'role-a')
    rememberWorkspaceSession('ws-1', 'role-a', 'chat-a1')
    resetSidebarNavigationMemory()
    expect(getSidebarNavigationMemory()).toEqual({
      role: { tab: 'roles', roleId: '', sessionByRole: {} },
      workspace: { tab: 'workspaces', workspaceId: '', roleByWorkspace: {}, sessionByWorkspaceRole: {} },
    })
  })
})
