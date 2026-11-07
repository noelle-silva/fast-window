import { describe, expect, it } from 'vitest'
import { sortChatListItemsForDisplay, sortChatListItemsOfBox } from './chatListOrdering'

function userMessage(id: string, createdAt: number) {
  return { id, role: 'user', createdAt, updatedAt: createdAt }
}

// 一个正在输出的会话：updatedAt 随每次 delta 推进，锚点停在用户消息时间。
function streamingChat(id: string, options: { createdAt: number; userSentAt: number; startedAt: number; updatedAt: number }) {
  return {
    id,
    status: 'running',
    createdAt: options.createdAt,
    updatedAt: options.updatedAt,
    messages: [
      userMessage(`${id}-m1`, options.userSentAt),
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
      streamingChat('chat-a', { createdAt: 1000, userSentAt: 1000, startedAt: 1500, updatedAt: tick }),
      streamingChat('chat-b', { createdAt: 1100, userSentAt: 1100, startedAt: 1400, updatedAt: tick + 1 }),
      { id: 'chat-c', createdAt: 1200, updatedAt: 1200, messages: [] },
    ]

    const first = idsOf(snapshot(1600))
    const later = idsOf(snapshot(50000))
    expect(later).toEqual(first)
    expect(first).toEqual(['chat-c', 'chat-b', 'chat-a'])
  })

  it('工具往返回合里连续起 run，位置一次都不动', () => {
    // 一轮工具调用会产生多个 run：前一个终态、后一个启动。
    // 会话仍在运行，所有这些时间都不该影响位置。
    const round = (runStatus: string, finishedAt: number) => [
      {
        id: 'chat-a',
        status: 'running',
        createdAt: 1000,
        updatedAt: finishedAt + 500,
        messages: [
          userMessage('a-m1', 1000),
          {
            id: 'a-m2',
            role: 'assistant',
            assistantRun: {
              generationId: 'gen-a1',
              mode: 'new',
              stream: true,
              status: 'succeeded',
              startedAt: 1100,
              updatedAt: finishedAt,
              finishedAt,
            },
          },
          {
            id: 'a-m3',
            role: 'assistant',
            assistantRun: {
              generationId: 'gen-a2',
              mode: 'new',
              stream: true,
              status: runStatus,
              startedAt: finishedAt + 10,
              updatedAt: finishedAt + 500,
            },
          },
        ],
      },
      { id: 'chat-b', createdAt: 1200, updatedAt: 1300, listAnchorAt: 1300 },
    ]

    const first = idsOf(round('running', 1400))
    const second = idsOf(round('running', 1700))
    const third = idsOf(round('running', 2100))
    expect(first).toEqual(['chat-b', 'chat-a'])
    expect(second).toEqual(first)
    expect(third).toEqual(first)
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
