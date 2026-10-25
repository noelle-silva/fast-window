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

function Harness(props: { sessionKey: string }) {
  const keys = useSessionKeepAlive(props.sessionKey)
  return <SessionPageStack activeKey={props.sessionKey} keys={keys} activePage={<Page id={props.sessionKey} />} />
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
  return <SessionPageStack activeKey={props.sessionKey} keys={keys} activePage={<ActiveAwarePage id={props.sessionKey} />} />
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

  async function open(sessionKey: string) {
    await act(async () => {
      root.render(<Harness sessionKey={sessionKey} />)
    })
  }

  function pageNode(id: string) {
    return host!.querySelector(`[data-page-id="${id}"]`) as HTMLElement | null
  }

  function pageCount() {
    return host!.querySelectorAll('[data-fw-session-page]').length
  }

  it('keeps at most five session pages and destroys the oldest page node', async () => {
    for (const key of ['a', 'b', 'c', 'd', 'e']) await open(key)
    expect(pageCount()).toBe(5)
    expect(pageNode('a')).not.toBeNull()

    await open('f')
    expect(pageCount()).toBe(5)
    expect(pageNode('a')).toBeNull()
    expect(pageNode('b')).not.toBeNull()
    expect(mountedCounts.get('a')).toBe(0)
    expect(mountedCounts.get('f')).toBe(1)
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
    for (const key of ['a', 'b', 'c', 'd', 'e']) await open(key)
    await open('b')
    await open('f')

    expect(pageCount()).toBe(5)
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
})
