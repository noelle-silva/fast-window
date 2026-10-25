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
