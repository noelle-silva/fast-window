import { describe, expect, it } from 'vitest'
import {
  isWorkspaceRoleRegistered,
  workspaceRegisteredRoleIds,
  workspaceRolesInScope,
} from './workspaceRoleScope'

const roles = [
  { id: 'role-a', name: 'A' },
  { id: 'role-b', name: 'B' },
  { id: 'role-c', name: 'C' },
]

describe('工作区角色范围', () => {
  it('只保留工作区清单中仍然存在的角色，并自动去重', () => {
    const workspace = { registeredRoleIds: ['role-c', 'role-a', 'role-c', 'role-gone', ''] }

    expect(workspaceRegisteredRoleIds(workspace)).toEqual(['role-c', 'role-a', 'role-gone'])
    expect(workspaceRolesInScope(workspace, roles).map((role: any) => role.id)).toEqual(['role-a', 'role-c'])
  })

  it('判断角色是否在工作区清单内', () => {
    const workspace = { registeredRoleIds: ['role-b'] }

    expect(isWorkspaceRoleRegistered(workspace, 'role-b')).toBe(true)
    expect(isWorkspaceRoleRegistered(workspace, 'role-a')).toBe(false)
    expect(isWorkspaceRoleRegistered(workspace, '')).toBe(false)
  })

})
