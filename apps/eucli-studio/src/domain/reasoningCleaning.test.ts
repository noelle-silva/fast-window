import { describe, expect, it } from 'vitest'
import {
  cleanMessageReasoningParts,
  parseReasoningCleanKeywords,
  removeReasoningKeywords,
} from './reasoningCleaning'

describe('parseReasoningCleanKeywords', () => {
  it('按行拆分、去空白、去重、去空行', () => {
    expect(parseReasoningCleanKeywords('  甲\n乙 \n\n甲\n丙  \n')).toEqual(['甲', '乙', '丙'])
  })

  it('非字符串输入按空处理', () => {
    expect(parseReasoningCleanKeywords(null)).toEqual([])
    expect(parseReasoningCleanKeywords(undefined)).toEqual([])
  })
})

describe('removeReasoningKeywords', () => {
  it('删除所有命中的关键词字面量', () => {
    expect(removeReasoningKeywords('甲甲思考甲乙乙', ['甲', '乙'])).toBe('思考')
  })

  it('关键词里的正则符号按字面量处理', () => {
    expect(removeReasoningKeywords('a.b.c', ['.'])).toBe('abc')
    expect(removeReasoningKeywords('x(1)y(2)', ['(1)', '(2)'])).toBe('xy')
  })

  it('没有命中的关键词时原样返回', () => {
    expect(removeReasoningKeywords('思考过程', ['不存在'])).toBe('思考过程')
  })
})

describe('cleanMessageReasoningParts', () => {
  it('只改思维链部件的文本，正文与工具部件不受影响', () => {
    const message: any = {
      id: 'm1',
      content: '正文里的甲要保留',
      parts: [
        { id: 'p1', type: 'text', text: '正文里的甲要保留' },
        { id: 'p2', type: 'reasoning', text: '先甲思考乙一下', signature: 'sig甲', data: 'data乙', durationMs: 100 },
        { id: 'p3', type: 'tool', toolName: 'shell_command', input: { command: 'echo 甲' } },
      ],
    }
    const changed = cleanMessageReasoningParts(message, ['甲', '乙'])
    expect(changed).toBe(true)
    expect(message.parts[0].text).toBe('正文里的甲要保留')
    expect(message.parts[1].text).toBe('先思考一下')
    expect(message.parts[1].signature).toBe('sig甲')
    expect(message.parts[1].data).toBe('data乙')
    expect(message.parts[2].input.command).toBe('echo 甲')
    expect(message.content).toBe('正文里的甲要保留')
  })

  it('没有命中的关键词时返回 false 且不改动', () => {
    const message: any = { id: 'm2', parts: [{ id: 'p1', type: 'reasoning', text: '思考' }] }
    expect(cleanMessageReasoningParts(message, ['不存在'])).toBe(false)
    expect(message.parts[0].text).toBe('思考')
  })

  it('消息没有 parts 时安全返回 false', () => {
    expect(cleanMessageReasoningParts({ id: 'm3' }, ['甲'])).toBe(false)
    expect(cleanMessageReasoningParts(null, ['甲'])).toBe(false)
  })
})
