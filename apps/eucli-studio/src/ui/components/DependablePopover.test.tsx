// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OVERLAY_UNMOUNT_DELAY_MS } from '../overlayTransition'
import { DependablePopover } from './DependablePopover'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// 模拟底层过渡状态机回调悬空的最坏情况：弹层关闭后永不自行卸载。
// 这正是切会话高频刷新下会发生的事故：回调已创建却无人执行，Modal 容器永久残留。
vi.mock('@mui/material', async (importOriginal) => {
  const actual = await importOriginal<any>()
  const react = await import('react')
  const StuckPopover = (props: any) =>
    react.createElement('div', { 'data-testid': 'stuck-modal', className: 'MuiModal-root' }, props.children ?? null)
  const StuckMenu = () => react.createElement('div', { 'data-testid': 'stuck-menu', className: 'MuiModal-root' })
  return { ...actual, Popover: StuckPopover, Menu: StuckMenu }
})

describe('DependablePopover 关闭后必然卸下', () => {
  let host: HTMLDivElement | null = null
  let root: any = null

  beforeEach(() => {
    vi.useFakeTimers()
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
    vi.useRealTimers()
  })

  it('即使底层弹层永不自行卸载，关闭后也会在等待时长内被强制卸下', async () => {
    await act(async () => {
      root.render(
        React.createElement(DependablePopover, { open: true, anchorEl: document.body }, React.createElement('div', null, '内容')),
      )
    })
    expect(host!.querySelector('[data-testid="stuck-modal"]')).not.toBeNull()

    await act(async () => {
      root.render(
        React.createElement(DependablePopover, { open: false, anchorEl: document.body }, React.createElement('div', null, '内容')),
      )
    })
    // 关闭瞬间仍在场：留给退场动画。
    expect(host!.querySelector('[data-testid="stuck-modal"]')).not.toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(OVERLAY_UNMOUNT_DELAY_MS + 1)
    })
    expect(host!.querySelector('[data-testid="stuck-modal"]')).toBeNull()
  })

  it('关闭动画窗口内重新打开不会被误卸下', async () => {
    await act(async () => {
      root.render(
        React.createElement(DependablePopover, { open: true, anchorEl: document.body }, React.createElement('div', null, '内容')),
      )
    })
    await act(async () => {
      root.render(
        React.createElement(DependablePopover, { open: false, anchorEl: document.body }, React.createElement('div', null, '内容')),
      )
    })
    await act(async () => {
      vi.advanceTimersByTime(OVERLAY_UNMOUNT_DELAY_MS - 1)
    })
    await act(async () => {
      root.render(
        React.createElement(DependablePopover, { open: true, anchorEl: document.body }, React.createElement('div', null, '内容')),
      )
    })
    await act(async () => {
      vi.advanceTimersByTime(OVERLAY_UNMOUNT_DELAY_MS * 2)
    })
    expect(host!.querySelector('[data-testid="stuck-modal"]')).not.toBeNull()
  })

  it('初始未打开时经过等待时长后不再渲染弹层', async () => {
    await act(async () => {
      root.render(
        React.createElement(DependablePopover, { open: false, anchorEl: document.body }, React.createElement('div', null, '内容')),
      )
    })
    await act(async () => {
      vi.advanceTimersByTime(OVERLAY_UNMOUNT_DELAY_MS + 1)
    })
    expect(host!.querySelector('[data-testid="stuck-modal"]')).toBeNull()
  })
})
