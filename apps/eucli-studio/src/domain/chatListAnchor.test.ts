import { describe, expect, it } from 'vitest'
import { chatListAnchorAt, chatListAnchorForChat, chatListAnchorForIndex } from './chatListAnchor'

function userMessage(id: string, createdAt: number) {
  return { id, role: 'user', createdAt, updatedAt: createdAt }
}

function assistantMessage(id: string, run: Record<string, unknown>) {
  return { id, role: 'assistant', assistantRun: { generationId: `gen-${id}`, mode: 'new', stream: true, ...run } }
}

describe('chatListAnchor 位置锚点', () => {
  it('流式输出推进 updatedAt 不会改变锚点', () => {
    const chat = (updatedAt: number) => ({
      id: 'chat-a',
      createdAt: 1000,
      updatedAt,
      messages: [
        userMessage('m1', 1200),
        assistantMessage('m2', { status: 'running', startedAt: 1300, updatedAt }),
      ],
    })

    expect(chatListAnchorForChat(chat(1400))).toBe(1200)
    expect(chatListAnchorForChat(chat(999999))).toBe(1200)
  })

  it('工具往返产生的中间 run 起落不改变锚点', () => {
    // 一轮工具调用：前一个 run 终态、工具返回、后一个 run 启动。
    // 这些时间都是过程，锚点必须钉在用户消息时间上。
    const chat = {
      id: 'chat-a',
      createdAt: 1000,
      updatedAt: 9999,
      messages: [
        userMessage('m1', 1200),
        assistantMessage('m2', { status: 'succeeded', startedAt: 1300, updatedAt: 1400, finishedAt: 1400 }),
        assistantMessage('m3', { status: 'succeeded', startedAt: 1500, updatedAt: 1700, finishedAt: 1700 }),
        assistantMessage('m4', { status: 'running', startedAt: 1800, updatedAt: 9999 }),
      ],
    }
    expect(chatListAnchorForChat(chat)).toBe(1200)
  })

  it('整轮结束后锚点仍停在用户消息时间，不因完成而上浮', () => {
    const chat = {
      id: 'chat-a',
      createdAt: 1000,
      updatedAt: 999999,
      messages: [
        userMessage('m1', 1200),
        assistantMessage('m2', { status: 'succeeded', startedAt: 1300, updatedAt: 1800, finishedAt: 1800 }),
      ],
    }
    expect(chatListAnchorForChat(chat)).toBe(1200)
  })

  it('用户新消息推进锚点', () => {
    const chat = {
      id: 'chat-a',
      createdAt: 1000,
      updatedAt: 5000,
      messages: [userMessage('m1', 1000), userMessage('m2', 4000)],
    }
    expect(chatListAnchorForChat(chat)).toBe(4000)
  })

  it('没有用户消息的会话以创建时间为锚点', () => {
    const chat = {
      id: 'chat-a',
      createdAt: 1000,
      updatedAt: 8000,
      messages: [assistantMessage('m1', { status: 'succeeded', startedAt: 1200, updatedAt: 1800, finishedAt: 1800 })],
    }
    expect(chatListAnchorForChat(chat)).toBe(1000)
  })

  it('索引会话以最后落盘的活动时间作为锚点初值', () => {
    expect(chatListAnchorForIndex({ createdAt: 1000, updatedAt: 2000 }, 1000, 2000)).toBe(2000)
    expect(chatListAnchorForIndex({ createdAt: 1000, updatedAt: 0 }, 1000, 0)).toBe(1000)
  })

  it('索引已带锚点时直接采用，不再回落到活动时间', () => {
    expect(chatListAnchorForIndex({ listAnchorAt: 1500, updatedAt: 9000 }, 1000, 9000)).toBe(1500)
  })

  it('排序读取优先用 meta 上的锚点', () => {
    expect(chatListAnchorAt({ id: 'chat-a', listAnchorAt: 1500, updatedAt: 9000, createdAt: 1000 })).toBe(1500)
  })
})
