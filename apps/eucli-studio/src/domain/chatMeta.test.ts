import { describe, expect, it } from 'vitest'
import { chatMetaFromChat, chatMetasFromBox, resolveChatMetaFact, type ChatMeta } from './chatMeta'

describe('chatMeta window partiality', () => {
  it('marks metas derived from a window slice as partial', () => {
    const meta = chatMetaFromChat({
      id: 'chat-1',
      title: '标题',
      windowPartial: true,
      messages: [{ id: 'm1', content: 'hi' }],
    })
    expect(meta?.partial).toBe(true)
  })

  it('keeps the index fact when a window slice is merged into an existing meta', () => {
    const box = {
      chatIds: ['chat-1'],
      chatUpdatedAt: { 'chat-1': 100 },
      chatMetas: [
        { id: 'chat-1', title: '索引标题', lastMessagePreview: '索引摘要', messageCount: 42, createdAt: 1, updatedAt: 100 },
      ],
      chats: [
        {
          id: 'chat-1',
          title: '窗口标题',
          windowPartial: true,
          updatedAt: 200,
          messages: [{ id: 'm9', content: '窗口里的最后一条' }],
        },
      ],
    }
    const metas = chatMetasFromBox(box, '新聊天')
    expect(metas).toHaveLength(1)
    // 条数与摘要来自索引：窗口只加载了一窗，不能覆盖它们。
    expect(metas[0].messageCount).toBe(42)
    expect(metas[0].lastMessagePreview).toBe('索引摘要')
  })

  it('still replaces the index fact with a complete chat document', () => {
    const box = {
      chatIds: ['chat-1'],
      chatUpdatedAt: { 'chat-1': 100 },
      chatMetas: [{ id: 'chat-1', title: '索引标题', messageCount: 42, createdAt: 1, updatedAt: 100 }],
      chats: [{ id: 'chat-1', title: '完整标题', updatedAt: 200, messages: [{ id: 'm1' }, { id: 'm2' }] }],
    }
    const metas = chatMetasFromBox(box, '新聊天')
    expect(metas[0].messageCount).toBe(2)
    expect(metas[0].title).toBe('完整标题')
  })
})

describe('chatMeta 事实优先级', () => {
  function meta(partial: Partial<ChatMeta>): ChatMeta {
    return {
      id: 'chat-1',
      title: '标题',
      createdAt: 1,
      updatedAt: 1,
      lastMessagePreview: '',
      messageCount: 0,
      hasPending: false,
      runStatus: 'idle',
      runStatusChangedAt: 0,
      listAnchorAt: 1,
      ...partial,
    }
  }

  it('服务端完整会话覆盖已有投影', () => {
    const existing = meta({ partial: true, title: '窗口标题', messageCount: 1 })
    const incoming = meta({ title: '完整标题', messageCount: 9 })
    expect(resolveChatMetaFact(existing, incoming)?.title).toBe('完整标题')
    expect(resolveChatMetaFact(existing, incoming)?.messageCount).toBe(9)
  })

  it('窗口切片（本地投影）不能覆盖任何已有事实', () => {
    const existing = meta({ title: '索引标题', messageCount: 42 })
    const incoming = meta({ partial: true, title: '窗口标题', messageCount: 1 })
    expect(resolveChatMetaFact(existing, incoming)).toBe(existing)
  })

  it('同为窗口切片时保留先到者', () => {
    const existing = meta({ partial: true, title: '先到' })
    const incoming = meta({ partial: true, title: '后到' })
    expect(resolveChatMetaFact(existing, incoming)).toBe(existing)
  })

})

describe('chatMeta 时间归一化', () => {
  it('线格式 ISO 字符串时间不会塌缩成同一个 now()', () => {
    const older = chatMetaFromChat({
      id: 'chat-a',
      title: 'A',
      createdAt: '2026-10-31T17:32:31.8294373Z',
      updatedAt: '2026-10-31T17:32:31.8294373Z',
      messages: [],
    })
    const newer = chatMetaFromChat({
      id: 'chat-b',
      title: 'B',
      createdAt: '2026-10-31T17:39:14.4078946Z',
      updatedAt: '2026-10-31T17:39:14.4078946Z',
      messages: [],
    })
    expect(older?.updatedAt).toBe(Date.parse('2026-10-31T17:32:31.8294373Z'))
    expect(newer?.updatedAt).toBe(Date.parse('2026-10-31T17:39:14.4078946Z'))
    expect(newer!.updatedAt).toBeGreaterThan(older!.updatedAt)
  })
})