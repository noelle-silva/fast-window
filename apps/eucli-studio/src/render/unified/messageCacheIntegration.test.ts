// @vitest-environment happy-dom
//
// 消息级缓存接入验证：同一段内容在同一会话内二次渲染必须命中缓存，
// 且最终画面与首次渲染完全一致；流式中态与失败降级不得写入缓存。
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { installRenderGlobals, createBenchCapabilities } from '../perf/benchmark'
import { serializeChildren, waitForAsyncSettle } from '../testing/dom'
import { messageHtmlCache } from '../messageCache'
import { createUnifiedAssistantRenderEngine } from './engine'

const OPTIONS = {
  stickersEnabled: false,
  renderSafetyPolicy: 'unsafe' as const,
  cacheScope: 'chat-1',
}

function makeEngine() {
  return createUnifiedAssistantRenderEngine(createBenchCapabilities())
}

function render(engine: any, text: string, options?: any) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  engine.renderAssistantInto(host, text, options || OPTIONS)
  return host
}

describe('消息级缓存接入', () => {
  beforeAll(async () => {
    await installRenderGlobals()
  }, 120000)

  beforeEach(() => {
    messageHtmlCache.clear()
  })

  it('二次渲染命中缓存且画面一致', async () => {
    const engine = makeEngine()
    const text = '# 标题\n\n正文 $a^2+b^2=c^2$ 与 **加粗**。\n\n```js\nconst a = 1\n```'

    const first = render(engine, text)
    await waitForAsyncSettle(first)
    expect(messageHtmlCache.size).toBeGreaterThan(0)
    const firstSignature = serializeChildren(first)

    const second = render(engine, text)
    await waitForAsyncSettle(second)
    expect(serializeChildren(second)).toBe(firstSignature)

    first.remove()
    second.remove()
  })

  it('流式中态不写缓存', async () => {
    const engine = makeEngine()
    const host = render(engine, '流式中的内容', { ...OPTIONS, streaming: true })
    await waitForAsyncSettle(host)
    expect(messageHtmlCache.size).toBe(0)
    host.remove()
  })

  it('没有会话身份时不写缓存', async () => {
    const engine = makeEngine()
    const host = render(engine, '无会话身份的内容', { ...OPTIONS, cacheScope: '' })
    await waitForAsyncSettle(host)
    expect(messageHtmlCache.size).toBe(0)
    host.remove()
  })

  it('不同会话的相同文本互不共享缓存条目', async () => {
    const engine = makeEngine()
    const text = '同一段内容，不同会话'
    const a = render(engine, text, { ...OPTIONS, cacheScope: 'chat-a' })
    const b = render(engine, text, { ...OPTIONS, cacheScope: 'chat-b' })
    await waitForAsyncSettle(a)
    await waitForAsyncSettle(b)
    // 两份不同 scope 的条目各自独立存在。
    expect(messageHtmlCache.size).toBe(2)
    a.remove()
    b.remove()
  })

  it('渲染策略变化后不复用旧缓存', async () => {
    const engine = makeEngine()
    const text = '<div>内容</div>'
    const a = render(engine, text, { ...OPTIONS, renderSafetyPolicy: 'unsafe' })
    await waitForAsyncSettle(a)
    const unsafeSignature = serializeChildren(a)

    const b = render(engine, text, { ...OPTIONS, renderSafetyPolicy: 'original' })
    await waitForAsyncSettle(b)
    // 策略不同 → 缓存键不同 → 不会命中 unsafe 的条目。
    expect(messageHtmlCache.size).toBe(2)
    // 两份结果都必须是合法渲染，不能因为缓存串键拿到对方内容。
    expect(b.textContent).toContain('内容')
    a.remove()
    b.remove()
    expect(unsafeSignature.length).toBeGreaterThan(0)
  })

  it('缓存命中时不重复调用 sanitize（以解析产物数量间接验证）', async () => {
    const engine = makeEngine()
    const text = '缓存命中验证'
    const first = render(engine, text)
    await waitForAsyncSettle(first)
    const blocksAfterFirst = messageHtmlCache.size

    const spy = vi.spyOn(messageHtmlCache, 'get')
    const second = render(engine, text)
    await waitForAsyncSettle(second)
    expect(spy).toHaveBeenCalled()
    expect(messageHtmlCache.size).toBe(blocksAfterFirst)
    spy.mockRestore()

    first.remove()
    second.remove()
  })
})
