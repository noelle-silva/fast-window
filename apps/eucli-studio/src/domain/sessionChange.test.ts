import { describe, expect, it } from 'vitest'
import { normalizeSessionChange, sessionChangeViewTarget } from './sessionChange'

function event(overrides: Record<string, any> = {}) {
  return {
    targetKind: 'message',
    location: { kind: 'role', roleId: 'role-1', groupId: '', workspaceId: '', sessionId: 'chat-1' },
    changeType: 'message_added',
    version: 3,
    occurredAt: '2026-06-03T10:00:00.000Z',
    ...overrides,
  }
}

describe('normalizeSessionChange', () => {
  it('接受完整自洽的会话变更', () => {
    const change = normalizeSessionChange(event())
    expect(change).not.toBeNull()
    expect(change?.version).toBe(3)
    expect(change?.location.roleId).toBe('role-1')
  })

  it('版本非正、目标与变更类型矛盾、定位不完整时拒绝', () => {
    expect(normalizeSessionChange(event({ version: 0 }))).toBeNull()
    expect(normalizeSessionChange(event({ targetKind: 'session' }))).toBeNull()
    expect(normalizeSessionChange(event({
      location: { kind: 'group', roleId: 'role-1', groupId: '', workspaceId: '', sessionId: 'chat-1' },
    }))).toBeNull()
    expect(normalizeSessionChange(event({ occurredAt: '' }))).toBeNull()
  })

  it('会话持久化事件必须指向 session，而不是 message', () => {
    expect(normalizeSessionChange(event({ changeType: 'session_persisted' }))).toBeNull()
    const persisted = normalizeSessionChange(event({ targetKind: 'session', changeType: 'session_persisted' }))
    expect(persisted?.targetKind).toBe('session')
  })
})

describe('sessionChangeViewTarget', () => {
  it('角色与群聊会话映射到视窗地址', () => {
    expect(sessionChangeViewTarget(normalizeSessionChange(event())!)).toEqual({
      kind: 'role',
      targetId: 'role-1',
      chatId: 'chat-1',
    })
    const group = normalizeSessionChange(event({
      location: { kind: 'group', roleId: '', groupId: 'group-1', workspaceId: '', sessionId: 'chat-2' },
    }))!
    expect(sessionChangeViewTarget(group)).toEqual({ kind: 'group', targetId: 'group-1', chatId: 'chat-2' })
  })

  it('工作区会话映射到 workspaceId + roleId 的组合地址', () => {
    const workspace = normalizeSessionChange(event({
      location: { kind: 'workspace', roleId: 'role-1', groupId: '', workspaceId: 'ws-1', sessionId: 'chat-1' },
    }))!
    expect(sessionChangeViewTarget(workspace)).toEqual({
      kind: 'workspace',
      targetId: 'ws-1::role-1',
      workspaceId: 'ws-1',
      roleId: 'role-1',
      chatId: 'chat-1',
    })
  })
})
