import { describe, expect, it } from 'vitest'
import {
  SessionWireContractError,
  isSessionWireV1,
  validateSessionWire,
  validateSessionWindowPage,
} from './sessionWireContract'

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    branchId: 'main',
    parentMessageId: 'p0',
    createdAt: 1,
    content: 'hi',
    ...overrides,
  }
}

function wire(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: 'session-1',
    asyncToolTasks: [],
    messages: [message()],
    ...overrides,
  }
}

describe('sessionWireContract', () => {
  it('accepts a well-formed v1 session', () => {
    const validated = validateSessionWire(wire())
    expect(validated.schemaVersion).toBe(1)
    expect(validated.messages).toHaveLength(1)
    expect(validated.asyncToolTasks).toEqual([])
  })

  it('passes legacy payloads through without schemaVersion', () => {
    const legacy = { id: 'session-1', messages: [message()] }
    expect(isSessionWireV1(legacy)).toBe(false)
    const validated = validateSessionWire(legacy)
    expect(validated.schemaVersion).toBe(0)
    expect(validated.messages).toHaveLength(1)
  })

  it('rejects an unsupported schemaVersion', () => {
    expect(() => validateSessionWire(wire({ schemaVersion: 2 }))).toThrow(SessionWireContractError)
  })

  it('requires asyncToolTasks to be present', () => {
    const payload = wire()
    delete (payload as any).asyncToolTasks
    expect(() => validateSessionWire(payload)).toThrow(/asyncToolTasks/)
  })

  it('rejects a message without branchId', () => {
    expect(() => validateSessionWire(wire({ messages: [message({ branchId: '' })] }))).toThrow(/branchId/)
  })

  it('rejects a non-root message without parentMessageId', () => {
    const messages = [message({ id: 'm1' }), message({ id: 'm2', parentMessageId: '' })]
    expect(() => validateSessionWire(wire({ messages }))).toThrow(/parentMessageId/)
  })

  it('allows the first message to omit parentMessageId for a whole session', () => {
    const messages = [message({ id: 'm1', parentMessageId: '' })]
    expect(() => validateSessionWire(wire({ messages }))).not.toThrow()
  })

  it('rejects messages out of (createdAt, id) order', () => {
    const messages = [message({ id: 'm2', createdAt: 5 }), message({ id: 'm1', createdAt: 1 })]
    expect(() => validateSessionWire(wire({ messages }))).toThrow(/升序/)
  })

  it('rejects duplicated content and text parts', () => {
    const messages = [message({ content: 'hi', parts: [{ id: 'p1', type: 'text', text: 'hi' }] })]
    expect(() => validateSessionWire(wire({ messages }))).toThrow(/重复/)
  })

  it('rejects content that disagrees with text parts', () => {
    const messages = [message({ content: 'hi', parts: [{ id: 'p1', type: 'text', text: 'other' }] })]
    expect(() => validateSessionWire(wire({ messages }))).toThrow(/不一致/)
  })

  it('validates window pages without session-level fields', () => {
    const page = { messages: [message()], nextCursor: 'c2' }
    expect(() => validateSessionWindowPage(page)).not.toThrow()
    expect(() => validateSessionWindowPage({ messages: [message({ id: '' })] })).toThrow(/id/)
    expect(() => validateSessionWindowPage({})).toThrow(/messages/)
  })

  // 首窗 ≤ limit 条，短会话必然把根消息一起带进来；根消息按契约就是无父的。
  // 若这里拒绝，所有消息数 ≤ limit 的会话都会在首屏加载失败。
  it('allows a root message without parentMessageId in a window page', () => {
    const page = {
      id: 'session-1',
      messages: [message({ id: 'm1', parentMessageId: '' })],
      nextCursor: '',
    }
    expect(() => validateSessionWindowPage(page)).not.toThrow()
  })

  it('allows a root message followed by children in a window page', () => {
    const page = {
      id: 'session-1',
      messages: [
        message({ id: 'm1', parentMessageId: '', createdAt: 1 }),
        message({ id: 'm2', parentMessageId: 'm1', createdAt: 2 }),
        message({ id: 'm3', parentMessageId: 'm2', createdAt: 3 }),
      ],
      nextCursor: 'c2',
    }
    expect(() => validateSessionWindowPage(page)).not.toThrow()
  })

  it('still rejects a non-root message without parentMessageId in a window page', () => {
    const page = {
      id: 'session-1',
      messages: [
        message({ id: 'm1', parentMessageId: '', createdAt: 1 }),
        message({ id: 'm2', parentMessageId: '', createdAt: 2 }),
      ],
      nextCursor: '',
    }
    expect(() => validateSessionWindowPage(page)).toThrow(/parentMessageId/)
  })

  it('accepts a window page whose root uses parentMid instead of parentMessageId', () => {
    const page = {
      id: 'session-1',
      messages: [{ id: 'm1', branchId: 'main', parentMid: '', createdAt: 1, content: 'hi' }],
      nextCursor: '',
    }
    expect(() => validateSessionWindowPage(page)).not.toThrow()
  })
})
