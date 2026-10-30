import { afterEach, describe, expect, it } from 'vitest'
import {
  beginSwitchSpan,
  createSwitchSpanCollector,
  resetSwitchSpanForTests,
  setSwitchTraceSink,
  type SwitchMark,
} from './switchSpan'

afterEach(() => {
  resetSwitchSpanForTests()
})

describe('switchSpan 八边界埋点', () => {
  it('完整一次切换会依次上报全部边界', () => {
    const marks: SwitchMark[] = []
    setSwitchTraceSink((mark) => marks.push(mark))

    const span = beginSwitchSpan('role:role-1:chat-1')
    span.mark('frontend.select')
    span.mark('frontend.command')
    span.mark('frontend.bodyReady')
    span.mark('frontend.painted')
    span.mark('frontend.enhanceStart')
    span.mark('frontend.enhanceEnd')
    span.settle()

    expect(marks.map((mark) => mark.boundary)).toEqual([
      'frontend.select',
      'frontend.command',
      'frontend.bodyReady',
      'frontend.painted',
      'frontend.enhanceStart',
      'frontend.enhanceEnd',
      'frontend.settled',
    ])
    // 同一次切换共享同一个 switchId。
    expect(new Set(marks.map((mark) => mark.switchId)).size).toBe(1)
  })

  it('同一边界只上报一次（观测不制造噪声）', () => {
    const marks: SwitchMark[] = []
    setSwitchTraceSink((mark) => marks.push(mark))
    const span = beginSwitchSpan('k')
    span.mark('frontend.bodyReady')
    span.mark('frontend.bodyReady')
    span.mark('frontend.bodyReady')
    expect(marks).toHaveLength(1)
  })

  it('loadId 关联多次正文加载，且各自唯一', () => {
    const marks: SwitchMark[] = []
    setSwitchTraceSink((mark) => marks.push(mark))
    const span = beginSwitchSpan('k')
    const first = span.beginLoad()
    const second = span.beginLoad()
    span.mark('frontend.bodyReady', { loadId: first })
    span.mark('frontend.settled')

    expect(first).toMatch(/^ld-/)
    expect(second).toMatch(/^ld-/)
    expect(first).not.toBe(second)
    expect(marks[0].loadId).toBe(first)
  })

  it('fail 记录失败终态与原因', () => {
    const marks: SwitchMark[] = []
    setSwitchTraceSink((mark) => marks.push(mark))
    const span = beginSwitchSpan('k')
    span.mark('frontend.select')
    span.fail('网络断了')

    const failed = marks.find((mark) => mark.boundary === 'frontend.failed')
    expect(failed?.reason).toBe('网络断了')
  })

  it('未挂 sink 时所有 mark 都是空操作', () => {
    const span = beginSwitchSpan('k')
    expect(() => {
      span.mark('frontend.select')
      span.settle()
      span.fail('x')
      span.beginLoad()
    }).not.toThrow()
  })

  it('sink 抛错不影响调用方', () => {
    setSwitchTraceSink(() => {
      throw new Error('sink 崩了')
    })
    const span = beginSwitchSpan('k')
    expect(() => span.mark('frontend.select')).not.toThrow()
  })
})

describe('switchSpan 基准收集器', () => {
  it('聚合出一次切换的耗时分解', () => {
    const collector = createSwitchSpanCollector()
    setSwitchTraceSink(collector.sink)

    const span = beginSwitchSpan('role:role-1:chat-1')
    const loadId = span.beginLoad()
    span.mark('frontend.select')
    span.mark('frontend.bodyReady', { loadId })
    span.mark('frontend.painted')
    span.settle()

    const summaries = collector.summaries()
    expect(summaries).toHaveLength(1)
    expect(summaries[0].key).toBe('role:role-1:chat-1')
    expect(summaries[0].boundaries['frontend.select']).toBeGreaterThanOrEqual(0)
    expect(summaries[0].boundaries['frontend.settled']).toBeGreaterThanOrEqual(0)
    expect(summaries[0].loadIds).toEqual([loadId])
    expect(summaries[0].failed).toBeUndefined()
  })

  it('记录失败原因', () => {
    const collector = createSwitchSpanCollector()
    setSwitchTraceSink(collector.sink)
    beginSwitchSpan('k').fail('超时')
    expect(collector.summaries()[0].failed).toBe('超时')
  })

  it('take 取出后清空', () => {
    const collector = createSwitchSpanCollector()
    setSwitchTraceSink(collector.sink)
    beginSwitchSpan('k').settle()
    expect(collector.take()).toHaveLength(1)
    expect(collector.summaries()).toHaveLength(0)
  })

  it('多次切换各自独立成条', () => {
    const collector = createSwitchSpanCollector()
    setSwitchTraceSink(collector.sink)
    beginSwitchSpan('a').settle()
    beginSwitchSpan('b').settle()
    const summaries = collector.summaries()
    expect(summaries).toHaveLength(2)
    expect(summaries.map((s) => s.key).sort()).toEqual(['a', 'b'])
  })
})
