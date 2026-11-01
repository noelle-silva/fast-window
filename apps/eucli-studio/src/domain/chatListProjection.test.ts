import { describe, expect, it } from 'vitest'
import { writeChatListProjection } from './chatListProjection'

function box(partial: any = {}) {
  return { activeChatId: '', chatMetas: [], chats: [], ...partial }
}

function meta(id: string, updatedAt = 0, extra: any = {}) {
  return { id, title: id, createdAt: updatedAt, updatedAt, lastMessagePreview: '', messageCount: 0, hasPending: false, runStatus: 'idle', runStatusChangedAt: 0, ...extra }
}

describe('writeChatListProjection', () => {
  it('derive 从 chats 补位并保留索引顺序', () => {
    const target = box({
      chatMetas: [meta('chat-1', 10), meta('chat-2', 20)],
      chats: [{ id: 'chat-2', title: '二', messages: [], createdAt: 20, updatedAt: 20 }],
    })

    writeChatListProjection(target, { kind: 'derive', fallbackTitle: '新聊天' })

    expect(target.chatMetas.map((item: any) => item.id)).toEqual(['chat-1', 'chat-2'])
  })

  it('upsert 新会话进入列表头，并同步写入索引投影', () => {
    const target = box({ chatMetas: [meta('chat-1', 10)], chats: [{ id: 'chat-1', messages: [], createdAt: 10, updatedAt: 10 }] })

    const result = writeChatListProjection(target, {
      kind: 'upsert',
      chat: { id: 'chat-2', title: '二', messages: [], createdAt: 20, updatedAt: 20 },
      fallbackTitle: '新聊天',
    })

    expect(result?.chat?.id).toBe('chat-2')
    expect(target.chats.map((item: any) => item.id)).toEqual(['chat-2', 'chat-1'])
    expect(target.chatMetas.map((item: any) => item.id)).toEqual(['chat-2', 'chat-1'])
  })

  it('upsert 已有会话在原位置合并，不因更新挪到列表头', () => {
    const target = box({
      chatMetas: [meta('chat-1', 10), meta('chat-2', 20)],
      chats: [{ id: 'chat-1', title: '旧', messages: [], createdAt: 10, updatedAt: 10 }],
    })

    writeChatListProjection(target, {
      kind: 'upsert',
      chat: { id: 'chat-1', title: '新', messages: [{ id: 'm1', type: 'user', content: 'hi' }], createdAt: 10, updatedAt: 30 },
      fallbackTitle: '新聊天',
    })

    expect(target.chats.map((item: any) => item.id)).toEqual(['chat-1'])
    expect(target.chatMetas.map((item: any) => item.id)).toEqual(['chat-1', 'chat-2'])
    expect(target.chatMetas[0].title).toBe('新')
  })

  it('窗口切片的 upsert 不覆盖索引里的条数与摘要', () => {
    const target = box({
      chatMetas: [meta('chat-1', 10, { title: '索引标题', messageCount: 42, lastMessagePreview: '索引摘要' })],
      chats: [],
    })

    writeChatListProjection(target, {
      kind: 'upsert',
      chat: { id: 'chat-1', title: '窗口标题', windowPartial: true, messages: [{ id: 'm1', type: 'user', content: '窗口摘要' }], createdAt: 10, updatedAt: 99 },
      fallbackTitle: '新聊天',
    })

    expect(target.chatMetas[0].title).toBe('索引标题')
    expect(target.chatMetas[0].messageCount).toBe(42)
    expect(target.chatMetas[0].lastMessagePreview).toBe('索引摘要')
    expect(target.chats[0].id).toBe('chat-1')
  })

  it('upsertMeta 只更新索引投影，不触碰正文列表', () => {
    const target = box({
      chatMetas: [meta('chat-1', 10)],
      chats: [{ id: 'chat-1', title: '旧', messages: [], createdAt: 10, updatedAt: 10 }],
    })

    writeChatListProjection(target, { kind: 'upsertMeta', meta: { ...target.chatMetas[0], updatedAt: 30 }, fallbackTitle: '新聊天' })

    expect(target.chatMetas[0].updatedAt).toBe(30)
    expect(target.chats[0].title).toBe('旧')
    expect(target.chats[0].updatedAt).toBe(10)
  })

  it('updateMeta=false 只把运行时会话放进工作集，不生成索引事实', () => {
    const target = box()

    writeChatListProjection(target, {
      kind: 'upsert',
      chat: { id: 'runtime-1', runtimePartial: true, messages: [] },
      updateMeta: false,
    })

    expect(target.chats.map((item: any) => item.id)).toEqual(['runtime-1'])
    expect(target.chatMetas).toEqual([])
  })

  it('remove 同步移除会话与索引投影', () => {
    const target = box({
      chatMetas: [meta('chat-1', 10), meta('chat-2', 20)],
      chats: [{ id: 'chat-1', messages: [] }, { id: 'chat-2', messages: [] }],
    })

    writeChatListProjection(target, { kind: 'remove', chatId: 'chat-1', fallbackTitle: '新聊天' })

    expect(target.chats.map((item: any) => item.id)).toEqual(['chat-2'])
    expect(target.chatMetas.map((item: any) => item.id)).toEqual(['chat-2'])
  })

  it('replace 保留调用方给出的列表顺序', () => {
    const target = box()

    writeChatListProjection(target, {
      kind: 'replace',
      chats: [{ id: 'chat-2', messages: [] }, { id: 'chat-1', messages: [] }],
      chatMetas: [meta('chat-2', 20), meta('chat-1', 10)],
    })

    expect(target.chats.map((item: any) => item.id)).toEqual(['chat-2', 'chat-1'])
    expect(target.chatMetas.map((item: any) => item.id)).toEqual(['chat-2', 'chat-1'])
  })

  it('ensure 只补齐形状，不重算索引投影', () => {
    const target: any = { activeChatId: '', chats: [{ id: 'chat-1' }] }

    writeChatListProjection(target, { kind: 'ensure' })

    expect(target.chats).toHaveLength(1)
    expect(target.chatMetas).toEqual([])
  })
})
