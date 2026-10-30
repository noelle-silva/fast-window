import { describe, expect, it } from 'vitest'
import {
  SWITCH_FIXTURES,
  buildChatIndex,
  buildSessionMessages,
  chatId,
  fixtureByName,
  messageId,
  roleId,
} from './switchFixtures'
import { normalizeChatIndexSnapshot, projectionScopeKey } from './splitProjectionCache'

describe('switch fixtures', () => {
  it('六个场景齐备', () => {
    expect(SWITCH_FIXTURES.map((fixture) => fixture.name).sort()).toEqual([
      'deleted-offline',
      'long-session',
      'many-roles',
      'orphan-index',
      'same-timestamp',
      'stale-active',
    ])
  })

  it('未知 fixture 快速失败', () => {
    expect(() => fixtureByName('nope')).toThrow(/未知 fixture/)
  })

  it('many-roles 角色数 ×4 场景规模正确', () => {
    const fixture = fixtureByName('many-roles')
    expect(fixture.roleCount).toBe(32)
    expect(roleId(0)).toBe('role-0000')
    expect(roleId(31)).toBe('role-0031')
    expect(chatId(0, 0)).toBe('r0000-c0000')
  })

  it('long-session 消息数足以触发多页', () => {
    const fixture = fixtureByName('long-session')
    const messages = buildSessionMessages(fixture, 0, 0)
    expect(messages).toHaveLength(600)
    // 远超窗口默认 limit（24）。
    expect(messages.length).toBeGreaterThan(24 * 10)
  })

  it('消息链首条无父，后续逐条相连', () => {
    const fixture = fixtureByName('many-roles')
    const messages = buildSessionMessages(fixture, 0, 0)
    expect(messages[0].parentMessageId).toBe('')
    expect(messages[1].parentMessageId).toBe(messageId(0, 0, 0))
    expect(messages[2].parentMessageId).toBe(messageId(0, 0, 1))
  })

  it('same-timestamp 场景所有消息共享 createdAt', () => {
    const fixture = fixtureByName('same-timestamp')
    const messages = buildSessionMessages(fixture, 0, 0)
    const timestamps = new Set(messages.map((message) => message.createdAt))
    expect(timestamps.size).toBe(1)
  })

  it('orphan-index 场景索引里含不存在的会话 id', () => {
    const fixture = fixtureByName('orphan-index')
    const index = buildChatIndex(fixture, 0)
    expect(index.chatIds).toContain('ghost-1')
    expect(index.chatIds).toContain('ghost-2')
    // 正常会话仍然完整。
    expect(index.chatIds).toContain(chatId(0, 0))
  })

  it('orphan 索引经归一后仍保留（由上层决定如何过滤）', () => {
    const fixture = fixtureByName('orphan-index')
    const index = buildChatIndex(fixture, 0)
    const snapshot = normalizeChatIndexSnapshot(index, { kind: 'role', targetId: 'role-0000' })
    expect(snapshot?.scope).toBe(projectionScopeKey({ kind: 'role', targetId: 'role-0000' }))
    expect(snapshot?.chatIds).toContain('ghost-1')
  })

  it('stale-active 场景的 activeChatId 不在会话集合内', () => {
    const fixture = fixtureByName('stale-active')
    const index = buildChatIndex(fixture, 0)
    expect(index.chatIds).not.toContain(fixture.staleActiveChatId)
  })
})
