import { describe, expect, it, vi } from 'vitest'
import { createSessionWindowLoader, mergeWindowPage } from './sessionWindowLoader'

function page(messages: any[], nextCursor = '') {
  return { schemaVersion: 1, id: 'chat-1', messages, nextCursor }
}

function msg(id: string, createdAt: number, extra: Record<string, unknown> = {}) {
  return { id, branchId: 'main', parentMessageId: 'p0', createdAt, content: id, ...extra }
}

const scope = { kind: 'role' as const, targetId: 'role-1' }

function fakeSwitch(pages: any[]) {
  let index = 0
  return {
    hasFeature: () => true,
    sessionWindow: vi.fn(async (_scope: any, _chatId: string, _options?: any) => pages[Math.min(index++, pages.length - 1)]),
  }
}

describe('mergeWindowPage', () => {
  it('dedupes by id and sorts by (createdAt, id)', () => {
    const base = page([msg('m2', 20)])
    const next = page([msg('m1', 10), msg('m2', 20)])
    const merged = mergeWindowPage(base, next)
    expect(merged.messages.map((m: any) => m.id)).toEqual(['m1', 'm2'])
  })

  it('keeps session-level fields from the base document', () => {
    const base = { ...page([msg('m2', 20)]), title: '标题', roleId: 'role-1' }
    const merged = mergeWindowPage(base, page([msg('m1', 10)]))
    expect(merged.title).toBe('标题')
    expect(merged.roleId).toBe('role-1')
  })
})

