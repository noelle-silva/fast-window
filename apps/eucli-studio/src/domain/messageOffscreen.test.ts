import { beforeEach, describe, expect, it } from 'vitest'
import { ASSISTANT_RUNNING_CONTENT } from './assistantRunState'
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

  it('combines the layout signature with the measured viewport width', () => {
    expect(messageLayoutKey('font-a', 800)).toBe('font-a@800')
    expect(messageLayoutKey('font-a', 800)).not.toBe(messageLayoutKey('font-a', 900))
    expect(messageLayoutKey('font-a', 800)).not.toBe(messageLayoutKey('font-b', 800))
  })
})

// 内容键是屏外占位高度的「内容条件」指纹，不是内容相等判断：它只读长度与结构字段，
// 逐条 O(parts)，绝不遍历正文。这一组用例把该契约与它刻意接受的取舍固定下来。
describe('message offscreen content key', () => {
  function assistantMessage(overrides: any = {}): any {
    return {
      id: 'm-1',
      role: 'assistant',
      type: 'assistant',
      content: '第一版',
      updatedAt: 10,
      parts: [{ type: 'text', text: '第一版' }],
      ...overrides,
    }
  }

  function keyOf(overrides: any = {}, presentation?: any): string {
    return messageOffscreenContentKey(assistantMessage(overrides), presentation)
  }

  it('changes when updatedAt advances', () => {
    expect(keyOf({ updatedAt: 11 })).not.toBe(keyOf())
  })

  it('changes when the visible content length changes', () => {
    expect(keyOf({ content: '第一版加长' })).not.toBe(keyOf())
  })

  it('changes when a reasoning part text length changes', () => {
    const withReasoning = (text: string) => keyOf({ parts: [{ type: 'reasoning', state: 'done', text }] })
    expect(withReasoning('思考')).not.toBe(withReasoning('思考得更久一点'))
    expect(withReasoning('思考')).toBe(withReasoning('思考'))
  })

  it('changes when a tool part gains a result', () => {
    const running = { type: 'tool', state: 'running', toolName: 'read', toolCallId: 'call-1', text: '' }
    const settled = { ...running, result: { status: 'ok', content: '输出' } }
    expect(keyOf({ parts: [settled] })).not.toBe(keyOf({ parts: [running] }))
    // result 只按 status 与内容长度入键：同长度不同输出视为同一条件，真实写入由 updatedAt 兜底。
    expect(keyOf({ parts: [{ ...running, result: { status: 'ok', content: '产出' } }] })).toBe(
      keyOf({ parts: [settled] }),
    )
    expect(keyOf({ parts: [{ ...running, result: { status: 'error', content: '输出' } }] })).not.toBe(
      keyOf({ parts: [settled] }),
    )
  })

  it('changes when a part runtime output grows', () => {
    const withRuntime = (bytes: number, preview: string) => ({
      type: 'tool',
      state: 'running',
      toolName: 'shell',
      toolCallId: 'call-2',
      runtimeOutput: { bytes, preview },
    })
    expect(keyOf({ parts: [withRuntime(64, '输出')] })).not.toBe(keyOf({ parts: [withRuntime(0, '')] }))
  })

  it('changes when presentation editing, user expansion or tool expansion changes', () => {
    const base = keyOf()
    expect(keyOf({}, { editing: true, editingLength: 3 })).not.toBe(base)
    expect(keyOf({}, { editing: true, editingLength: 4 })).not.toBe(keyOf({}, { editing: true, editingLength: 3 }))
    expect(keyOf({}, { userExpanded: true })).not.toBe(base)
    expect(keyOf({}, { toolExpanded: true })).not.toBe(base)
    expect(keyOf({}, {})).toBe(base)
  })

  it('changes when images, errors, control summary or run state changes', () => {
    const base = keyOf()
    expect(keyOf({ images: ['img-1'] })).not.toBe(base)
    expect(keyOf({ toolImages: ['tool-img-1'] })).not.toBe(base)
    expect(keyOf({ error: { message: '失败' } })).not.toBe(base)
    expect(keyOf({ control: { summaryVersion: 2, retainRecentMessages: 3 } })).not.toBe(base)
    expect(keyOf({ control: { summaryVersion: 2, retainRecentMessages: 4 } })).not.toBe(
      keyOf({ control: { summaryVersion: 2, retainRecentMessages: 3 } }),
    )
    expect(keyOf({ assistantRun: { status: 'running' } })).not.toBe(base)
    expect(keyOf({ streaming: true })).not.toBe(base)
    expect(keyOf({ pending: true })).not.toBe(base)
    expect(keyOf({ displayOnlyPendingRunTail: true })).not.toBe(base)
    expect(keyOf({ speakerRoleId: 'role-2' })).not.toBe(base)
    expect(keyOf({ modelRef: { modelId: 'model-b' } })).not.toBe(base)
  })

  it('keys the assistant running sentinel as empty visible text', () => {
    expect(keyOf({ content: ASSISTANT_RUNNING_CONTENT })).toBe(keyOf({ content: '' }))
  })

  // 契约（刻意降维的取舍）：同 updatedAt、同长度、不同内容 → 同一个键。
  // 原因：内容键只决定「屏外占位高度是否还值得信」。判错一次的全部代价是占位高度差一行，
  // 消息一旦可见就立刻被实测高度修正，不产生可见错误；而任何一次真实写入都会推进
  // updatedAt（见上面的 updatedAt 用例），该路径不会丢。为让每次列表渲染不再扫全文，
  // 「同时间戳、同长度的内容改动」识别能力被明确放弃，不得在别处重新引入正文字符串比较。
  it('treats same updatedAt with same lengths as the same content condition', () => {
    const first = keyOf()
    const rewritten = keyOf({ content: '第二版', parts: [{ type: 'text', text: '第二版' }] })
    expect(rewritten).toBe(first)
    // 同样的替换一旦推进 updatedAt（真实写入路径），键立刻失效。
    expect(keyOf({ content: '第二版', updatedAt: 11 })).not.toBe(first)
  })
})
