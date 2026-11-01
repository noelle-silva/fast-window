import { describe, expect, it } from 'vitest'
import { writeChatMessageFields } from './chatMessageFields'

describe('writeChatMessageFields', () => {
  it('只应用补丁里出现的字段，并保留消息对象身份', () => {
    const message: any = {
      id: 'm1',
      content: '原文',
      parts: [{ id: 'p1', type: 'text', text: '原文' }],
      pending: false,
    }
    const before = message

    const changed = writeChatMessageFields(message, {
      content: '新文',
      parts: [{ id: 'p1', type: 'text', text: '新文' }],
      updatedAt: 42,
    })

    expect(changed).toBe(true)
    expect(message).toBe(before)
    expect(message.content).toBe('新文')
    expect(message.parts).toHaveLength(1)
    expect(message.updatedAt).toBe(42)
    expect(message.pending).toBe(false)
  })

  it('值没有变化时不重写并返回 false', () => {
    const parts = [{ id: 'p1', type: 'text', text: '原文' }]
    const message: any = { id: 'm1', content: '原文', parts, pending: false }

    expect(writeChatMessageFields(message, { content: '原文', parts, pending: false })).toBe(false)
    expect(message.parts).toBe(parts)
  })

  it('运行状态字段同样经由统一入口落地', () => {
    const message: any = { id: 'm1' }

    writeChatMessageFields(message, {
      assistantRun: { generationId: 'run-1', status: 'running' },
      pending: true,
      streaming: true,
      error: { code: 'x' },
    })

    expect(message.assistantRun).toEqual({ generationId: 'run-1', status: 'running' })
    expect(message.pending).toBe(true)
    expect(message.streaming).toBe(true)
    expect(message.error).toEqual({ code: 'x' })
  })

  it('结构字段也可经同一入口写入', () => {
    const message: any = { id: 'm1' }

    writeChatMessageFields(message, {
      role: 'assistant',
      type: 'assistant',
      parentMid: 'p1',
      branchId: 'main',
      runtimeOnly: true,
    })

    expect(message.role).toBe('assistant')
    expect(message.type).toBe('assistant')
    expect(message.parentMid).toBe('p1')
    expect(message.branchId).toBe('main')
    expect(message.runtimeOnly).toBe(true)
  })

  it('无效消息或补丁安全返回 false', () => {
    expect(writeChatMessageFields(null, { content: 'x' })).toBe(false)
    expect(writeChatMessageFields({ id: 'm1' }, null as any)).toBe(false)
  })
})