describe('createSessionWindowLoader', () => {
  it('loads the first window with the configured limit and byte budget', async () => {
    const client = fakeSwitch([page([msg('m1', 1)], 'c2')])
    const loader = createSessionWindowLoader({ sessionSwitch: client })
    const chat = await loader.load(scope, 'chat-1')
    expect(chat.messages).toHaveLength(1)
    expect(client.sessionWindow).toHaveBeenCalledWith(scope, 'chat-1', {
      limit: 24,
      maxBytes: 512 * 1024,
      profile: 'view',
    })
    expect(loader.peek(scope, 'chat-1')?.hasMore).toBe(true)
  })

  it('pages backwards with the opaque cursor and merges results', async () => {
    const client = fakeSwitch([page([msg('m2', 20)], 'c2'), page([msg('m1', 10)], '')])
    const loader = createSessionWindowLoader({ sessionSwitch: client })
    await loader.load(scope, 'chat-1')
    const merged = await loader.loadOlder(scope, 'chat-1')
    expect(merged.messages.map((m: any) => m.id)).toEqual(['m1', 'm2'])
    expect(client.sessionWindow).toHaveBeenLastCalledWith(
      scope,
      'chat-1',
      expect.objectContaining({ cursor: 'c2' }),
    )
    expect(loader.peek(scope, 'chat-1')?.hasMore).toBe(false)
  })

  it('returns the current chat when there is no further page', async () => {
    const client = fakeSwitch([page([msg('m1', 1)], '')])
    const loader = createSessionWindowLoader({ sessionSwitch: client })
    const first = await loader.load(scope, 'chat-1')
    const again = await loader.loadOlder(scope, 'chat-1')
    expect(again).toBe(first)
    expect(client.sessionWindow).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent loads into one request', async () => {
    const client = fakeSwitch([page([msg('m1', 1)], '')])
    const loader = createSessionWindowLoader({ sessionSwitch: client })
    await Promise.all([
      loader.load(scope, 'chat-1'),
      loader.load(scope, 'chat-1'),
      loader.load(scope, 'chat-1'),
    ])
    expect(client.sessionWindow).toHaveBeenCalledTimes(1)
  })

  it('caches the first window until invalidated', async () => {
    const client = fakeSwitch([page([msg('m1', 1)], '')])
    const loader = createSessionWindowLoader({ sessionSwitch: client })
    await loader.load(scope, 'chat-1')
    await loader.load(scope, 'chat-1')
    expect(client.sessionWindow).toHaveBeenCalledTimes(1)

    loader.invalidate(scope, 'chat-1')
    await loader.load(scope, 'chat-1')
    expect(client.sessionWindow).toHaveBeenCalledTimes(2)
  })

  it('fills the session id from the request when the page omits it', async () => {
    const client = fakeSwitch([{ messages: [msg('m1', 1)], nextCursor: '' }])
    const loader = createSessionWindowLoader({ sessionSwitch: client })
    const chat = await loader.load(scope, 'chat-1')
    expect(chat.id).toBe('chat-1')
  })

  it('keeps already loaded history on refresh', async () => {
    const client = fakeSwitch([
      page([msg('m2', 20)], 'c2'),
      page([msg('m1', 10)], ''),
      page([msg('m2', 21)], ''),
    ])
    const loader = createSessionWindowLoader({ sessionSwitch: client })
    await loader.load(scope, 'chat-1')
    await loader.loadOlder(scope, 'chat-1')

    const refreshed = await loader.refresh(scope, 'chat-1')
    expect(refreshed.messages.map((m: any) => m.id)).toEqual(['m1', 'm2'])
    // 已经翻到底，refresh 不应把「还有更多」重新打开。
    expect(loader.peek(scope, 'chat-1')?.hasMore).toBe(false)
  })

  it('rejects when the backend has no window endpoint', async () => {
    const loader = createSessionWindowLoader({
      sessionSwitch: { hasFeature: () => false, sessionWindow: vi.fn() },
    })
    await expect(loader.load(scope, 'chat-1')).rejects.toThrow(/session\.window/)
  })

  it('refresh 以首窗为权威：从首窗删掉的消息不复活', async () => {
    const client = fakeSwitch([
      page([msg('m1', 10), msg('m2', 20)], ''),
      // 写路径删掉了 m2，首窗只剩 m1。
      page([msg('m1', 10)], ''),
    ])
    const loader = createSessionWindowLoader({ sessionSwitch: client })
    expect((await loader.load(scope, 'chat-1')).messages.map((m: any) => m.id)).toEqual(['m1', 'm2'])

    const refreshed = await loader.refresh(scope, 'chat-1')
    expect(refreshed.messages.map((m: any) => m.id)).toEqual(['m1'])
  })

  it('refresh 让编辑后的内容生效（同 id 以新页为准）', async () => {
    const client = fakeSwitch([
      page([msg('m1', 10, { content: '原文' })], ''),
      page([msg('m1', 10, { content: '改后的文本' })], ''),
    ])
    const loader = createSessionWindowLoader({ sessionSwitch: client })
    await loader.load(scope, 'chat-1')

    const refreshed = await loader.refresh(scope, 'chat-1')
    expect(refreshed.messages[0].content).toBe('改后的文本')
  })

  it('refresh 保留严格早于首窗的历史（已翻出的更早窗口不丢）', async () => {
    const client = fakeSwitch([
      page([msg('m3', 30)], 'c2'),
      page([msg('m1', 10), msg('m2', 20)], ''),
      // 写路径之后重取首窗：只给首窗内容。
      page([msg('m3', 31)], ''),
    ])
    const loader = createSessionWindowLoader({ sessionSwitch: client })
    await loader.load(scope, 'chat-1')
    await loader.loadOlder(scope, 'chat-1')
    expect(loader.peek(scope, 'chat-1')?.chat.messages.map((m: any) => m.id)).toEqual(['m1', 'm2', 'm3'])

    const refreshed = await loader.refresh(scope, 'chat-1')
    // 更早的 m1/m2 属于已翻出的历史，必须留下；m3 以新页为准。
    expect(refreshed.messages.map((m: any) => m.id)).toEqual(['m1', 'm2', 'm3'])
  })

  // head 端到端（design-4 决策 3）：首窗必须带 head，表达「用户在看哪条路径」。
  it('首窗请求带上 head（按 head 看路径）', async () => {
    const client = fakeSwitch([page([msg('m1', 1)], 'c2')])
    const loader = createSessionWindowLoader({
      sessionSwitch: client,
      headFor: () => 'm-head',
    })
    await loader.load(scope, 'chat-1')

    expect(client.sessionWindow).toHaveBeenCalledWith(scope, 'chat-1', {
      limit: 24,
      maxBytes: 512 * 1024,
      profile: 'view',
      head: 'm-head',
    })
  })

  it('headFor 返回空串时不带 head（退回业务端默认路径）', async () => {
    const client = fakeSwitch([page([msg('m1', 1)], '')])
    const loader = createSessionWindowLoader({
      sessionSwitch: client,
      headFor: () => '',
    })
    await loader.load(scope, 'chat-1')

    const options = client.sessionWindow.mock.calls[0][2] as any
    expect(options).not.toHaveProperty('head')
  })

  it('翻页只用 cursor，不重复带 head（cursor 已内含 head）', async () => {
    const client = fakeSwitch([page([msg('m2', 20)], 'c2'), page([msg('m1', 10)], '')])
    const loader = createSessionWindowLoader({
      sessionSwitch: client,
      headFor: () => 'm-head',
    })
    await loader.load(scope, 'chat-1')
    await loader.loadOlder(scope, 'chat-1')

    const secondOptions = client.sessionWindow.mock.calls[1][2] as any
    expect(secondOptions.cursor).toBe('c2')
    expect(secondOptions).not.toHaveProperty('head')
  })

  it('refresh 也会重新带上 head（写后重取首窗）', async () => {
    const client = fakeSwitch([page([msg('m1', 1)], 'c2'), page([msg('m1', 1)], 'c2')])
    const loader = createSessionWindowLoader({
      sessionSwitch: client,
      headFor: () => 'm-head',
    })
    await loader.load(scope, 'chat-1')
    await loader.refresh(scope, 'chat-1')

    const refreshOptions = client.sessionWindow.mock.calls[1][2] as any
    expect(refreshOptions.head).toBe('m-head')
  })

  it('authoritative 刷新不带本地 head：后台新增消息不能被旧视窗挡住', async () => {
    const client = fakeSwitch([page([msg('m1', 1)], 'c2'), page([msg('m1', 1), msg('u-new', 2), msg('a-new', 3)], 'c2')])
    const loader = createSessionWindowLoader({
      sessionSwitch: client,
      headFor: () => 'm1',
    })
    await loader.load(scope, 'chat-1')
    const refreshed = await loader.refresh(scope, 'chat-1', { authoritative: true })

    const refreshOptions = client.sessionWindow.mock.calls[1][2] as any
    expect(refreshOptions).not.toHaveProperty('head')
    expect(refreshed.messages.map((message: any) => message.id)).toEqual(['m1', 'u-new', 'a-new'])
  })

  it('head 解析为空页时按事实返回，不再退默认路径', async () => {
    const client = fakeSwitch([page([], '')])
    const loader = createSessionWindowLoader({
      sessionSwitch: client,
      headFor: () => 'missing-mid',
    })
    const chat = await loader.load(scope, 'chat-1')

    expect(chat.messages).toEqual([])
    expect(client.sessionWindow).toHaveBeenCalledTimes(1)
    expect((client.sessionWindow.mock.calls[0][2] as any).head).toBe('missing-mid')
  })

  it('authoritative 刷新拿到空页时按空页事实收敛，不保留旧消息', async () => {
    const client = fakeSwitch([page([msg('m1', 1)], ''), page([], '')])
    const loader = createSessionWindowLoader({
      sessionSwitch: client,
      headFor: () => 'm-head',
    })
    await loader.load(scope, 'chat-1')
    const refreshed = await loader.refresh(scope, 'chat-1', { authoritative: true })

    expect(refreshed.messages).toEqual([])
    expect(client.sessionWindow).toHaveBeenCalledTimes(2)
  })

  it('headFor 抛错时退化为不带 head（观测不改变行为分支）', async () => {
    const client = fakeSwitch([page([msg('m1', 1)], '')])
    const loader = createSessionWindowLoader({
      sessionSwitch: client,
      headFor: () => {
        throw new Error('读取失败')
      },
    })
    await loader.load(scope, 'chat-1')
    expect(client.sessionWindow.mock.calls[0][2]).not.toHaveProperty('head')
  })
})


