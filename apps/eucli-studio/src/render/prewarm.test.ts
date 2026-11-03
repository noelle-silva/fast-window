// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createBenchCapabilities, installRenderGlobals } from './perf/benchmark'
import { createMessageCache, messageHtmlCache } from './messageCache'
import { startRenderPrewarm, type PrewarmBatchSubmit, type RenderPrewarmOptions } from './prewarm'
import { assistantRenderCacheKey } from './renderCacheKey'
import { createUnifiedAssistantRenderEngine } from './unified/engine'
import { createMarkdownComputer } from './worker/compute'
import type { ParseWorkerOptions } from './worker/renderPool'
import type { WorkerItemResult, WorkerParseBatchItem, WorkerParseResult } from './worker/protocol'

type FakeCall = { items: WorkerParseBatchItem[]; options?: ParseWorkerOptions }

function assistant(id: string, content: string) {
  return { id, role: 'assistant', content }
}

function sourceRange(start: number, end: number): string[] {
  const out: string[] = []
  for (let index = start; index < end; index++) out.push(`内容 ${index}`)
  return out
}

function okItems(items: readonly WorkerParseBatchItem[]): WorkerItemResult<WorkerParseResult>[] {
  return items.map((item) => ({ key: item.key, ok: true, value: { html: `<p>${item.source}</p>` } }))
}

function createSubmitter(
  respond: (items: readonly WorkerParseBatchItem[]) => WorkerItemResult<WorkerParseResult>[],
) {
  const calls: FakeCall[] = []
  const submitBatch: PrewarmBatchSubmit = (items, options) => {
    const snapshot = items.map((item) => ({ ...item }))
    calls.push({ items: snapshot, options })
    return { result: Promise.resolve(respond(snapshot)), cancel: () => false }
  }
  return { calls, submitBatch }
}

function createDeferredSubmitter() {
  const calls: FakeCall[] = []
  const pending: Array<{
    items: WorkerParseBatchItem[]
    resolve: (items: WorkerItemResult<WorkerParseResult>[]) => void
  }> = []
  const submitBatch: PrewarmBatchSubmit = (items, options) => {
    const snapshot = items.map((item) => ({ ...item }))
    calls.push({ items: snapshot, options })
    let resolveResult: (items: WorkerItemResult<WorkerParseResult>[]) => void = () => {}
    const result = new Promise<WorkerItemResult<WorkerParseResult>[]>((resolve) => {
      resolveResult = resolve
    })
    pending.push({ items: snapshot, resolve: resolveResult })
    return { result, cancel: () => true }
  }
  return { calls, pending, submitBatch }
}

const IMMEDIATE_FRAME: RenderPrewarmOptions['frameBudget'] = {
  now: () => 0,
  yieldToMain: () => ({ promise: Promise.resolve(), cancel: () => {} }),
}

function baseOptions(
  overrides: Partial<RenderPrewarmOptions> &
    Pick<RenderPrewarmOptions, 'messages' | 'scope' | 'submitBatch'>,
): RenderPrewarmOptions {
  return {
    policy: 'original',
    stickersEnabled: false,
    getStickerPath: null,
    sanitizeHtml: (html) => String(html || ''),
    frameBudget: IMMEDIATE_FRAME,
    ...overrides,
  }
}

