import { describe, expect, it } from 'vitest'
import { SESSION_KEEP_ALIVE_LIMIT, touchSessionKeepAliveOrder } from './sessionKeepAlive'

describe('session keep alive order', () => {
  it('keeps at most five recently opened session pages', () => {
    let order: string[] = []
    for (const key of ['s1', 's2', 's3', 's4', 's5']) {
      order = touchSessionKeepAliveOrder(order, key)
    }
    expect(SESSION_KEEP_ALIVE_LIMIT).toBe(5)
    expect(order).toEqual(['s5', 's4', 's3', 's2', 's1'])

    order = touchSessionKeepAliveOrder(order, 's6')
    expect(order).toEqual(['s6', 's5', 's4', 's3', 's2'])
  })

  it('touches an already resident session without growing the cache', () => {
    const order = touchSessionKeepAliveOrder(['s3', 's2', 's1'], 's1')
    expect(order).toEqual(['s1', 's3', 's2'])
  })

  it('evicts the least recently used page after a cached session is touched', () => {
    let order = ['s5', 's4', 's3', 's2', 's1']
    order = touchSessionKeepAliveOrder(order, 's1')
    order = touchSessionKeepAliveOrder(order, 's6')
    expect(order).toEqual(['s6', 's1', 's5', 's4', 's3'])
  })

  it('ignores blank keys and duplicate entries', () => {
    expect(touchSessionKeepAliveOrder(['s1', 's1', '', 's2'], '  ')).toEqual(['s1', 's2'])
  })

  it('honors a custom limit', () => {
    let order: string[] = []
    for (const key of ['a', 'b', 'c']) order = touchSessionKeepAliveOrder(order, key, 2)
    expect(order).toEqual(['c', 'b'])
  })
})
