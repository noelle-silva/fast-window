// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const captured = vi.hoisted(() => ({ offscreenOptions: [] as any[] }))

// 页面可见性由 SessionPageStack 的 context 提供（默认可见）。
// 这里只替换取值入口，其余导出一律用真实实现：测试需要驱动「页面切走 / 切回」，
// 而真实 context 只能在页面栈内部写，页面栈本身不该被拖进这些用例。
const pageVisibility = vi.hoisted(() => ({ active: true }))
vi.mock('./SessionPageStack', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./SessionPageStack')>()
  return { ...actual, useSessionPageVisible: () => pageVisibility.active }
})

// 双 rAF 是「首屏画完之后才开始预热」的唯一时间轴。
// 做成显式帧泵，测试才能精确表达「两帧走完了」与「帧被取消在途」。
const rafPump = vi.hoisted(() => {
  const pending = new Map<number, (time: number) => void>()
  let nextId = 1
  return {
    request(callback: (time: number) => void) {
      const id = nextId++
      pending.set(id, callback)
      return id
    },
    cancel(id: number) {
      pending.delete(id)
    },
    // 只执行本帧已经排好的回调：回调里新排的属于下一帧。
    runFrame() {
      const frame = Array.from(pending.values())
      pending.clear()
      for (const callback of frame) callback(0)
    },
    pendingCount() {
      return pending.size
    },
    reset() {
      pending.clear()
      nextId = 1
    },
  }
})

vi.mock('../hooks/useMessageOffscreen', () => ({
  useMessageOffscreen: (options: any) => {
    captured.offscreenOptions.push(options)
    return { handle: { tag: 'offscreen-handle' }, attachScrollElement: () => {} }
  },
}))

vi.mock('../hooks/useMessageBatchMount', () => ({
  useMessageBatchMount: ({ messages }: any) => ({ batchGroups: [], visibleMessages: messages }),
}))

vi.mock('./ChatMessageList', () => ({
  ChatMessageList: (props: any) => <div data-testid="message-list" data-offscreen={props.messageOffscreen ? 'on' : 'off'} />,
}))

vi.mock('./CustomScrollArea', () => ({
  CustomScrollArea: React.forwardRef(function MockCustomScrollArea(props: any, ref: any) {
    return <div ref={ref}>{props.children}</div>
  }),
}))

import { SessionMessagePage } from './SessionMessagePage'
import { beginSwitchSpan, resetSwitchSpanForTests, setSwitchTraceSink, type SwitchMark } from '../../domain/switchSpan'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('会话消息页面屏外跳过开关', () => {
  let host: HTMLDivElement | null = null
  let root: any = null

  beforeEach(() => {
    captured.offscreenOptions = []
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount()
      })
      root = null
    }
    host?.remove()
    host = null
  })

  function page(enabled: boolean) {
    return (
      <SessionMessagePage
        sessionKey="chat-1"
        messages={[{ id: 'm-1', type: 'user', content: '你好' }]}
        hasMessages
        activeRunTailPendingMessage={null}
        layoutSignature="layout-a"
        messageOffscreenEnabled={enabled}
        messageListProps={{} as any}
        emptyContent={null}
        scrollHostSx={{}}
        scrollSx={{}}
      />
    )
  }

  it('关闭时停止屏外跳过并直接正常渲染，切换后立即生效', async () => {
    await act(async () => {
      root.render(page(true))
    })
    expect(host!.querySelector('[data-testid="message-list"]')?.getAttribute('data-offscreen')).toBe('on')
    expect(captured.offscreenOptions.at(-1)?.enabled).toBe(true)

    await act(async () => {
      root.render(page(false))
    })
    expect(host!.querySelector('[data-testid="message-list"]')?.getAttribute('data-offscreen')).toBe('off')
    expect(captured.offscreenOptions.at(-1)?.enabled).toBe(false)
  })
})

describe('切换观测的绘制边界', () => {
  let host: HTMLDivElement | null = null
  let root: any = null

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount()
      })
      root = null
    }
    host?.remove()
    host = null
    resetSwitchSpanForTests()
  })

  function renderPage(sessionKey: string) {
    return (
      <SessionMessagePage
        sessionKey={sessionKey}
        messages={[{ id: 'm-1', type: 'user', content: '你好' }]}
        hasMessages
        activeRunTailPendingMessage={null}
        layoutSignature="layout-a"
        messageOffscreenEnabled={false}
        messageListProps={{} as any}
        emptyContent={null}
        scrollHostSx={{}}
        scrollSx={{}}
      />
    )
  }

  it('首次提交后上报 painted / enhanceStart / enhanceEnd 并收尾 settled', async () => {
    const marks: SwitchMark[] = []
    setSwitchTraceSink((mark) => marks.push(mark))
    const span = beginSwitchSpan('role:role-1:chat-1')
    span.mark('frontend.select')

    await act(async () => {
      root.render(renderPage('chat-1'))
    })
    // enhanceEnd 排在微任务里，等它落地。
    await act(async () => {
      await Promise.resolve()
    })

    const boundaries = marks.map((mark) => mark.boundary)
    for (const expected of ['frontend.painted', 'frontend.enhanceStart', 'frontend.enhanceEnd', 'frontend.settled']) {
      expect(boundaries).toContain(expected)
    }
    // 全部边界共享同一个 switchId。
    expect(new Set(marks.map((mark) => mark.switchId)).size).toBe(1)
    expect(marks[0].switchId).toBe(span.switchId)
  })

  it('同一页面的重复渲染不重复上报（观测不制造噪声）', async () => {
    const marks: SwitchMark[] = []
    setSwitchTraceSink((mark) => marks.push(mark))
    beginSwitchSpan('role:role-1:chat-1')

    await act(async () => {
      root.render(renderPage('chat-1'))
    })
    await act(async () => {
      await Promise.resolve()
    })
    const painted = marks.filter((mark) => mark.boundary === 'frontend.painted').length

    await act(async () => {
      root.render(renderPage('chat-1'))
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(marks.filter((mark) => mark.boundary === 'frontend.painted').length).toBe(painted)
  })
})

