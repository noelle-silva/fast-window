import { describe, expect, it, vi } from 'vitest'
import {
  ebRoleRunCardShapeKey,
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

// 结构版本契约：对象身份就是版本。
//
// 这三条不变量是「流式推进不惊动整棵界面」的地基：
//   读路径不重建、写路径结构等价不落地、结构签名忽略心跳时间。
describe('运行卡的结构版本', () => {
  it('读路径不重建卡片：连续两次读取拿到同一个对象', () => {
    const state = createState()
    registerEbRoleRunCard(state, { runId: 'run-1', roleId: 'role-1', sessionId: 'chat-1', status: 'running' })
    const first = findEbRoleRunCard(state, 'run-1')
    const second = findEbRoleRunCard(state, 'run-1')
    expect(first).not.toBeNull()
    expect(second).toBe(first)
  })

  it('结构相同的 update 不产生新版本：对象、集合元素与 updatedAt 全部保持原样', () => {
    const state = createState()
    const created = registerEbRoleRunCard(state, {
      runId: 'run-1',
      roleId: 'role-1',
      sessionId: 'chat-1',
      status: 'running',
      inputMessageId: 'u1',
      lastMessageId: 'm2',
      anchorMessageId: 'u1',
      stream: true,
    })
    const before = state.activeRunCards[0]
    // 流式推进：同一份结构事实又到了一次（状态、目标消息、stream 都没变）。
    const again = updateEbRoleRunCard(state, {
      runId: 'run-1',
      roleId: 'role-1',
      sessionId: 'chat-1',
      status: 'running',
      inputMessageId: 'u1',
      lastMessageId: 'm2',
      anchorMessageId: 'u1',
      stream: true,
    })
    expect(again).toBe(before)
    expect(state.activeRunCards[0]).toBe(before)
    expect(again?.updatedAt).toBe(created?.updatedAt)
  })

  it('结构变化的 update 换对象并推进 updatedAt', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000)
      const state = createState()
      const created = registerEbRoleRunCard(state, {
        runId: 'run-1',
        roleId: 'role-1',
        sessionId: 'chat-1',
        status: 'running',
        lastMessageId: 'm2',
      })
      vi.setSystemTime(2_000)
      const next = updateEbRoleRunCard(state, { runId: 'run-1', lastMessageId: 'm3' })
      expect(next).not.toBe(created)
      expect(next?.lastMessageId).toBe('m3')
      expect(next?.updatedAt).toBe(2_000)
      expect(created?.updatedAt).toBe(1_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('结构相同的 register 重放不替换对象', () => {
    const state = createState()
    const patch = { runId: 'run-1', roleId: 'role-1', sessionId: 'chat-1', status: 'running' }
    const first = registerEbRoleRunCard(state, patch)
    const second = registerEbRoleRunCard(state, patch)
    expect(second).toBe(first)
    expect(state.activeRunCards).toHaveLength(1)
  })

  it('结构签名忽略 updatedAt，只认结构字段', () => {
    const base = { kind: 'eb-role-run', runId: 'run-1', status: 'running', createdAt: 1, updatedAt: 1 } as any
    expect(ebRoleRunCardShapeKey({ ...base, updatedAt: 999 })).toBe(ebRoleRunCardShapeKey(base))
    expect(ebRoleRunCardShapeKey({ ...base, lastMessageId: 'm2' })).not.toBe(ebRoleRunCardShapeKey(base))
  })
})
