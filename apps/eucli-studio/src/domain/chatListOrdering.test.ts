import { describe, expect, it } from 'vitest'
import { sortChatListItemsForDisplay, sortChatListItemsOfBox } from './chatListOrdering'

function userMessage(id: string, createdAt: number) {
  return { id, role: 'user', createdAt, updatedAt: createdAt }
}

// 一个正在输出的会话：updatedAt 随每次 delta 推进，run 的 startedAt 不变。
function streamingChat(id: string, options: { createdAt: number; startedAt: number; updatedAt: number }) {
  return {
    id,
    createdAt: options.createdAt,
    updatedAt: options.updatedAt,
    messages: [
      userMessage(`${id}-m1`, options.createdAt),
      {
        id: `${id}-m2`,
        role: 'assistant',
        assistantRun: {
          generationId: `gen-${id}`,
          mode: 'new',
          stream: true,
          status: 'running',
          startedAt: options.startedAt,
          updatedAt: options.updatedAt,
        },
      },
    ],
  }
}

function idsOf(items: any[]) {
  return sortChatListItemsForDisplay(items).map((item: any) => item.id)
}

describe('sortChatListItemsForDisplay 位置稳定性', () => {
  it('多个会话并发输出时，输出进度不会改变列表顺序', () => {
    const snapshot = (tick: number) => [
      streamingChat('chat-a', { createdAt: 1000, startedAt: 1500, updatedAt: tick }),
      streamingChat('chat-b', { createdAt: 1100, startedAt: 1400, updatedAt: tick + 1 }),
      { id: 'chat-c', createdAt: 1200, updatedAt: 1200, messages: [] },
    ]

    const first = idsOf(snapshot(1600))
    const later = idsOf(snapshot(50000))
    expect(later).toEqual(first)
    expect(first).toEqual(['chat-a', 'chat-b', 'chat-c'])
  })

  it('会话按锚点排序，不看 updatedAt 的活跃度', () => {
    const items = [
      // updatedAt 最新，但事件时间最早：run 早就结束了。
      { id: 'chat-old', createdAt: 1000, updatedAt: 9000, listAnchorAt: 1100 },
      // updatedAt 一般，但刚结束一次 run。
      { id: 'chat-new', createdAt: 1200, updatedAt: 2000, listAnchorAt: 1900 },
    ]
    expect(idsOf(items)).toEqual(['chat-new', 'chat-old'])
  })

  it('锚点相同时按创建时间、再按 id 定序', () => {
    const items = [
      { id: 'chat-b', createdAt: 2000, updatedAt: 5000, listAnchorAt: 3000 },
      { id: 'chat-a', createdAt: 2000, updatedAt: 5000, listAnchorAt: 3000 },
      { id: 'chat-c', createdAt: 2500, updatedAt: 5000, listAnchorAt: 3000 },
    ]
    expect(idsOf(items)).toEqual(['chat-c', 'chat-a', 'chat-b'])
  })

  it('索引刷新改写 meta 时，正文事件锚点优先', () => {
    const box = {
      chatMetas: [
        // 索引里的活动时间被输出一路推高。
        { id: 'chat-a', createdAt: 1000, updatedAt: 90000, listAnchorAt: 90000 },
        // 一次刚结束的 run 才是真正的位置事件。
        { id: 'chat-b', createdAt: 1100, updatedAt: 2000, listAnchorAt: 2000 },
      ],
      chats: [
        {
          id: 'chat-a',
          createdAt: 1000,
          updatedAt: 90000,
          messages: [
            userMessage('chat-a-m1', 1000),
            {
              id: 'chat-a-m2',
              role: 'assistant',
              assistantRun: {
                generationId: 'gen-chat-a',
                mode: 'new',
                stream: false,
                status: 'succeeded',
                startedAt: 1500,
                updatedAt: 90000,
                finishedAt: 1600,
              },
            },
          ],
        },
      ],
    }

    expect(sortChatListItemsOfBox(box).map((item: any) => item.id)).toEqual(['chat-b', 'chat-a'])
  })
})
