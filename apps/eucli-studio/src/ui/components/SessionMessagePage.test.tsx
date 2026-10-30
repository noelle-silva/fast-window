// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const captured = vi.hoisted(() => ({ offscreenOptions: [] as any[] }))

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
