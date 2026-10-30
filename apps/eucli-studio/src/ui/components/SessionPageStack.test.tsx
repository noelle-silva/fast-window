// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionPageStack, useSessionPageActiveKey } from './SessionPageStack'
import { useSessionPageScrollRegistry } from './sessionPageScrollRegistry'
import { useSessionKeepAlive } from '../hooks/useSessionKeepAlive'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const mountedCounts = new Map<string, number>()

function Page(props: { id: string }) {
  React.useEffect(() => {
    mountedCounts.set(props.id, (mountedCounts.get(props.id) || 0) + 1)
    return () => {
      mountedCounts.set(props.id, (mountedCounts.get(props.id) || 0) - 1)
    }
  }, [props.id])
  return <div data-page-id={props.id}>{props.id}</div>
}

// visibleKey 由外部推进；测试里用「上一帧的 activeKey」模拟 PAINTED 已完成。
function Harness(props: { sessionKey: string; paintedKey?: string }) {
  const keys = useSessionKeepAlive(props.sessionKey, { pinnedKey: props.paintedKey })
  const visibleKey = props.paintedKey ?? props.sessionKey
  return (
    <SessionPageStack
      activeKey={props.sessionKey}
      visibleKey={visibleKey}
      keys={keys}
      activePage={<Page id={props.sessionKey} />}
    />
  )
}

// 上限可配置 + 记录 PAINTED：验证 limit=1 时切换链路仍然完整。
function LimitedHarness(props: {
  sessionKey: string
  paintedKey?: string
  limit: number
  onPainted: (key: string) => void
}) {
  const keys = useSessionKeepAlive(props.sessionKey, { limit: props.limit, pinnedKey: props.paintedKey })
  const visibleKey = props.paintedKey ?? ''
  return (
    <SessionPageStack
      activeKey={props.sessionKey}
      visibleKey={visibleKey}
      keys={keys}
      activePage={<Page id={props.sessionKey} />}
      onPainted={props.onPainted}
    />
  )
}

const scrollRerenders = new Map<string, () => void>()

function ScrollPage(props: { id: string }) {
  const registry = useSessionPageScrollRegistry()
  const [, bump] = React.useState(0)
  React.useEffect(() => {
    scrollRerenders.set(props.id, () => bump((value) => value + 1))
    return () => {
      scrollRerenders.delete(props.id)
    }
  }, [props.id])
  const setRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      registry?.register(props.id, el)
    },
    [registry, props.id],
  )
  return <div ref={setRef} data-scroll-page={props.id} />
}

function ScrollHarness(props: { sessionKey: string; activeScrollRef: React.MutableRefObject<HTMLDivElement | null> }) {
  const keys = useSessionKeepAlive(props.sessionKey)
  return (
    <SessionPageStack
      activeKey={props.sessionKey}
      visibleKey={props.sessionKey}
      keys={keys}
      activeScrollRef={props.activeScrollRef}
      activePage={<ScrollPage id={props.sessionKey} />}
    />
  )
}

function ActiveAwarePage(props: { id: string }) {
  const activeKey = useSessionPageActiveKey()
  return (
    <div data-page-id={props.id} data-active-key={activeKey ?? ''}>
      {props.id}
    </div>
  )
}

function ActiveAwareHarness(props: { sessionKey: string }) {
  const keys = useSessionKeepAlive(props.sessionKey)
  return (
    <SessionPageStack
      activeKey={props.sessionKey}
      visibleKey={props.sessionKey}
      keys={keys}
      activePage={<ActiveAwarePage id={props.sessionKey} />}
    />
  )
}