describe('会话打开时的缓存预计算', () => {
  it('缓存键与引擎共用同一构造函数', () => {
    const key = assistantRenderCacheKey({
      source: '正文',
      policy: 'unsafe',
      stickersEnabled: true,
      hasStickerPath: true,
      scope: 'chat-1',
    })
    expect(key).toBe(
      assistantRenderCacheKey({
        source: '正文',
        policy: 'unsafe',
        stickersEnabled: true,
        hasStickerPath: true,
        scope: 'chat-1',
      }),
    )
    expect(key).not.toBe(
      assistantRenderCacheKey({
        source: '正文',
        policy: 'unsafe',
        stickersEnabled: false,
        hasStickerPath: true,
        scope: 'chat-1',
      }),
    )
    // 流式中态与空会话身份不产生缓存键，与引擎判定一致。
    expect(assistantRenderCacheKey({ source: 'x', scope: 'chat-1', streaming: true })).toBe('')
    expect(assistantRenderCacheKey({ source: 'x', scope: '' })).toBe('')
  })

  it('按挂载顺序分块：先首屏，再更早的批次', async () => {
    const messages = Array.from({ length: 25 }, (_, index) => assistant(`m${index}`, `内容 ${index}`))
    const fake = createSubmitter(okItems)
    const run = startRenderPrewarm(
      baseOptions({
        messages,
        scope: 'chat-order',
        submitBatch: fake.submitBatch,
        initialSize: 5,
        batchSize: 10,
        chunkSize: 4,
      }),
    )
    await run.done

    expect(fake.calls).toHaveLength(7)
    const flattened = fake.calls.flatMap((call) => call.items.map((item) => item.source))
    expect(flattened).toEqual([...sourceRange(20, 25), ...sourceRange(10, 20), ...sourceRange(0, 10)])
  })

  it('消毒后写入缓存，键与引擎一致', async () => {
    const cache = createMessageCache()
    const fake = createSubmitter(okItems)
    const run = startRenderPrewarm(
      baseOptions({
        messages: [assistant('m1', '第一段')],
        scope: 'chat-write',
        submitBatch: fake.submitBatch,
        cache,
        sanitizeHtml: (html) => `<div data-sanitized="1">${String(html)}</div>`,
      }),
    )
    const result = await run.done

    const key = assistantRenderCacheKey({
      source: '第一段',
      policy: 'original',
      stickersEnabled: false,
      hasStickerPath: false,
      scope: 'chat-write',
    })
    expect(cache.get(key)).toEqual(['<div data-sanitized="1"><p>第一段</p></div>'])
    expect(result).toMatchObject({ requested: 1, written: 1, skipped: 0, cancelled: false })
  })

  it('已缓存的消息不再请求后台', async () => {
    const cache = createMessageCache()
    const messages = [assistant('m1', '甲'), assistant('m2', '乙')]
    const first = createSubmitter(okItems)
    await startRenderPrewarm(
      baseOptions({ messages, scope: 'chat-cached', submitBatch: first.submitBatch, cache }),
    ).done
    expect(first.calls).toHaveLength(1)

    const second = createSubmitter(okItems)
    const result = await startRenderPrewarm(
      baseOptions({ messages, scope: 'chat-cached', submitBatch: second.submitBatch, cache }),
    ).done

    expect(second.calls).toHaveLength(0)
    expect(result).toMatchObject({ requested: 0, written: 0, skipped: 0 })
  })

  it('取消后不再请求、不再写缓存', async () => {
    const cache = createMessageCache()
    const fake = createDeferredSubmitter()
    const messages = [assistant('m1', '甲'), assistant('m2', '乙'), assistant('m3', '丙')]
    const run = startRenderPrewarm(
      baseOptions({
        messages,
        scope: 'chat-cancel',
        submitBatch: fake.submitBatch,
        cache,
        chunkSize: 1,
        maxInFlight: 1,
      }),
    )

    expect(fake.calls).toHaveLength(1)
    run.cancel()
    fake.pending[0]?.resolve(okItems(fake.pending[0].items))
    const result = await run.done
    await Promise.resolve()

    expect(fake.calls).toHaveLength(1)
    expect(cache.size).toBe(0)
    expect(result.cancelled).toBe(true)
  })

  it('缓存代际变化后不再写入旧产物', async () => {
    const cache = createMessageCache()
    const fake = createDeferredSubmitter()
    const run = startRenderPrewarm(
      baseOptions({
        messages: [assistant('m1', '甲')],
        scope: 'chat-epoch',
        submitBatch: fake.submitBatch,
        cache,
        maxInFlight: 1,
      }),
    )

    cache.bumpGeneration()
    fake.pending[0]?.resolve(okItems(fake.pending[0].items))
    const result = await run.done
    await Promise.resolve()

    expect(cache.size).toBe(0)
    expect(result.written).toBe(0)
  })

  it('后台逐项失败与消毒失败都安静跳过，不写错误结果', async () => {
    const cache = createMessageCache()
    const messages = [
      assistant('m1', '好1'),
      assistant('m2', '坏'),
      assistant('m3', '炸'),
      assistant('m4', '好2'),
    ]
    const fake = createSubmitter((items) =>
      items.map((item) =>
        item.source === '坏'
          ? { key: item.key, ok: false as const, error: { name: 'Error', message: '解析失败' } }
          : { key: item.key, ok: true as const, value: { html: `<p>${item.source}</p>` } },
      ),
    )
    const run = startRenderPrewarm(
      baseOptions({
        messages,
        scope: 'chat-failure',
        submitBatch: fake.submitBatch,
        cache,
        chunkSize: 2,
        sanitizeHtml: (html) => {
          if (String(html).includes('炸')) throw new Error('消毒失败')
          return String(html)
        },
      }),
    )
    const result = await run.done

    const keyOf = (source: string) =>
      assistantRenderCacheKey({
        source,
        policy: 'original',
        stickersEnabled: false,
        hasStickerPath: false,
        scope: 'chat-failure',
      })
    expect(cache.get(keyOf('好1'))).not.toBeNull()
    expect(cache.get(keyOf('好2'))).not.toBeNull()
    expect(cache.get(keyOf('坏'))).toBeNull()
    expect(cache.get(keyOf('炸'))).toBeNull()
    expect(result).toMatchObject({ written: 2, skipped: 2 })
  })

  it('线程池拒绝时安静结束，不抛错也不写缓存', async () => {
    const cache = createMessageCache()
    const fake = createSubmitter(okItems)
    const submitBatch: PrewarmBatchSubmit = () => {
      throw new Error('线程池已达并发上限')
    }
    const messages = [assistant('m1', '甲'), assistant('m2', '乙')]
    const run = startRenderPrewarm(
      baseOptions({ messages, scope: 'chat-overload', submitBatch, cache }),
    )
    const result = await run.done

    expect(cache.size).toBe(0)
    expect(result).toMatchObject({ written: 0, skipped: 2 })
    expect(fake.calls).toHaveLength(0)
  })
})

