import { describe, expect, it, vi } from 'vitest'
import { chatBodyKey, createChatBodyLoader } from './chatBodyLoader'

function chatWithMessages(id: string, count = 2) {
  return {
    id,
    title: `会话 ${id}`,
    messages: Array.from({ length: count }, (_value, index) => ({
      id: `${id}-m${index}`,
      content: 'x'.repeat(100),
    })),
  }
}

describe('ChatBodyLoader', () => {
  it('同一会话并发加载只请求一次（单飞）', async () => {
    const load = vi.fn(async (_scope: any, chatId: string) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return chatWithMessages(chatId)
    })
    const loader = createChatBodyLoader({ load })
    const scope = { kind: 'role' as const, targetId: 'role-1' }

    const results = await Promise.all([1, 2, 3, 4].map(() => loader.load(scope, 'chat-1')))
    expect(load).toHaveBeenCalledTimes(1)
    for (const result of results) expect(result.id).toBe('chat-1')
  })

  it('缓存命中不再请求，peek 可直接取到', async () => {
    const load = vi.fn(async (_scope: any, chatId: string) => chatWithMessages(chatId))
    const loader = createChatBodyLoader({ load })
    const scope = { kind: 'role' as const, targetId: 'role-1' }

    await loader.load(scope, 'chat-1')
    await loader.load(scope, 'chat-1')
    expect(load).toHaveBeenCalledTimes(1)
    expect(loader.peek(scope, 'chat-1')?.id).toBe('chat-1')
  })

  it('不同 scope 的同一 chatId 各自独立', async () => {
    const load = vi.fn(async (scope: any, chatId: string) => chatWithMessages(`${scope.targetId}:${chatId}`))
    const loader = createChatBodyLoader({ load })

    const a = await loader.load({ kind: 'role', targetId: 'role-1' }, 'chat-1')
    const b = await loader.load({ kind: 'group', targetId: 'group-1' }, 'chat-1')
    expect(a.id).toBe('role-1:chat-1')
    expect(b.id).toBe('group-1:chat-1')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('条目上限生效，最久未用先淘汰', async () => {
    const load = vi.fn(async (_scope: any, chatId: string) => chatWithMessages(chatId))
    const loader = createChatBodyLoader({ load, maxEntries: 2 })
    const scope = { kind: 'role' as const, targetId: 'role-1' }

    await loader.load(scope, 'chat-1')
    await loader.load(scope, 'chat-2')
    // 触碰 chat-1，让 chat-2 变成最久未用。
    loader.peek(scope, 'chat-1')
    await loader.load(scope, 'chat-3')

    expect(loader.peek(scope, 'chat-1')).not.toBeNull()
    expect(loader.peek(scope, 'chat-2')).toBeNull()
    expect(loader.peek(scope, 'chat-3')).not.toBeNull()
    expect(loader.stats().entries).toBe(2)
  })

  it('字节预算生效：大对象挤掉小对象', async () => {
    const load = vi.fn(async (_scope: any, chatId: string) => chatWithMessages(chatId, 1))
    // 预算只够放一个大对象：按条数会被单条大会话击穿，所以字节预算必须同时生效。
    const loader = createChatBodyLoader({
      load,
      maxEntries: 10,
      maxBytes: 95 * 1024,
      estimateBytes: (chat: any) => (chat.id === 'big' ? 90 * 1024 : 10 * 1024),
    })
    const scope = { kind: 'role' as const, targetId: 'role-1' }

    await loader.load(scope, 'small')
    await loader.load(scope, 'big')
    expect(loader.stats().bytes).toBeLessThanOrEqual(95 * 1024)
    expect(loader.peek(scope, 'small')).toBeNull()
    expect(loader.peek(scope, 'big')).not.toBeNull()
  })

  it('单条超过总预算的会话不进缓存（收益为负）', async () => {
    const load = vi.fn(async (_scope: any, chatId: string) => chatWithMessages(chatId, 1))
    const loader = createChatBodyLoader({
      load,
      maxBytes: 64 * 1024,
      estimateBytes: () => 200 * 1024,
    })
    const scope = { kind: 'role' as const, targetId: 'role-1' }

    const chat = await loader.load(scope, 'huge')
    expect(chat.id).toBe('huge')
    expect(loader.peek(scope, 'huge')).toBeNull()
  })

  it('invalidate 让下一次读取重新请求', async () => {
    const load = vi.fn(async (_scope: any, chatId: string) => chatWithMessages(chatId))
    const loader = createChatBodyLoader({ load })
    const scope = { kind: 'role' as const, targetId: 'role-1' }

    await loader.load(scope, 'chat-1')
    loader.invalidate(scope, 'chat-1')
    await loader.load(scope, 'chat-1')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('invalidateScope 只清该 scope', async () => {
    const load = vi.fn(async (_scope: any, chatId: string) => chatWithMessages(chatId))
    const loader = createChatBodyLoader({ load })
    await loader.load({ kind: 'role', targetId: 'role-1' }, 'chat-1')
    await loader.load({ kind: 'role', targetId: 'role-2' }, 'chat-1')

    loader.invalidateScope({ kind: 'role', targetId: 'role-1' })
    expect(loader.peek({ kind: 'role', targetId: 'role-1' }, 'chat-1')).toBeNull()
    expect(loader.peek({ kind: 'role', targetId: 'role-2' }, 'chat-1')).not.toBeNull()
  })

  it('失败不缓存：下一次会重试', async () => {
    let attempts = 0
    const load = vi.fn(async (_scope: any, chatId: string) => {
      attempts += 1
      if (attempts === 1) throw new Error('读取失败')
      return chatWithMessages(chatId)
    })
    const loader = createChatBodyLoader({ load })
    const scope = { kind: 'role' as const, targetId: 'role-1' }

    await expect(loader.load(scope, 'chat-1')).rejects.toThrow('读取失败')
    const chat = await loader.load(scope, 'chat-1')
    expect(chat.id).toBe('chat-1')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('chatBodyKey 含 scope，避免跨 target 撞键', () => {
    expect(chatBodyKey({ kind: 'role', targetId: 'r1' }, 'c1')).toBe('role:r1:c1')
    expect(chatBodyKey({ kind: 'group', targetId: 'r1' }, 'c1')).toBe('group:r1:c1')
  })

  it('失效打断在途读取：旧结果不回填缓存', async () => {
    let release: (value: any) => void = () => {}
    const pending = new Promise((resolve) => {
      release = resolve
    })
    let calls = 0
    const loader = createChatBodyLoader({
      load: async () => {
        calls += 1
        if (calls === 1) return pending
        return chatWithMessages('chat-1')
      },
    })
    const scope = { kind: 'role' as const, targetId: 'role-1' }

    const inFlight = loader.load(scope, 'chat-1')
    loader.invalidate(scope, 'chat-1')
    release(chatWithMessages('chat-1'))
    await inFlight

    expect(loader.peek(scope, 'chat-1')).toBeNull()
  })

  it('失效之后新的 load 不复用旧代在途请求', async () => {
    let releaseFirst: (value: any) => void = () => {}
    const firstPending = new Promise((resolve) => {
      releaseFirst = resolve
    })
    let calls = 0
    const loader = createChatBodyLoader({
      load: async () => {
        calls += 1
        if (calls === 1) return firstPending
        return chatWithMessages('chat-1')
      },
    })
    const scope = { kind: 'role' as const, targetId: 'role-1' }

    const first = loader.load(scope, 'chat-1')
    loader.invalidate(scope, 'chat-1')
    const second = loader.load(scope, 'chat-1')
    releaseFirst(chatWithMessages('chat-1'))

    await Promise.all([first, second])
    expect(calls).toBe(2)
  })

  it('clear 同样打断在途读取，旧结果不回填', async () => {
    let release: (value: any) => void = () => {}
    const pending = new Promise((resolve) => {
      release = resolve
    })
    let calls = 0
    const loader = createChatBodyLoader({
      load: async () => {
        calls += 1
        if (calls === 1) return pending
        return chatWithMessages('chat-1')
      },
    })
    const scope = { kind: 'role' as const, targetId: 'role-1' }

    const inFlight = loader.load(scope, 'chat-1')
    loader.clear()
    release(chatWithMessages('chat-1'))
    await inFlight

    expect(loader.peek(scope, 'chat-1')).toBeNull()
    expect(loader.stats().entries).toBe(0)
  })

  it('invalidateScope 也会打断该 scope 的在途读取', async () => {
    let release: (value: any) => void = () => {}
    const pending = new Promise((resolve) => {
      release = resolve
    })
    let calls = 0
    const loader = createChatBodyLoader({
      load: async () => {
        calls += 1
        if (calls === 1) return pending
        return chatWithMessages('chat-1')
      },
    })
    const scope = { kind: 'role' as const, targetId: 'role-1' }

    const inFlight = loader.load(scope, 'chat-1')
    loader.invalidateScope(scope)
    release(chatWithMessages('chat-1'))
    await inFlight

    expect(loader.peek(scope, 'chat-1')).toBeNull()
  })

  it('remember 写入的条目也能被 invalidateScope 清掉', async () => {
    const loader = createChatBodyLoader({ load: async () => null })
    const scope = { kind: 'role' as const, targetId: 'role-1' }
    // 翻页结果回写：这条路径没有经过 load，代数表里可能还没有这个 key。
    loader.remember(scope, 'chat-1', chatWithMessages('chat-1'))
    expect(loader.peek(scope, 'chat-1')).not.toBeNull()

    loader.invalidateScope(scope)
    expect(loader.peek(scope, 'chat-1')).toBeNull()
  })
})