// 回归：失效之前发起的窗口请求，失效之后落地不得回填。
// 这是「已删除会话复活 / 旧正文覆盖新正文」的直接成因。
describe('失效打断在途读取', () => {
  function deferred<T>() {
    let resolve: (value: T) => void = () => {}
    const promise = new Promise<T>((res) => {
      resolve = res
    })
    return { promise, resolve }
  }

  it('load 在途失效：旧首窗不写回分页状态', async () => {
    const first = deferred<any>()
    let calls = 0
    const client = {
      hasFeature: () => true,
      sessionWindow: vi.fn(async (_scope: any, chatId: string) => {
        calls += 1
        if (calls === 1) return first.promise
        return page([msg('m-new', 10)], '')
      }),
    }
    const loader = createSessionWindowLoader({ sessionSwitch: client as any })

    const inFlight = loader.load(scope, 'chat-1')
    loader.invalidate(scope, 'chat-1')
    first.resolve(page([msg('m-old', 1)], ''))

    const chat = await inFlight
    // 旧代结果不得被当成有效数据交出去；重取拿到的是失效之后的窗口。
    expect(chat.messages.map((m: any) => m.id)).toEqual(['m-new'])
    expect(loader.peek(scope, 'chat-1')?.chat.messages.map((m: any) => m.id)).toEqual(['m-new'])
    expect(calls).toBe(2)
  })

  it('load 在途失效之后，下一次 load 不复用旧代请求', async () => {
    const first = deferred<any>()
    let calls = 0
    const client = {
      hasFeature: () => true,
      sessionWindow: vi.fn(async (_scope: any, chatId: string) => {
        calls += 1
        if (calls === 1) return first.promise
        return page([msg('m-new', 10)], '')
      }),
    }
    const loader = createSessionWindowLoader({ sessionSwitch: client as any })

    const inFlight = loader.load(scope, 'chat-1')
    loader.invalidate(scope, 'chat-1')
    const second = loader.load(scope, 'chat-1')
    first.resolve(page([msg('m-old', 1)], ''))

    await Promise.all([inFlight, second])
    expect(calls).toBe(2)
    expect(loader.peek(scope, 'chat-1')?.chat.messages.map((m: any) => m.id)).toEqual(['m-new'])
  })

  it('loadOlder 在途失效：旧页不并回新分页', async () => {
    const older = deferred<any>()
    let calls = 0
    const client = {
      hasFeature: () => true,
      sessionWindow: vi.fn(async (_scope: any, chatId: string, options: any) => {
        calls += 1
        if (options?.cursor === 'c-old') return older.promise
        if (calls === 1) return page([msg('m-head', 20)], 'c-old')
        // 失效之后重取首窗：会话已经被删到只剩新的一条。
        return page([msg('m-new', 10)], '')
      }),
    }
    const loader = createSessionWindowLoader({ sessionSwitch: client as any })
    await loader.load(scope, 'chat-1')
    expect(loader.peek(scope, 'chat-1')?.nextCursor).toBe('c-old')

    const inFlight = loader.loadOlder(scope, 'chat-1')
    loader.invalidate(scope, 'chat-1')
    older.resolve(page([msg('m-old', 1)], ''))

    const chat = await inFlight
    // 旧页（m-old）绝不能并回来：分页状态已被作废，这次翻页没有可交付的结果。
    expect(chat).toBeNull()
    expect(loader.peek(scope, 'chat-1')).toBeNull()
    // 旧代结果不触发任何回填，也不会被当成「已到底」。
    expect(calls).toBe(2)
  })

  it('refresh 在途失效：旧正文不覆盖新正文', async () => {
    const stale = deferred<any>()
    let calls = 0
    const client = {
      hasFeature: () => true,
      sessionWindow: vi.fn(async (_scope: any, chatId: string) => {
        calls += 1
        if (calls === 1) return page([msg('m1', 10, { content: '第一版' })], '')
        if (calls === 2) return stale.promise
        return page([msg('m1', 10, { content: '第三版' })], '')
      }),
    }
    const loader = createSessionWindowLoader({ sessionSwitch: client as any })
    await loader.load(scope, 'chat-1')

    const inFlight = loader.refresh(scope, 'chat-1')
    loader.invalidate(scope, 'chat-1')
    stale.resolve(page([msg('m1', 10, { content: '第二版（旧请求）' })], ''))

    const chat = await inFlight
    expect(chat.messages[0].content).toBe('第三版')
    expect(loader.peek(scope, 'chat-1')?.chat.messages[0].content).toBe('第三版')
  })

  it('迟到的 refresh 不得覆盖更新的 refresh（同代写入按代数排序）', async () => {
    const stale = deferred<any>()
    let calls = 0
    const client = {
      hasFeature: () => true,
      sessionWindow: vi.fn(async (_scope: any, chatId: string) => {
        calls += 1
        if (calls === 1) return page([msg('m1', 10, { content: '第一版' })], '')
        if (calls === 2) return stale.promise
        if (calls === 3) return page([msg('m1', 10, { content: '第三版' })], '')
        return page([msg('m1', 10, { content: '第四版' })], '')
      }),
    }
    const loader = createSessionWindowLoader({ sessionSwitch: client as any })
    await loader.load(scope, 'chat-1')

    const olderRefresh = loader.refresh(scope, 'chat-1')
    const newerRefresh = await loader.refresh(scope, 'chat-1')
    expect(newerRefresh.messages[0].content).toBe('第三版')

    // 旧请求晚到：必须被新一代挡下并重取，而不是把「第二版」写回。
    stale.resolve(page([msg('m1', 10, { content: '第二版（旧请求）' })], ''))
    const olderResult = await olderRefresh
    expect(olderResult.messages[0].content).toBe('第四版')
    expect(loader.peek(scope, 'chat-1')?.chat.messages[0].content).toBe('第四版')
  })

  it('clear 同样打断在途读取', async () => {
    const first = deferred<any>()
    let calls = 0
    const client = {
      hasFeature: () => true,
      sessionWindow: vi.fn(async (_scope: any, chatId: string) => {
        calls += 1
        if (calls === 1) return first.promise
        return page([msg('m-new', 10)], '')
      }),
    }
    const loader = createSessionWindowLoader({ sessionSwitch: client as any })

    const inFlight = loader.load(scope, 'chat-1')
    loader.clear()
    first.resolve(page([msg('m-old', 1)], ''))

    const chat = await inFlight
    expect(chat.messages.map((m: any) => m.id)).toEqual(['m-new'])
    expect(calls).toBe(2)
  })

  it('invalidateScope 只作废该 scope 的在途读取', async () => {
    const first = deferred<any>()
    let calls = 0
    const client = {
      hasFeature: () => true,
      sessionWindow: vi.fn(async (_scope: any, chatId: string) => {
        calls += 1
        if (calls === 1) return first.promise
        return page([msg('m-new', 10)], '')
      }),
    }
    const loader = createSessionWindowLoader({ sessionSwitch: client as any })
    const other = { kind: 'role' as const, targetId: 'role-2' }

    const inFlight = loader.load(scope, 'chat-1')
    loader.invalidateScope(other)
    first.resolve(page([msg('m-kept', 1)], ''))

    const chat = await inFlight
    // 别的 scope 失效不该打断这次读取。
    expect(chat.messages.map((m: any) => m.id)).toEqual(['m-kept'])
    expect(calls).toBe(1)
  })
})


