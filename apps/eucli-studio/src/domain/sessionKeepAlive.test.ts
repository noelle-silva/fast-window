import { describe, expect, it } from 'vitest'
import {
  SESSION_KEEP_ALIVE_LIMIT,
  normalizeSessionKeepAliveLimit,
  touchSessionKeepAliveOrder,
} from './sessionKeepAlive'

describe('session keep alive order', () => {
  it('keeps at most eight recently opened session pages', () => {
    let order: string[] = []
    for (const key of ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']) {
      order = touchSessionKeepAliveOrder(order, key)
    }
    expect(SESSION_KEEP_ALIVE_LIMIT).toBe(8)
    expect(order).toEqual(['s8', 's7', 's6', 's5', 's4', 's3', 's2', 's1'])

    order = touchSessionKeepAliveOrder(order, 's9')
    expect(order).toEqual(['s9', 's8', 's7', 's6', 's5', 's4', 's3', 's2'])
  })

  it('touches an already resident session without growing the cache', () => {
    const order = touchSessionKeepAliveOrder(['s3', 's2', 's1'], 's1')
    expect(order).toEqual(['s1', 's3', 's2'])
  })

  it('evicts the least recently used page after a cached session is touched', () => {
    let order = ['s8', 's7', 's6', 's5', 's4', 's3', 's2', 's1']
    order = touchSessionKeepAliveOrder(order, 's1')
    order = touchSessionKeepAliveOrder(order, 's9')
    expect(order).toEqual(['s9', 's1', 's8', 's7', 's6', 's5', 's4', 's3'])
  })

  it('ignores blank keys and duplicate entries', () => {
    expect(touchSessionKeepAliveOrder(['s1', 's1', '', 's2'], '  ')).toEqual(['s1', 's2'])
  })

  it('honors a custom limit', () => {
    let order: string[] = []
    for (const key of ['a', 'b', 'c']) order = touchSessionKeepAliveOrder(order, key, 2)
    expect(order).toEqual(['c', 'b'])
  })

  it('never evicts the pinned visible page', () => {
    let order: string[] = []
    for (const key of ['s1', 's2', 's3']) order = touchSessionKeepAliveOrder(order, key, 2)
    // s1 是当前可见页：即使它已在尾部，也必须留在栈里当垫底。
    order = touchSessionKeepAliveOrder(order, 's4', 2, 's1')
    expect(order).toEqual(['s4', 's1'])
    expect(order).toContain('s1')
  })

  it('keeps the newly selected page when the limit is 1 (limit=1 + 切换)', () => {
    // 回归：limit=1 时旧实现会顶掉保留区最后一项（正是刚选中的新页），
    // 导致新页永不进 pages → PAINTED 永不发出 → 永久卡在切换中。
    const switched = touchSessionKeepAliveOrder(['A'], 'B', 1, 'A')
    expect(switched).toContain('B')
    expect(switched).toContain('A')
    // 有界：最多超出上限 1 项。
    expect(switched.length).toBeLessThanOrEqual(2)
  })

  it('converges back to the limit once the painted page catches up', () => {
    // 切换完成后 pinned 追平 key：必须收敛回上限，不留持续增长状态。
    const converged = touchSessionKeepAliveOrder(['B', 'A'], 'B', 1, 'B')
    expect(converged).toEqual(['B'])
  })

  it('keeps the selected page even when it is not pinned yet', () => {
    const order = touchSessionKeepAliveOrder(['A', 'B', 'C'], 'D', 2, 'A')
    expect(order).toContain('D')
    expect(order).toContain('A')
    expect(order.length).toBeLessThanOrEqual(3)
  })

  it('normalizes the configured limit', () => {
    expect(normalizeSessionKeepAliveLimit(undefined)).toBe(SESSION_KEEP_ALIVE_LIMIT)
    expect(normalizeSessionKeepAliveLimit(0)).toBe(SESSION_KEEP_ALIVE_LIMIT)
    expect(normalizeSessionKeepAliveLimit('abc')).toBe(SESSION_KEEP_ALIVE_LIMIT)
    expect(normalizeSessionKeepAliveLimit(3)).toBe(3)
    expect(normalizeSessionKeepAliveLimit(999)).toBe(16)
    expect(normalizeSessionKeepAliveLimit(-4)).toBe(SESSION_KEEP_ALIVE_LIMIT)
  })
})
