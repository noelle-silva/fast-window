import { describe, expect, it } from 'vitest'
import {
  appendChatMessage,
  ensureChatMessages,
  removeChatMessages,
  replaceChatMessageById,
  replaceChatMessages,
} from './chatMessageCollection'

function msg(id: string, content = id) {
  return { id, role: 'user', type: 'user', content, branchId: 'main', parentMid: '', createdAt: 1, updatedAt: 1 }
}

function chat(messages?: any[]) {
  return messages === undefined ? ({ id: 'chat-1' } as any) : { id: 'chat-1', messages }
}

describe('ensureChatMessages', () => {
  it('缺字段时补空数组', () => {
    const target = chat()
    expect(ensureChatMessages(target)).toEqual([])
    expect(target.messages).toEqual([])
  })

  it('已经是数组时保持同一个引用', () => {
    const messages = [msg('m1')]
    const target = chat(messages)
    expect(ensureChatMessages(target)).toBe(messages)
    expect(target.messages).toBe(messages)
  })
})

describe('replaceChatMessages', () => {
  it('整体替换并保留调用方顺序', () => {
    const target = chat([msg('old')])
    const next = [msg('m2'), msg('m1')]

    replaceChatMessages(target, next)

    expect(target.messages).toBe(next)
    expect(target.messages.map((item: any) => item.id)).toEqual(['m2', 'm1'])
  })
})

describe('appendChatMessage', () => {
  it('新消息追加到末尾', () => {
    const target = chat([msg('m1')])
    expect(appendChatMessage(target, msg('m2'))).toBe(true)
    expect(target.messages.map((item: any) => item.id)).toEqual(['m1', 'm2'])
  })

  it('同 id 已存在时保持原消息且不重复追加', () => {
    const existing = msg('m1', '原文')
    const target = chat([existing])

    expect(appendChatMessage(target, msg('m1', '新文'))).toBe(false)
    expect(target.messages).toHaveLength(1)
    expect(target.messages[0]).toBe(existing)
    expect(target.messages[0].content).toBe('原文')
  })

  it('缺字段时先补齐集合再追加', () => {
    const target = chat()
    appendChatMessage(target, msg('m1'))
    expect(target.messages.map((item: any) => item.id)).toEqual(['m1'])
  })
})

describe('replaceChatMessageById', () => {
  it('原位替换且不改变顺序', () => {
    const target = chat([msg('m1'), msg('m2'), msg('m3')])
    const next = msg('m2', '改后')

    expect(replaceChatMessageById(target, 'm2', next)).toBe(true)
    expect(target.messages.map((item: any) => item.id)).toEqual(['m1', 'm2', 'm3'])
    expect(target.messages[1]).toBe(next)
  })

  it('找不到目标时不追加也不改动集合', () => {
    const target = chat([msg('m1')])
    const before = target.messages

    expect(replaceChatMessageById(target, 'missing', msg('missing'))).toBe(false)
    expect(target.messages).toBe(before)
    expect(target.messages.map((item: any) => item.id)).toEqual(['m1'])
  })
})

describe('removeChatMessages', () => {
  it('删除一条消息并保留其余顺序', () => {
    const target = chat([msg('m1'), msg('m2'), msg('m3')])
    expect(removeChatMessages(target, 'm2')).toBe(1)
    expect(target.messages.map((item: any) => item.id)).toEqual(['m1', 'm3'])
  })

  it('批量删除只移除命中的 id', () => {
    const target = chat([msg('m1'), msg('m2'), msg('m3'), msg('m4')])
    expect(removeChatMessages(target, ['m1', 'm3', 'missing'])).toBe(2)
    expect(target.messages.map((item: any) => item.id)).toEqual(['m2', 'm4'])
  })

  it('没有命中时不重写集合', () => {
    const target = chat([msg('m1')])
    const before = target.messages
    expect(removeChatMessages(target, ['missing'])).toBe(0)
    expect(target.messages).toBe(before)
  })
})
