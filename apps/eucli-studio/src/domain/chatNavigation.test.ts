import { describe, expect, it } from 'vitest'
import { activeChatTargetKey, resolveActiveChatNav } from './chatNavigation'

describe('activeChatTargetKey', () => {
  it('角色与群组直接用自身 id', () => {
    expect(activeChatTargetKey('role', { roleId: 'role-1' })).toBe('role-1')
    expect(activeChatTargetKey('group', { groupId: 'group-1' })).toBe('group-1')
  })

  it('工作区用「工作区::角色」复合键', () => {
    expect(activeChatTargetKey('workspace', { workspaceId: 'ws-1', roleId: 'role-1' })).toBe('ws-1::role-1')
    expect(activeChatTargetKey('workspace', { workspaceId: 'ws-1', roleId: '' })).toBe('')
  })
})

describe('resolveActiveChatNav', () => {
  const data = {
    chatsByRole: { 'role-1': { activeChatId: 'r1', chats: [{ id: 'r1' }, { id: 'r2' }] } },
    chatsByGroup: { 'group-1': { activeChatId: 'g2', chats: [{ id: 'g1' }, { id: 'g2' }] } },
    chatsByWorkspace: {
      'ws-1::role-a': { activeChatId: 'c2', chats: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] },
    },
  }

  it('工作区按复合键取会话箱，历史切换可用（回归：曾用纯工作区 id 查空导致按钮恒灰）', () => {
    const nav = resolveActiveChatNav({
      loading: false,
      kind: 'workspace',
      workspaceId: 'ws-1',
      roleId: 'role-a',
      data,
      state: {},
      activeChat: { id: 'c2' },
    })
    expect(nav.lockedReason).toBe('')
    expect(nav.olderId).toBe('c3')
    expect(nav.newerId).toBe('c1')
  })

  it('角色按自身 id 取会话箱', () => {
    const nav = resolveActiveChatNav({ loading: false, kind: 'role', roleId: 'role-1', data, state: {}, activeChat: { id: 'r1' } })
    expect(nav.lockedReason).toBe('')
    expect(nav.olderId).toBe('r2')
    expect(nav.newerId).toBe('')
  })

  it('未选择目标时给出守卫原因', () => {
    expect(resolveActiveChatNav({ loading: false, kind: 'workspace', data, state: {}, activeChat: null }).lockedReason).toBe('请先选择工作区')
    expect(resolveActiveChatNav({ loading: false, kind: 'role', data, state: {}, activeChat: null }).lockedReason).toBe('请先选择角色')
  })
})
