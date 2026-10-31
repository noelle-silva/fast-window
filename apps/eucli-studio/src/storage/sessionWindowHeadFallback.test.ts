import { describe, expect, it, vi } from 'vitest'
import { createSessionWindowLoader } from './sessionWindowLoader'

// 回归：head 无法解析时业务端可能回空窗。
// 空窗不是「会话为空」的证据：若把它当权威，终态刷新会把正文整份清空，
// 界面只剩占位。加载器必须退一次默认路径。
const scope = { kind: 'role' as const, targetId: 'role-1' }

function message(id: string, createdAt: number) {
  return { id, branchId: 'main', parentMessageId: 'p0', createdAt, content: id }
}

describe('窗口首屏：head 解析失败不得清空正文', () => {
  it('带 head 返回空页时，退一次不带 head 的默认路径', async () => {
    const calls: any[] = []
    const client = {
      hasFeature: () => true,
      sessionWindow: vi.fn(async (_scope: any, chatId: string, options: any) => {
        calls.push({ ...options })
        if (options?.head) return { id: chatId, messages: [], nextCursor: '' }
        return { id: chatId, messages: [message('m1', 1), message('m2', 2)], nextCursor: '' }
      }),
    }
    const loader = createSessionWindowLoader({ sessionSwitch: client, headFor: () => 'runtime-only-mid' })

    const chat = await loader.load(scope, 'chat-1')

    expect(calls).toHaveLength(2)
    expect(calls[0].head).toBe('runtime-only-mid')
    expect(calls[1].head).toBeUndefined()
    expect(chat.messages.map((m: any) => m.id)).toEqual(['m1', 'm2'])
  })

  it('head 有结果时不多打一次请求', async () => {
    const client = {
      hasFeature: () => true,
      sessionWindow: vi.fn(async (_scope: any, chatId: string) => ({ id: chatId, messages: [message('m1', 1)], nextCursor: '' })),
    }
    const loader = createSessionWindowLoader({ sessionSwitch: client, headFor: () => 'm1' })

    await loader.load(scope, 'chat-1')

    expect(client.sessionWindow).toHaveBeenCalledTimes(1)
  })

  it('写路径刷新同样受益：空页不会把已有窗口清空', async () => {
    let empty = false
    const client = {
      hasFeature: () => true,
      sessionWindow: vi.fn(async (_scope: any, chatId: string, options: any) => {
        if (empty && options?.head) return { id: chatId, messages: [], nextCursor: '' }
        return { id: chatId, messages: [message('m1', 1), message('m2', 2)], nextCursor: '' }
      }),
    }
    const loader = createSessionWindowLoader({ sessionSwitch: client, headFor: () => 'm2' })
    await loader.load(scope, 'chat-1')

    empty = true
    const refreshed = await loader.refresh(scope, 'chat-1')

    expect(refreshed.messages.map((m: any) => m.id)).toEqual(['m1', 'm2'])
  })
})
