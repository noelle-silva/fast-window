import { describe, expect, it } from 'vitest'
import {
  activeChatIdExistsInBox,
  firstChatIdInBox,
  normalizeActiveChatId,
  readActiveChatSelection,
  reconcileActiveChatSelection,
  resolveActiveChatSelection,
  withActiveChatSelection,
  writeActiveChatSelection,
} from './activeChatSelection'

function box(activeChatId: unknown, chatIds: string[] = [], metaIds: string[] = []) {
  return {
    activeChatId,
    chatMetas: metaIds.map((id) => ({ id })),
    chats: chatIds.map((id) => ({ id })),
  }
}

describe('activeChatSelection', () => {
  it('读取时统一归一化为 trim 后的字符串', () => {
    expect(normalizeActiveChatId('  chat-1 ')).toBe('chat-1')
    expect(normalizeActiveChatId(null)).toBe('')
    expect(readActiveChatSelection({ activeChatId: ' chat-2 ' })).toBe('chat-2')
    expect(readActiveChatSelection(null)).toBe('')
  })

  it('写入统一归一化，并对相同值保持幂等', () => {
    const target = box(' chat-1 ')
    expect(writeActiveChatSelection(target, 'chat-1')).toBe(true)
    expect(target.activeChatId).toBe('chat-1')
    expect(writeActiveChatSelection(target, 'chat-1')).toBe(false)

    expect(writeActiveChatSelection(target, ' chat-2 ')).toBe(true)
    expect(target.activeChatId).toBe('chat-2')
    expect(writeActiveChatSelection(null, 'chat-3')).toBe(false)
  })

  it('不可变副本不修改原对象', () => {
    const source = box('chat-1')
    const next = withActiveChatSelection(source, 'chat-2')

    expect(next).not.toBe(source)
    expect(source.activeChatId).toBe('chat-1')
    expect(next.activeChatId).toBe('chat-2')
  })

  it('存在性同时检查 chatMetas 与 chats', () => {
    const target = box('', ['chat-1'], ['chat-2'])
    expect(activeChatIdExistsInBox(target, 'chat-1')).toBe(true)
    expect(activeChatIdExistsInBox(target, 'chat-2')).toBe(true)
    expect(activeChatIdExistsInBox(target, 'chat-3')).toBe(false)
    expect(activeChatIdExistsInBox(target, '')).toBe(false)
  })

  it('第一条会话按调用方指定的列表顺序取值', () => {
    const target = box('', ['chat-1'], ['chat-2', 'chat-3'])
    expect(firstChatIdInBox(target)).toBe('chat-2')
    expect(firstChatIdInBox(target, 'chats')).toBe('chat-1')
    expect(firstChatIdInBox(box(''), 'chats')).toBe('')
  })

  it('候选解析只接受真实存在的会话，并保持候选优先级', () => {
    const target = box('', ['chat-1', 'chat-2'], ['chat-3'])
    expect(resolveActiveChatSelection(target, ['missing', 'chat-2', 'chat-1'])).toBe('chat-2')
    expect(resolveActiveChatSelection(target, ['chat-3'])).toBe('chat-3')
    expect(resolveActiveChatSelection(target, ['missing'])).toBe('')
  })

  it('失效的当前选择会按 prefer 顺序兜底到第一条', () => {
    const target = box('stale', ['chat-1'], ['chat-2'])
    expect(reconcileActiveChatSelection(target)).toBe('chat-2')
    expect(target.activeChatId).toBe('chat-2')

    const chatsFirst = box('stale', ['chat-1'], ['chat-2'])
    expect(reconcileActiveChatSelection(chatsFirst, undefined, 'chats')).toBe('chat-1')
    expect(chatsFirst.activeChatId).toBe('chat-1')
  })

  it('仍然有效的当前选择不会被覆盖', () => {
    const target = box('chat-2', ['chat-1'], ['chat-2'])
    expect(reconcileActiveChatSelection(target)).toBe('chat-2')
    expect(target.activeChatId).toBe('chat-2')
  })
})
