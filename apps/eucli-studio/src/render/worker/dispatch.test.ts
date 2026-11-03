import { describe, expect, it } from 'vitest'

import { createWorkerRequestHandler } from './dispatch'
import type { MarkdownComputer } from './compute'
import { WORKER_PROTOCOL_VERSION } from './protocol'

// ============================================================================
// 协议分发测试：验证成功、整体失败与批内逐项失败都能被明确表达。
// 使用假计算器注入失败，不依赖真实解析异常。
// ============================================================================

function createFakeComputer(): MarkdownComputer {
  return {
    renderMarkdown(source: string) {
      if (source === 'boom') throw new Error('解析失败')
      return `<p>${source}</p>`
    },
    renderMath(tex: string, display: boolean) {
      if (tex === 'boom') throw new Error('公式失败')
      return `${display ? 'block' : 'inline'}:${tex}`
    },
  }
}

describe('Worker 协议分发', () => {
  const handle = createWorkerRequestHandler(createFakeComputer())

  it('ping 返回协议版本', () => {
    const response = handle({ id: 1, type: 'ping' })
    expect(response).toEqual({
      id: 1,
      type: 'ping',
      ok: true,
      result: { protocolVersion: WORKER_PROTOCOL_VERSION },
    })
  })

  it('parse 成功返回 HTML', () => {
    const response = handle({ id: 2, type: 'parse', source: '你好' })
    expect(response).toEqual({
      id: 2,
      type: 'parse',
      ok: true,
      result: { html: '<p>你好</p>' },
    })
  })

  it('parse 失败返回错误而不是丢消息', () => {
    const response = handle({ id: 3, type: 'parse', source: 'boom' })
    expect(response.ok).toBe(false)
    if (response.ok) throw new Error('预期失败响应')
    expect(response.id).toBe(3)
    expect(response.error.message).toBe('解析失败')
    expect(response.error.name).toBe('Error')
  })

  it('parse-batch 保持顺序并逐项报告失败', () => {
    const response = handle({
      id: 4,
      type: 'parse-batch',
      items: [
        { key: 'a', source: '甲' },
        { key: 'b', source: 'boom' },
        { key: 'c', source: '乙' },
      ],
    })
    expect(response.ok).toBe(true)
    if (!response.ok || response.type !== 'parse-batch') throw new Error('预期批量成功响应')

    expect(response.result.items.map((item) => item.key)).toEqual(['a', 'b', 'c'])
    expect(response.result.items[0]).toEqual({ key: 'a', ok: true, value: { html: '<p>甲</p>' } })
    expect(response.result.items[1]).toMatchObject({
      key: 'b',
      ok: false,
      error: { name: 'Error', message: '解析失败' },
    })
    expect(response.result.items[2]).toEqual({ key: 'c', ok: true, value: { html: '<p>乙</p>' } })
  })

  it('math-batch 返回逐项 KaTeX HTML', () => {
    const response = handle({
      id: 5,
      type: 'math-batch',
      items: [
        { key: 'x', tex: 'x^2', display: false },
        { key: 'y', tex: 'boom', display: true },
      ],
    })
    expect(response.ok).toBe(true)
    if (!response.ok || response.type !== 'math-batch') throw new Error('预期公式批量成功响应')

    expect(response.result.items[0]).toEqual({ key: 'x', ok: true, value: { html: 'inline:x^2' } })
    expect(response.result.items[1]).toMatchObject({
      key: 'y',
      ok: false,
      error: { name: 'Error', message: '公式失败' },
    })
  })
})