describe('会话级事实：窗口加载必须保留真实标题与时间', () => {
  it('窗口页不含会话级字段时，用索引事实补齐标题与时间', async () => {
    const client = fakeSwitch([{ id: 'chat-1', messages: [msg('m1', 1)], nextCursor: '' }])
    const loader = createSessionWindowLoader({
      sessionSwitch: client,
      resolveIdentity: () => ({ title: '真实标题', createdAt: 1000, updatedAt: 2000 }),
    })
    const chat = await loader.load(scope, 'chat-1')
    expect(chat.title).toBe('真实标题')
    expect(chat.createdAt).toBe(1000)
    expect(chat.updatedAt).toBe(2000)
  })

  it('索引是事实源：页内缺失时由索引补齐（页内真实值优先）', async () => {
    const client = fakeSwitch([
      { id: 'chat-1', title: '页内标题', createdAt: 11, updatedAt: 22, messages: [msg('m1', 1)], nextCursor: '' },
    ])
    const loader = createSessionWindowLoader({
      sessionSwitch: client,
      resolveIdentity: () => ({ title: '索引标题', createdAt: 1000, updatedAt: 2000 }),
    })
    const chat = await loader.load(scope, 'chat-1')
    // 页内与索引是同一份事实的两次读取：页内显式携带时以页内为准。
    expect(chat.title).toBe('页内标题')
    expect(chat.createdAt).toBe(11)
    // 更新时间只能前进：页内更旧时不得回退索引事实。
    expect(chat.updatedAt).toBe(2000)
  })

  it('索引缺席时才用页内字段（仍然不写占位标题）', async () => {
    const client = fakeSwitch([
      { id: 'chat-1', title: '页内标题', createdAt: 11, updatedAt: 22, messages: [msg('m1', 1)], nextCursor: '' },
    ])
    const loader = createSessionWindowLoader({ sessionSwitch: client })
    const chat = await loader.load(scope, 'chat-1')
    expect(chat.title).toBe('页内标题')
    expect(chat.createdAt).toBe(11)
    expect(chat.updatedAt).toBe(22)
  })

  it('索引缺席时不写入占位标题（保留窗口自身事实）', async () => {
    const client = fakeSwitch([{ id: 'chat-1', messages: [msg('m1', 1)], nextCursor: '' }])
    const loader = createSessionWindowLoader({ sessionSwitch: client, resolveIdentity: () => null })
    const chat = await loader.load(scope, 'chat-1')
    expect(chat).not.toHaveProperty('title')
    expect(chat).not.toHaveProperty('createdAt')
  })

  it('翻页与写后刷新都保持同一份会话级事实', async () => {
    const client = fakeSwitch([
      { id: 'chat-1', messages: [msg('m2', 20)], nextCursor: 'c2' },
      { id: 'chat-1', messages: [msg('m1', 10)], nextCursor: '' },
      { id: 'chat-1', messages: [msg('m2', 21)], nextCursor: '' },
    ])
    const loader = createSessionWindowLoader({
      sessionSwitch: client,
      resolveIdentity: () => ({ title: '真实标题', createdAt: 1000, updatedAt: 2000 }),
    })
    await loader.load(scope, 'chat-1')
    const paged = await loader.loadOlder(scope, 'chat-1')
    expect(paged.title).toBe('真实标题')
    expect(paged.createdAt).toBe(1000)

    const refreshed = await loader.refresh(scope, 'chat-1')
    expect(refreshed.title).toBe('真实标题')
    expect(refreshed.updatedAt).toBe(2000)
  })

  it('事实源读取失败时快速失败（不静默退化成兜底标题）', async () => {
    const client = fakeSwitch([{ id: 'chat-1', messages: [msg('m1', 1)], nextCursor: '' }])
    const loader = createSessionWindowLoader({
      sessionSwitch: client,
      resolveIdentity: () => {
        throw new Error('索引不可用')
      },
    })
    await expect(loader.load(scope, 'chat-1')).rejects.toThrow(/索引不可用/)
  })
})

