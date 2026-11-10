import { describe, expect, it } from 'vitest'
import {
  missingSessionRefScopes,
  sessionRefBox,
  sessionRefHasFacts,
  sessionRefIdentity,
  sessionRefScopes,
} from './sessionRefScope'

function dataOf(overrides: Record<string, any> = {}) {
  return {
    chatsByRole: { 'role-a': { chatMetas: [{ id: 'chat-a', title: '甲会话' }] } },
    chatsByGroup: { 'group-a': { chatMetas: [{ id: 'chat-g', title: '群会话' }] } },
    chatsByWorkspace: { 'ws-1::role-b': { chatMetas: [{ id: 'chat-w', title: '工作区会话' }] } },
    ...overrides,
  }
}

describe('会话引用的统一寻址', () => {
  it('工作区必须两段身份齐全才算有效引用', () => {
    expect(sessionRefIdentity({ targetKind: 'workspace', targetId: 'ws-1', chatId: 'c1' })).toBeNull()
    expect(sessionRefIdentity({ targetKind: 'workspace', targetId: 'ws-1', roleId: 'role-b', chatId: 'c1' })).toEqual({
      targetKind: 'workspace',
      targetId: 'ws-1',
      roleId: 'role-b',
      chatId: 'c1',
    })
  })

  it('按目标类型落到各自的盒子，工作区用合成键', () => {
    const data = dataOf()
    const roleRef = sessionRefIdentity({ targetKind: 'role', targetId: 'role-a', chatId: 'chat-a' })!
    const wsRef = sessionRefIdentity({ targetKind: 'workspace', targetId: 'ws-1', roleId: 'role-b', chatId: 'chat-w' })!
    expect(sessionRefBox(data, roleRef)).toBe(data.chatsByRole['role-a'])
    expect(sessionRefBox(data, wsRef)).toBe(data.chatsByWorkspace['ws-1::role-b'])
    expect(sessionRefHasFacts(data, roleRef)).toBe(true)
    expect(sessionRefHasFacts(data, wsRef)).toBe(true)
  })

  it('引用指向的会话不在盒子里时判定为没有事实', () => {
    const ref = sessionRefIdentity({ targetKind: 'workspace', targetId: 'ws-9', roleId: 'role-z', chatId: 'chat-z' })!
    expect(sessionRefHasFacts(dataOf(), ref)).toBe(false)
  })

  it('一批引用折成去重后的索引 scope，同一组合只算一次', () => {
    const scopes = sessionRefScopes([
      { targetKind: 'role', targetId: 'role-a', chatId: 'chat-a' },
      { targetKind: 'workspace', targetId: 'ws-1', roleId: 'role-b', chatId: 'chat-w' },
      { targetKind: 'workspace', targetId: 'ws-1', roleId: 'role-b', chatId: 'chat-w2' },
    ])
    expect(scopes).toEqual([
      { kind: 'role', targetId: 'role-a' },
      { kind: 'workspace', targetId: 'ws-1::role-b' },
    ])
  })

  it('已有事实的组合不进入待补清单', () => {
    const scopes = missingSessionRefScopes(dataOf(), [
      { targetKind: 'role', targetId: 'role-a', chatId: 'chat-a' },
      { targetKind: 'workspace', targetId: 'ws-9', roleId: 'role-z', chatId: 'chat-z' },
    ])
    expect(scopes).toEqual([{ kind: 'workspace', targetId: 'ws-9::role-z' }])
  })
})