describe('预计算与同步引擎的缓存衔接', () => {
  beforeAll(async () => {
    await installRenderGlobals()
  })

  beforeEach(() => {
    messageHtmlCache.clear()
  })

  it('预计算完成后同步渲染同一消息直接命中缓存', async () => {
    const computer = createMarkdownComputer()
    const text = '# 标题\n\n正文 **加粗**'
    const submitBatch: PrewarmBatchSubmit = (items) => ({
      result: Promise.resolve(
        items.map((item) => ({
          key: item.key,
          ok: true as const,
          value: { html: computer.renderMarkdown(item.source) },
        })),
      ),
      cancel: () => false,
    })
    const run = startRenderPrewarm(
      baseOptions({
        messages: [assistant('m1', text)],
        scope: 'chat-engine',
        submitBatch,
        cache: messageHtmlCache,
        policy: 'unsafe',
      }),
    )
    await run.done
    expect(messageHtmlCache.size).toBe(1)

    const engine = createUnifiedAssistantRenderEngine(createBenchCapabilities())
    const host = document.createElement('div')
    document.body.appendChild(host)
    engine.renderAssistantInto(host, text, {
      renderSafetyPolicy: 'unsafe',
      cacheScope: 'chat-engine',
    })

    // 键或产物不一致都会多出一条缓存，因此这里同时断言键与产物的衔接。
    expect(messageHtmlCache.size).toBe(1)
    expect(host.textContent).toContain('标题')
    expect(host.textContent).toContain('加粗')
    host.remove()
  })
})
