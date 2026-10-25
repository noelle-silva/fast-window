import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_MESSAGE_OFFSCREEN_SKIP_ENABLED,
  MESSAGE_OFFSCREEN_HEIGHT_MEMORY_LIMIT,
  MessageHeightMemory,
  estimateMessageHeight,
  messageHeightMemory,
  messageLayoutKey,
  messageOffscreenContentKey,
  normalizeMessageOffscreenSkipEnabled,
} from './messageOffscreen'

describe('message offscreen skip switch', () => {
  it('defaults to enabled and keeps an explicit boolean', () => {
    expect(DEFAULT_MESSAGE_OFFSCREEN_SKIP_ENABLED).toBe(true)
    expect(normalizeMessageOffscreenSkipEnabled(undefined)).toBe(true)
    expect(normalizeMessageOffscreenSkipEnabled(null)).toBe(true)
    expect(normalizeMessageOffscreenSkipEnabled('false')).toBe(true)
    expect(normalizeMessageOffscreenSkipEnabled(true)).toBe(true)
    expect(normalizeMessageOffscreenSkipEnabled(false)).toBe(false)
  })
})

describe('message offscreen height memory', () => {
  it('only returns a height for the same message, layout condition and content condition', () => {
    const memory = new MessageHeightMemory()
    memory.set('m-1', 'layout-a', 'content-a', 240)

    expect(memory.get('m-1', 'layout-a', 'content-a')).toBe(240)
    expect(memory.get('m-1', 'layout-b', 'content-a')).toBeNull()
    expect(memory.get('m-1', 'layout-a', 'content-b')).toBeNull()
    expect(memory.get('m-2', 'layout-a', 'content-a')).toBeNull()
  })

  it('replaces the previous height and keeps the oldest entries bounded', () => {
    const memory = new MessageHeightMemory()
    memory.set('m-1', 'layout', 'content', 100)
    memory.set('m-1', 'layout', 'content', 180)
    expect(memory.get('m-1', 'layout', 'content')).toBe(180)

    for (let i = 0; i < MESSAGE_OFFSCREEN_HEIGHT_MEMORY_LIMIT + 10; i++) {
      memory.set(`entry-${i}`, 'layout', 'content', 50 + i)
    }
    expect(memory.size).toBe(MESSAGE_OFFSCREEN_HEIGHT_MEMORY_LIMIT)
    expect(memory.get('entry-0', 'layout', 'content')).toBeNull()
    expect(memory.get('entry-10', 'layout', 'content')).not.toBeNull()
  })
})

describe('message offscreen estimates and keys', () => {
  beforeEach(() => {
    messageHeightMemory.clear()
  })

  it('keeps a positive estimate that grows with content and shrinks with wider containers', () => {
    const short = { id: 'm-1', role: 'assistant', content: '一行' }
    const long = { id: 'm-2', role: 'assistant', content: '很长'.repeat(400) }

    expect(estimateMessageHeight(short, 800)).toBeGreaterThan(0)
    expect(estimateMessageHeight(long, 800)).toBeGreaterThan(estimateMessageHeight(short, 800))
    expect(estimateMessageHeight(long, 1600)).toBeLessThan(estimateMessageHeight(long, 800))
  })

  it('invalidates the content key when content, revision or presentation changes', () => {
    const message: any = {
      id: 'm-1',
      role: 'assistant',
      content: '第一版',
      updatedAt: 10,
      parts: [{ type: 'text', text: '第一版' }],
    }
    const base = messageOffscreenContentKey(message)

    expect(messageOffscreenContentKey({ ...message, updatedAt: 11 })).not.toBe(base)
    expect(messageOffscreenContentKey({ ...message, content: '第二版' })).not.toBe(base)
    expect(messageOffscreenContentKey({ ...message, parts: [{ type: 'text', text: '第二版' }] })).not.toBe(base)
    expect(messageOffscreenContentKey(message, { userExpanded: true })).not.toBe(base)
    expect(messageOffscreenContentKey(message, { toolExpanded: true })).not.toBe(base)
    expect(messageOffscreenContentKey(message, { editing: true, editingLength: 3 })).not.toBe(base)
  })

  it('combines the layout signature with the measured viewport width', () => {
    expect(messageLayoutKey('font-a', 800)).toBe('font-a@800')
    expect(messageLayoutKey('font-a', 800)).not.toBe(messageLayoutKey('font-a', 900))
    expect(messageLayoutKey('font-a', 800)).not.toBe(messageLayoutKey('font-b', 800))
  })
})
