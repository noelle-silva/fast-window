import { describe, expect, it } from 'vitest'
import { createSessionWriteGuard, sessionWriteKey } from './sessionWriteGuard'

describe('SessionWriteGuard', () => {
  it('删除会话之后，旧令牌失效；删除之后捕获的新令牌仍然有效', () => {
    const guard = createSessionWriteGuard()
    const before = guard.capture('role', 'role-1', 'chat-1')

    guard.invalidateSession('role', 'role-1', 'chat-1')

    expect(guard.isCurrent(before)).toBe(false)
    expect(guard.isCurrent(guard.capture('role', 'role-1', 'chat-1'))).toBe(true)
  })

  it('删除 target 只作废该 target 下的所有会话', () => {
    const guard = createSessionWriteGuard()
    const targetSession = guard.capture('group', 'group-1', 'chat-1')
    const otherSession = guard.capture('group', 'group-2', 'chat-1')

    guard.invalidateTarget('group', 'group-1')

    expect(guard.isCurrent(targetSession)).toBe(false)
    expect(guard.isCurrent(otherSession)).toBe(true)
  })

  it('删除工作区作废该工作区下所有角色组合', () => {
    const guard = createSessionWriteGuard()
    const workspaceRoleA = guard.capture('workspace', 'ws-1::role-a', 'chat-1')
    const workspaceRoleB = guard.capture('workspace', 'ws-1::role-b', 'chat-2')
    const otherWorkspace = guard.capture('workspace', 'ws-2::role-a', 'chat-1')

    guard.invalidateWorkspace('ws-1')

    expect(guard.isCurrent(workspaceRoleA)).toBe(false)
    expect(guard.isCurrent(workspaceRoleB)).toBe(false)
    expect(guard.isCurrent(otherWorkspace)).toBe(true)
  })

  it('key 包含完整会话身份，不会与其它 target 撞键', () => {
    expect(sessionWriteKey('role', 'role:1', 'chat:1')).not.toBe(sessionWriteKey('group', 'role:1', 'chat:1'))
    expect(sessionWriteKey('role', 'role-1', 'chat-1')).not.toBe(sessionWriteKey('role', 'role-1', 'chat-2'))
  })
})
