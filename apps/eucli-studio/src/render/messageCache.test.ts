import { describe, expect, it } from 'vitest'
import {
  ENGINE_VERSION,
  createMessageCache,
  hash64,
  messageCacheKey,
} from './messageCache'

describe('message html cache', () => {
  it('builds a key that separates source, policy, caps and scope', () => {
    const base = messageCacheKey({ source: 'a', policy: 'original', capsSignature: 'c1', scope: 's1' })
    expect(base).toContain(`v${ENGINE_VERSION}`)
    expect(base).not.toBe(messageCacheKey({ source: 'a', policy: 'unsafe', capsSignature: 'c1', scope: 's1' }))
    expect(base).not.toBe(messageCacheKey({ source: 'a', policy: 'original', capsSignature: 'c2', scope: 's1' }))
    expect(base).not.toBe(messageCacheKey({ source: 'a', policy: 'original', capsSignature: 'c1', scope: 's2' }))
    expect(base).not.toBe(messageCacheKey({ source: 'b', policy: 'original', capsSignature: 'c1', scope: 's1' }))
  })

  it('hashes equal content to equal fingerprints', () => {
    expect(hash64('同一段内容')).toBe(hash64('同一段内容'))
    expect(hash64('a')).not.toBe(hash64('b'))
  })

  it('returns stable block arrays on hit', () => {
    const cache = createMessageCache()
    const key = messageCacheKey({ source: 's', policy: 'original', capsSignature: 'c', scope: 'chat-1' })
    cache.put(key, ['<p>a</p>', '<p>b</p>'], 'chat-1')
    expect(cache.get(key)).toEqual(['<p>a</p>', '<p>b</p>'])
    expect(cache.size).toBe(1)
  })

  it('evicts by entry count', () => {
    const cache = createMessageCache({ maxEntries: 2, maxBytes: 1024 })
    for (let i = 0; i < 5; i++) {
      const key = messageCacheKey({ source: `s${i}`, policy: 'original', capsSignature: 'c', scope: 'chat-1' })
      cache.put(key, [`<p>${i}</p>`], 'chat-1')
    }
    expect(cache.size).toBe(2)
  })

  it('evicts by byte budget even when entry count is low', () => {
    const cache = createMessageCache({ maxEntries: 300, maxBytes: 100 })
    const big = 'x'.repeat(80)
    const keyA = messageCacheKey({ source: 'a', policy: 'original', capsSignature: 'c', scope: 'chat-1' })
    const keyB = messageCacheKey({ source: 'b', policy: 'original', capsSignature: 'c', scope: 'chat-1' })
    cache.put(keyA, [big], 'chat-1')
    cache.put(keyB, [big], 'chat-1')
    // 两条合计 160 字节 > 100，必须淘汰到只剩一条。
    expect(cache.size).toBe(1)
    expect(cache.bytes).toBeLessThanOrEqual(100)
  })

  it('refuses entries larger than the whole budget', () => {
    const cache = createMessageCache({ maxEntries: 10, maxBytes: 50 })
    const key = messageCacheKey({ source: 'huge', policy: 'original', capsSignature: 'c', scope: 'chat-1' })
    cache.put(key, ['x'.repeat(200)], 'chat-1')
    expect(cache.size).toBe(0)
  })

  it('invalidates only the given scope', () => {
    const cache = createMessageCache()
    const keyA = messageCacheKey({ source: 'a', policy: 'original', capsSignature: 'c', scope: 'chat-1' })
    const keyB = messageCacheKey({ source: 'b', policy: 'original', capsSignature: 'c', scope: 'chat-2' })
    cache.put(keyA, ['<p>a</p>'], 'chat-1')
    cache.put(keyB, ['<p>b</p>'], 'chat-2')
    expect(cache.size).toBe(2)

    cache.invalidateScope('chat-1')
    expect(cache.get(keyA)).toBeNull()
    expect(cache.get(keyB)).toEqual(['<p>b</p>'])
  })

  it('drops everything on a global generation bump', () => {
    const cache = createMessageCache()
    const key = messageCacheKey({ source: 's', policy: 'original', capsSignature: 'c', scope: 'chat-1' })
    cache.put(key, ['<p>a</p>'], 'chat-1')
    cache.bumpGeneration()
    expect(cache.size).toBe(0)
    expect(cache.get(key)).toBeNull()
  })

  it('does not cache empty block lists', () => {
    const cache = createMessageCache()
    cache.put('k', [], 'chat-1')
    expect(cache.size).toBe(0)
  })
})