describe('渲染缓存预计算接线', () => {
  let host: HTMLDivElement | null = null
  let root: any = null

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount()
      })
      root = null
    }
    host?.remove()
    host = null
  })

  function page(controller: any) {
    return (
      <SessionMessagePage
        sessionKey="chat-1"
        messages={[{ id: 'm-1', role: 'assistant', content: '你好' }]}
        hasMessages
        activeRunTailPendingMessage={null}
        layoutSignature="layout-a"
        messageOffscreenEnabled={false}
        messageListProps={{ controller } as any}
        emptyContent={null}
        scrollHostSx={{}}
        scrollSx={{}}
      />
    )
  }

  it('首屏提交后请求预计算，卸载时取消', async () => {
    const cancel = vi.fn()
    const prewarmRenderCache = vi.fn((request: any) => ({ cancel }))
    await act(async () => {
      root.render(page({ actions: { prewarmRenderCache } }))
    })
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
    })

    expect(prewarmRenderCache).toHaveBeenCalledTimes(1)
    expect(prewarmRenderCache.mock.calls[0][0]).toMatchObject({ sessionKey: 'chat-1' })

    await act(async () => {
      root.unmount()
    })
    root = null
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('未接入预计算动作时页面照常渲染', async () => {
    await act(async () => {
      root.render(page({ actions: {} }))
    })
    expect(host!.querySelector('[data-testid="message-list"]')).not.toBeNull()
  })
})

