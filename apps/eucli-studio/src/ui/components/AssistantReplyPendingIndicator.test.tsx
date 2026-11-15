// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantReplyPendingIndicator } from './AssistantReplyPendingIndicator'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('AssistantReplyPendingIndicator', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
  })

  it('counts the first token wait from the run start', () => {
    const startedAt = Date.now()
    act(() => root.render(<AssistantReplyPendingIndicator startedAtMs={startedAt} />))
    expect(host.textContent).toContain('首字 0.0 秒')

    act(() => {
      vi.advanceTimersByTime(320)
    })
    expect(host.textContent).toContain('首字 0.3 秒')
    expect(host.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('AI 回复加载中')
  })

  it('shows only the spinner when there is no run anchor', () => {
    act(() => root.render(<AssistantReplyPendingIndicator />))
    expect(host.textContent).not.toContain('首字')
    expect(host.querySelector('[role="status"]')).not.toBeNull()
  })
})
