import { describe, expect, it, vi } from 'vitest'
import { createProjectionPipeline } from './projectionPipeline'
import { normalizeStoredChat } from '../storage/normalizeStoredChat'
import { chatMetaFromChat, chatMetasFromBox } from '../domain/chatMeta'
import type { SessionSwitchClient } from '../protocol/sessionSwitchProtocol'
import type { ProjectionScope } from '../storage/splitProjectionCache'

// 回归：会话窗口接口只返回 messages + nextCursor。
//
// 现场故障：窗口拼出来的会话没有标题 / 创建时间 / 更新时间，
// normalizeStoredChat 用「新聊天」与 now() 兜底，再把结果写进侧边栏 meta，
// 于是真实标题被覆盖、所有会话时间塌缩成同一个值，排序彻底错乱。
//
// 修复后的事实链：索引 chatMeta 是唯一事实源 → 窗口加载器补齐会话级事实
// → 归一化与 meta 合并都拒绝用切片覆盖既有事实。

const scope: ProjectionScope = { kind: 'role', targetId: 'role-1' }

const INDEXED_TITLE = '真实标题'
const INDEXED_CREATED_AT = Date.parse('2026-06-03T10:00:00Z')
const INDEXED_UPDATED_AT = Date.parse('2026-06-03T18:00:00Z')

function message(id: string, createdAt: number) {
  return { id, branchId: 'main', parentMessageId: '', createdAt, content: id }
}

function makePipeline(windowPage: any) {
  const sessionSwitch: SessionSwitchClient = {
    healthCheckFeatures: ['session.window', 'sessionIndex.get'],
    hasFeature: (feature: string) => feature === 'session.window' || feature === 'sessionIndex.get',
    sessionIndexGet: vi.fn(async (scopes: any[]) => ({
      schemaVersion: 1,
      dataRevision: 1,
      preferenceRevision: 1,
      epoch: 1,
      indexes: scopes.map((item: any) => ({
        scope: `${item.kind}:${item.targetId}`,
        activeChatId: 'chat-1',
        chatIds: ['chat-1'],
        chatUpdatedAt: { 'chat-1': INDEXED_UPDATED_AT },
        chatMetas: [
          {
            id: 'chat-1',
            title: INDEXED_TITLE,
            createdAt: INDEXED_CREATED_AT,
            updatedAt: INDEXED_UPDATED_AT,
            lastMessagePreview: '索引摘要',
            messageCount: 42,
          },
        ],
        updatedAt: INDEXED_UPDATED_AT,
        revision: 7,
      })),
    })),
    sessionSummaryList: vi.fn(),
    sessionGet: vi.fn(),
    sessionGraph: vi.fn(),
    setSessionView: vi.fn(),
    setActiveChat: vi.fn(),
    sessionWindow: vi.fn(async (_scope: any, chatId: string) => ({ id: chatId, ...windowPage })),
  } as any

  const meta = {
    roleOrder: ['role-1'],
    roleFolders: { 'role-1': '角色一' },
    groupOrder: [],
    groupFolders: {},
    providerOrder: [],
    providerFolders: {},
    modelGroupOrder: [],
    modelGroupFolders: {},
    ui: {},
    settings: {},
    updatedAt: 1,
  }
  const pipeline = createProjectionPipeline({
    storage: { get: async () => null, set: async () => {} },
    sessionSwitch,
    loadSplitMeta: async () => meta,
    getSplitMetaCache: () => meta,
    applyLocalSelection: () => {},
  })
  return { pipeline, sessionSwitch }
}

describe('窗口加载得到的会话保留真实会话级事实', () => {
  it('接口不带标题与时间时，加载结果仍带索引事实', async () => {
    const { pipeline } = makePipeline({ messages: [message('m1', INDEXED_CREATED_AT + 1)], nextCursor: '' })

    const chat = await pipeline.chatBodies.load(scope, 'chat-1')

    expect(chat.title).toBe(INDEXED_TITLE)
    expect(chat.createdAt).toBe(INDEXED_CREATED_AT)
    expect(chat.updatedAt).toBe(INDEXED_UPDATED_AT)
  })

  it('归一化之后事实不变（不会被「新聊天」/now() 覆盖）', async () => {
    const { pipeline } = makePipeline({ messages: [message('m1', INDEXED_CREATED_AT + 1)], nextCursor: '' })
    const chat = await pipeline.chatBodies.load(scope, 'chat-1')

    const normalized = normalizeStoredChat(chat, 'role')

    expect(normalized?.title).toBe(INDEXED_TITLE)
    expect(normalized?.createdAt).toBe(INDEXED_CREATED_AT)
    expect(normalized?.updatedAt).toBe(INDEXED_UPDATED_AT)
  })

  it('写进侧边栏元数据时不覆盖索引里的列表事实', async () => {
    const { pipeline } = makePipeline({ messages: [message('m1', INDEXED_CREATED_AT + 1)], nextCursor: '' })
    const chat = await pipeline.chatBodies.load(scope, 'chat-1')
    const normalized = normalizeStoredChat(chat, 'role')

    const box = {
      chatIds: ['chat-1'],
      chatUpdatedAt: { 'chat-1': INDEXED_UPDATED_AT },
      chatMetas: [
        {
          id: 'chat-1',
          title: INDEXED_TITLE,
          createdAt: INDEXED_CREATED_AT,
          updatedAt: INDEXED_UPDATED_AT,
          lastMessagePreview: '索引摘要',
          messageCount: 42,
        },
      ],
      chats: [normalized],
    }

    const metas = chatMetasFromBox(box, '新聊天')
    expect(metas).toHaveLength(1)
    expect(metas[0].title).toBe(INDEXED_TITLE)
    expect(metas[0].createdAt).toBe(INDEXED_CREATED_AT)
    expect(metas[0].updatedAt).toBe(INDEXED_UPDATED_AT)
    expect(metas[0].messageCount).toBe(42)
    expect(metas[0].lastMessagePreview).toBe('索引摘要')
  })

  it('切片 meta 不覆盖已有索引事实，但仍会补上列表里缺失的会话', () => {
    const windowMeta = chatMetaFromChat({
      id: 'chat-1',
      title: '新聊天',
      windowPartial: true,
      messages: [{ id: 'm1' }],
    })
    const box = {
      chatIds: ['chat-1'],
      chatUpdatedAt: { 'chat-1': INDEXED_UPDATED_AT },
      chatMetas: [
        {
          id: 'chat-1',
          title: INDEXED_TITLE,
          createdAt: INDEXED_CREATED_AT,
          updatedAt: INDEXED_UPDATED_AT,
          lastMessagePreview: '索引摘要',
          messageCount: 42,
        },
      ],
      chats: [{ id: 'chat-1', title: '新聊天', windowPartial: true, messages: [{ id: 'm1' }] }],
    }
    const metas = chatMetasFromBox(box, '新聊天')
    expect(metas[0].title).toBe(INDEXED_TITLE)
    expect(metas[0].messageCount).toBe(42)
    expect(windowMeta?.partial).toBe(true)
  })

  it('翻页之后会话级事实仍然唯一（不随窗口变化）', async () => {
    const { pipeline } = makePipeline({ messages: [message('m2', INDEXED_UPDATED_AT)], nextCursor: 'c2' })
    await pipeline.chatBodies.load(scope, 'chat-1')

    const paged = await pipeline.loadOlderMessages(scope, 'chat-1')

    expect(paged.title).toBe(INDEXED_TITLE)
    expect(paged.createdAt).toBe(INDEXED_CREATED_AT)
    expect(paged.updatedAt).toBe(INDEXED_UPDATED_AT)
  })
})
