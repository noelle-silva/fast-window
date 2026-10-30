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