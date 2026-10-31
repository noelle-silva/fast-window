import { describe, expect, it } from 'vitest'
import {
  findEbRoleRunCard,
  isRunSettled,
  registerEbRoleRunCard,
  removeEbRoleRunCard,
  updateEbRoleRunCard,
} from './activeRunCards'

// 回归：运行卡只有「出生 / 更新 / 死亡」三个职责互斥的原语。
//
// 现场故障：任意事件都能 upsert 建卡，内容载荷里的消息 id / 工具计划 id
// 被写成运行身份，真实终态销不掉，停止按钮与占位永久残留。

function createState(): any {
  return { activeRunCards: [], settledRuns: {} }
}

describe('运行卡生命周期原语', () => {
  it('register 是唯一的出生出口', () => {
    const state = createState()
    const card = registerEbRoleRunCard(state, { runId: 'run-1', roleId: 'role-1', sessionId: 'chat-1', status: 'running' })
    expect(card?.runId).toBe('run-1')
    expect(findEbRoleRunCard(state, 'run-1')).not.toBeNull()
  })

  it('update 没有出生权：卡不存在就丢弃，绝不补建', () => {
    const state = createState()
    const card = updateEbRoleRunCard(state, {
      runId: '01a192929b3001c78cc9db2263cbf862',
      roleId: 'role-1',
      sessionId: 'chat-1',
      status: 'running',
    })
    expect(card).toBeNull()
    expect(state.activeRunCards).toHaveLength(0)
  })

  it('update 只改已存在的卡，身份不变', () => {
    const state = createState()
    registerEbRoleRunCard(state, { runId: 'run-1', roleId: 'role-1', sessionId: 'chat-1', status: 'running', lastMessageId: 'm1' })
    const next = updateEbRoleRunCard(state, { runId: 'run-1', lastMessageId: 'm2', status: 'running' })
    expect(next?.runId).toBe('run-1')
    expect(next?.lastMessageId).toBe('m2')
    expect(next?.createdAt).toBe(findEbRoleRunCard(state, 'run-1')?.createdAt)
    expect(state.activeRunCards).toHaveLength(1)
  })

  it('终态补丁通过 register 时摘卡并登记终态闩锁', () => {
    const state = createState()
    registerEbRoleRunCard(state, { runId: 'run-1', roleId: 'role-1', sessionId: 'chat-1', status: 'running' })
    expect(registerEbRoleRunCard(state, { runId: 'run-1', status: 'completed' })).toBeNull()
    expect(state.activeRunCards).toHaveLength(0)
    expect(isRunSettled(state, 'run-1')).toBe(true)
  })

  it('终态补丁通过 update 时同样摘卡并登记终态闩锁', () => {
    const state = createState()
    registerEbRoleRunCard(state, { runId: 'run-1', roleId: 'role-1', sessionId: 'chat-1', status: 'running' })
    expect(updateEbRoleRunCard(state, { runId: 'run-1', status: 'failed' })).toBeNull()
    expect(state.activeRunCards).toHaveLength(0)
    expect(isRunSettled(state, 'run-1')).toBe(true)
  })

  it('终态之后 register / update 都不会复活卡片', () => {
    const state = createState()
    registerEbRoleRunCard(state, { runId: 'run-1', roleId: 'role-1', sessionId: 'chat-1', status: 'running' })
    removeEbRoleRunCard(state, 'run-1')

    expect(registerEbRoleRunCard(state, { runId: 'run-1', roleId: 'role-1', sessionId: 'chat-1', status: 'running' })).toBeNull()
    expect(updateEbRoleRunCard(state, { runId: 'run-1', status: 'running' })).toBeNull()
    expect(state.activeRunCards).toHaveLength(0)
  })

  it('remove 登记终态闩锁并摘卡', () => {
    const state = createState()
    registerEbRoleRunCard(state, { runId: 'run-1', roleId: 'role-1', sessionId: 'chat-1', status: 'running' })
    expect(removeEbRoleRunCard(state, 'run-1')?.runId).toBe('run-1')
    expect(isRunSettled(state, 'run-1')).toBe(true)
    expect(state.activeRunCards).toHaveLength(0)
  })
})