describe('正文加载的 switchId 贯穿', () => {
  it('首窗请求携带当前切换的 switchId', async () => {
    const client = fakeSwitch([page([msg('m1', 1)], 'c2')])
    const loader = createSessionWindowLoader({
      sessionSwitch: client,
      switchIdFor: () => 'sw-abc',
    })
    await loader.load(scope, 'chat-1')
    expect(client.sessionWindow).toHaveBeenCalledWith(scope, 'chat-1', expect.objectContaining({ switchId: 'sw-abc' }))
  })

  it('翻页沿用同一次切换的 switchId', async () => {
    const client = fakeSwitch([page([msg('m2', 20)], 'c2'), page([msg('m1', 10)], '')])
    const loader = createSessionWindowLoader({
      sessionSwitch: client,
      switchIdFor: () => 'sw-abc',
    })
    await loader.load(scope, 'chat-1')
    await loader.loadOlder(scope, 'chat-1')
    expect(client.sessionWindow).toHaveBeenLastCalledWith(
      scope,
      'chat-1',
      expect.objectContaining({ cursor: 'c2', switchId: 'sw-abc' }),
    )
  })

  it('没有进行中的切换时不带 switchId 字段', async () => {
    const client = fakeSwitch([page([msg('m1', 1)], '')])
    const loader = createSessionWindowLoader({ sessionSwitch: client, switchIdFor: () => '' })
    await loader.load(scope, 'chat-1')
    const options = (client.sessionWindow as any).mock.calls[0][2]
    expect(options).not.toHaveProperty('switchId')
  })

  it('switchIdFor 抛错不影响加载（观测是纯旁路）', async () => {
    const client = fakeSwitch([page([msg('m1', 1)], '')])
    const loader = createSessionWindowLoader({
      sessionSwitch: client,
      switchIdFor: () => { throw new Error('boom') },
    })
    const chat = await loader.load(scope, 'chat-1')
    expect(chat.messages).toHaveLength(1)
  })
})