// 预计算的失效键是「会话」而不是「消息条数」：
// 任务书里的四条既有行为在这里逐条钉住——正文就绪时预热一次、会话内新增消息不重启、
// 切会话重新预热、页面切走即取消且切回补跑。
describe('渲染缓存预计算的失效键', () => {
  let host: HTMLDivElement | null = null
  let root: any = null

  beforeEach(() => {
    pageVisibility.active = true
    rafPump.reset()
    vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => rafPump.request(callback))
    vi.stubGlobal('cancelAnimationFrame', (id: number) => rafPump.cancel(id))
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount()
      })
      root = null
    }
    host?.remove()
    host = null
    rafPump.reset()
    vi.unstubAllGlobals()
  })

  // 推 n 帧：每帧都在 act 里跑，保证 effect / cleanup 与帧回调的先后与真实一致。
  async function runFrames(count = 2) {
    for (let i = 0; i < count; i++) {
      await act(async () => {
        rafPump.runFrame()
      })
    }
  }

  // 预计算动作的请求形状：测试只关心「被调用了几次」以及「看的是哪个会话的哪个窗口」。
  type PrewarmRequest = { sessionKey: string; messages: any[] }

  function message(id: string) {
    return { id, role: 'assistant', content: id }
  }

  function page(options: { sessionKey: string; messages: any[]; hasMessages?: boolean; controller: any }) {
    return (
      <SessionMessagePage
        sessionKey={options.sessionKey}
        messages={options.messages}
        hasMessages={options.hasMessages ?? true}
        activeRunTailPendingMessage={null}
        layoutSignature="layout-a"
        messageOffscreenEnabled={false}
        messageListProps={{ controller: options.controller } as any}
        emptyContent={null}
        scrollHostSx={{}}
        scrollSx={{}}
      />
    )
  }

  it('正文就绪时才预热一次，正文未就绪前不请求', async () => {
    const prewarmRenderCache = vi.fn((_request: PrewarmRequest) => ({ cancel: vi.fn() }))
    const controller = { actions: { prewarmRenderCache } }
    const messages = [message('m-1')]

    // 正文还没到：页面只有空占位，双帧走完也不该请求预计算。
    await act(async () => {
      root.render(page({ sessionKey: 'chat-1', messages: [], hasMessages: false, controller }))
    })
    await runFrames(2)
    expect(prewarmRenderCache).not.toHaveBeenCalled()

    // 正文就绪（hasMessages 变 true）：预热一次，且取的是最新窗口。
    await act(async () => {
      root.render(page({ sessionKey: 'chat-1', messages, controller }))
    })
    await runFrames(2)
    expect(prewarmRenderCache).toHaveBeenCalledTimes(1)
    expect(prewarmRenderCache.mock.calls[0][0]).toMatchObject({ sessionKey: 'chat-1', messages: [{ id: 'm-1' }] })
  })

  it('会话内新增消息不重启预计算', async () => {
    const cancel = vi.fn()
    const prewarmRenderCache = vi.fn((_request: PrewarmRequest) => ({ cancel }))
    const controller = { actions: { prewarmRenderCache } }
    const messages = [message('m-1'), message('m-2'), message('m-3')]

    await act(async () => {
      root.render(page({ sessionKey: 'chat-1', messages, controller }))
    })
    await runFrames(2)
    expect(prewarmRenderCache).toHaveBeenCalledTimes(1)
    expect(prewarmRenderCache.mock.calls[0][0]).toMatchObject({ sessionKey: 'chat-1' })

    // 第 4 条消息落地：预计算覆盖的是这个会话的后续批次，与新消息无关，不该推翻重来。
    await act(async () => {
      root.render(page({ sessionKey: 'chat-1', messages: [...messages, message('m-4')], controller }))
    })
    await runFrames(4)
    expect(prewarmRenderCache).toHaveBeenCalledTimes(1)
    expect(cancel).not.toHaveBeenCalled()
  })

  it('切换会话会重新预热一次', async () => {
    const previousCancel = vi.fn()
    const prewarmRenderCache = vi.fn((_request: PrewarmRequest) => ({ cancel: previousCancel }))
    const controller = { actions: { prewarmRenderCache } }

    await act(async () => {
      root.render(page({ sessionKey: 'chat-1', messages: [message('m-1')], controller }))
    })
    await runFrames(2)
    expect(prewarmRenderCache).toHaveBeenCalledTimes(1)

    await act(async () => {
      root.render(page({ sessionKey: 'chat-2', messages: [message('m-9')], controller }))
    })
    // 旧会话在途的预热必须先取消，否则会把旧会话的产物写进新页面。
    expect(previousCancel).toHaveBeenCalledTimes(1)
    await runFrames(2)
    expect(prewarmRenderCache).toHaveBeenCalledTimes(2)
    expect(prewarmRenderCache.mock.calls[1][0]).toMatchObject({ sessionKey: 'chat-2', messages: [{ id: 'm-9' }] })
  })

  it('页面切走取消预热，切回时补跑一次', async () => {
    const cancel = vi.fn()
    const prewarmRenderCache = vi.fn((_request: PrewarmRequest) => ({ cancel }))
    const controller = { actions: { prewarmRenderCache } }
    const messages = [message('m-1')]

    await act(async () => {
      root.render(page({ sessionKey: 'chat-1', messages, controller }))
    })
    await runFrames(2)
    expect(prewarmRenderCache).toHaveBeenCalledTimes(1)

    // 切走：在途预热立即取消，隐藏期间一帧都不排。
    pageVisibility.active = false
    await act(async () => {
      root.render(page({ sessionKey: 'chat-1', messages, controller }))
    })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(rafPump.pendingCount()).toBe(0)
    await runFrames(2)
    expect(prewarmRenderCache).toHaveBeenCalledTimes(1)

    // 切回：被取消的会话不算已预热，补跑一次后继续保持「每会话一次」。
    pageVisibility.active = true
    await act(async () => {
      root.render(page({ sessionKey: 'chat-1', messages, controller }))
    })
    await runFrames(2)
    expect(prewarmRenderCache).toHaveBeenCalledTimes(2)
    await runFrames(2)
    expect(prewarmRenderCache).toHaveBeenCalledTimes(2)
  })

  it('双帧没走完就被取消时，切回同样补跑一次', async () => {
    const prewarmRenderCache = vi.fn((_request: PrewarmRequest) => ({ cancel: vi.fn() }))
    const controller = { actions: { prewarmRenderCache } }
    const messages = [message('m-1')]

    await act(async () => {
      root.render(page({ sessionKey: 'chat-1', messages, controller }))
    })
    // 只走第一帧：第二帧还排着队，此时切走。
    await runFrames(1)
    expect(rafPump.pendingCount()).toBe(1)
    pageVisibility.active = false
    await act(async () => {
      root.render(page({ sessionKey: 'chat-1', messages, controller }))
    })
    // 取消的是帧而不是 handle：这里没有 handle 可取消，但标记必须一起清掉。
    expect(rafPump.pendingCount()).toBe(0)
    await runFrames(2)
    expect(prewarmRenderCache).not.toHaveBeenCalled()

    pageVisibility.active = true
    await act(async () => {
      root.render(page({ sessionKey: 'chat-1', messages, controller }))
    })
    await runFrames(2)
    expect(prewarmRenderCache).toHaveBeenCalledTimes(1)
  })
})