describe('session page stack', () => {
  let host: HTMLDivElement | null = null
  let root: any = null

  beforeEach(() => {
    mountedCounts.clear()
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

  async function open(sessionKey: string, paintedKey?: string) {
    await act(async () => {
      root.render(<Harness sessionKey={sessionKey} paintedKey={paintedKey} />)
    })
  }

  function pageNode(id: string) {
    return host!.querySelector(`[data-page-id="${id}"]`) as HTMLElement | null
  }

  function pageCount() {
    return host!.querySelectorAll('[data-fw-session-page]').length
  }

  it('keeps the configured number of session pages and destroys the oldest page node', async () => {
    const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    for (const key of keys) await open(key)
    expect(pageCount()).toBe(8)
    expect(pageNode('a')).not.toBeNull()

    await open('i')
    expect(pageCount()).toBe(8)
    expect(pageNode('a')).toBeNull()
    expect(pageNode('b')).not.toBeNull()
    expect(mountedCounts.get('a')).toBe(0)
    expect(mountedCounts.get('i')).toBe(1)
  })

  it('keeps a cached session page node mounted and reuses it when switching back', async () => {
    await open('a')
    const nodeA = pageNode('a')

    await open('b')
    expect(pageNode('a')).toBe(nodeA)
    expect(mountedCounts.get('a')).toBe(1)
    expect(host!.querySelector('[data-fw-session-page="active"] [data-page-id="b"]')).not.toBeNull()

    await open('a')
    expect(pageNode('a')).toBe(nodeA)
    expect(mountedCounts.get('a')).toBe(1)
    expect(host!.querySelector('[data-fw-session-page="active"] [data-page-id="a"]')).not.toBeNull()
  })

  it('evicts the least recently used page when a cached session is reopened', async () => {
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) await open(key)
    await open('b')
    await open('i')

    expect(pageCount()).toBe(8)
    expect(pageNode('a')).toBeNull()
    expect(pageNode('b')).not.toBeNull()
  })

  it('keeps the active scroll target even when a hidden page re-renders', async () => {
    scrollRerenders.clear()
    const activeScrollRef: React.MutableRefObject<HTMLDivElement | null> = { current: null }
    const renderScroll = async (sessionKey: string) => {
      await act(async () => {
        root.render(<ScrollHarness sessionKey={sessionKey} activeScrollRef={activeScrollRef} />)
      })
    }

    await renderScroll('a')
    expect(activeScrollRef.current?.getAttribute('data-scroll-page')).toBe('a')

    await renderScroll('b')
    expect(activeScrollRef.current?.getAttribute('data-scroll-page')).toBe('b')

    await act(async () => {
      scrollRerenders.get('a')?.()
    })
    expect(activeScrollRef.current?.getAttribute('data-scroll-page')).toBe('b')
  })

  it('tells cached pages which session is currently displayed', async () => {
    const renderActive = async (sessionKey: string) => {
      await act(async () => {
        root.render(<ActiveAwareHarness sessionKey={sessionKey} />)
      })
    }

    await renderActive('a')
    await renderActive('b')

    expect(pageNode('a')?.getAttribute('data-active-key')).toBe('b')
    expect(pageNode('b')?.getAttribute('data-active-key')).toBe('b')

    await renderActive('a')
    expect(pageNode('a')?.getAttribute('data-active-key')).toBe('a')
    expect(pageNode('b')?.getAttribute('data-active-key')).toBe('a')
  })

  it('limit=1 切换时新页仍能进栈并发出 PAINTED（不永久卡在切换中）', async () => {
    const painted: string[] = []
    const renderLimited = async (sessionKey: string, paintedKey: string) => {
      await act(async () => {
        root.render(
          <LimitedHarness
            sessionKey={sessionKey}
            paintedKey={paintedKey}
            limit={1}
            onPainted={(key) => painted.push(key)}
          />,
        )
      })
    }

    await renderLimited('a', '')
    expect(pageNode('a')).not.toBeNull()

    // 切到 b，可见页仍是 a（尚未 PAINTED）。
    await renderLimited('b', 'a')
    expect(pageNode('b')).not.toBeNull()
    expect(host!.querySelector('[data-fw-session-page="pending"] [data-page-id="b"]')).not.toBeNull()

    // 双 rAF 推进后必须上报 b；若 b 被保活裁剪丢弃，这里永远不会触发。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    expect(painted).toContain('b')
  })

  it('keeps the painted page visible and inert until the new page is painted', async () => {
    await open('a')
    // 选中 b，但还没有 PAINTED：a 仍是可见页，b 处于 pending。
    await open('b', 'a')

    const nodeA = host!.querySelector('[data-fw-session-page="active"]') as HTMLElement
    const nodeB = host!.querySelector('[data-fw-session-page="pending"]') as HTMLElement
    expect(nodeA?.querySelector('[data-page-id="a"]')).not.toBeNull()
    expect(nodeA?.hasAttribute('inert')).toBe(true)
    expect(nodeB?.querySelector('[data-page-id="b"]')).not.toBeNull()
    expect(nodeB?.hasAttribute('inert')).toBe(true)

    // PAINTED 推进后，b 变成可见且可交互。
    await open('b', 'b')
    const activeNode = host!.querySelector('[data-fw-session-page="active"]') as HTMLElement
    expect(activeNode?.querySelector('[data-page-id="b"]')).not.toBeNull()
    expect(activeNode?.hasAttribute('inert')).toBe(false)
    expect(host!.querySelector('[data-fw-session-page="pending"]')).toBeNull()
  })

  // 回归：pending 页曾经与旧页同时可见，导致两个会话的内容在切换瞬间叠在一起。
  // 现在同一时刻只允许一个可见页：pending 必须挂载（否则拿不到首帧、发不出 PAINTED），
  // 但必须不可见。
  it('never shows two session pages at once during a switch', async () => {
    await open('a')
    await open('b', 'a')

    const slots = Array.from(host!.querySelectorAll('[data-fw-session-page]')) as HTMLElement[]
    expect(slots.length).toBeGreaterThanOrEqual(2)
    const visibleSlots = slots.filter((el) => el.getAttribute('data-fw-session-onscreen') === 'true')
    expect(visibleSlots).toHaveLength(1)
    expect(visibleSlots[0].getAttribute('data-fw-session-page')).toBe('active')
    expect(visibleSlots[0].querySelector('[data-page-id="a"]')).not.toBeNull()

    // pending 页仍然挂载着（保住了首帧与 PAINTED 链路），只是看不见。
    const pending = host!.querySelector('[data-fw-session-page="pending"]') as HTMLElement
    expect(pending?.getAttribute('data-fw-session-onscreen')).toBe('false')
    expect(pending?.querySelector('[data-page-id="b"]')).not.toBeNull()

    // 推进后旧页转为隐藏的缓存页，仍然只有一个可见页。
    await open('b', 'b')
    const after = Array.from(host!.querySelectorAll('[data-fw-session-page]')) as HTMLElement[]
    const visibleAfter = after.filter((el) => el.getAttribute('data-fw-session-onscreen') === 'true')
    expect(visibleAfter).toHaveLength(1)
    expect(visibleAfter[0].querySelector('[data-page-id="b"]')).not.toBeNull()
    const cachedA = after.find((el) => el.querySelector('[data-page-id="a"]'))
    expect(cachedA?.getAttribute('data-fw-session-onscreen')).toBe('false')
  })
})
