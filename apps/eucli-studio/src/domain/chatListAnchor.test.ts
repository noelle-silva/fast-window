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
        userMessage('m1', 1000),
        assistantMessage('m2', { status: 'running', startedAt: 1200, updatedAt }),
      ],
    })

    expect(chatListAnchorForChat(chat(1300))).toBe(1200)
    expect(chatListAnchorForChat(chat(999999))).toBe(1200)
  })

  it('run 到达终态推进一次锚点，之后的输出不再推进', () => {
    const settled = (updatedAt: number) => ({
      id: 'chat-a',
      createdAt: 1000,
      updatedAt,
      messages: [
        userMessage('m1', 1000),
        assistantMessage('m2', { status: 'succeeded', startedAt: 1200, updatedAt, finishedAt: 1800 }),
      ],
    })

    expect(chatListAnchorForChat(settled(1800))).toBe(1800)
    expect(chatListAnchorForChat(settled(999999))).toBe(1800)
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

  it('末尾消息没有 run 时仍取到更早那次 run 的终态时间', () => {
    const chat = {
      id: 'chat-a',
      createdAt: 1000,
      updatedAt: 9000,
      messages: [
        userMessage('m1', 1000),
        assistantMessage('m2', { status: 'succeeded', startedAt: 1200, updatedAt: 1800, finishedAt: 1800 }),
        { id: 'm3', role: 'assistant', content: '旧的 assistant 记录' },
        userMessage('m4', 2500),
      ],
    }
    expect(chatListAnchorForChat(chat)).toBe(2500)
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
