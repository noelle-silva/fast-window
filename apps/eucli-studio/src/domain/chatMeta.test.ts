import { describe, expect, it } from 'vitest'
import { chatMetaFromChat, chatMetasFromBox } from './chatMeta'

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
