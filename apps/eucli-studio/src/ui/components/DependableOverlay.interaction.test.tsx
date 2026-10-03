// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material'
import { getColorThemeColors, resolveColorThemePreview } from '../../domain/colorTheme'
import { createStudioMuiTheme } from '../colorThemeStyles'
import { OVERLAY_UNMOUNT_DELAY_MS } from '../overlayTransition'
import { DependableDialog, DependablePopover } from './DependableOverlay'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// 关闭语义完整性：进入关闭后，弹层的模态容器（含遮罩）立即退出交互，
// 不再拦截鼠标、滚轮、键盘；等待时长内重新打开则恢复交互，且不被误卸下。
describe('DependableOverlay 关闭后不再拦截交互', () => {
  let host: HTMLDivElement | null = null
  let anchor: HTMLButtonElement | null = null
  let root: any = null

  beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement('div')
    anchor = document.createElement('button')
    document.body.appendChild(host)
    document.body.appendChild(anchor)
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
    anchor?.remove()
    anchor = null
    vi.useRealTimers()
  })

  function renderOverlay(element: React.ReactElement) {
    const theme = createStudioMuiTheme('light', getColorThemeColors(resolveColorThemePreview(undefined, null)))
    return act(async () => {
      root.render(React.createElement(ThemeProvider, { theme }, element))
    })
  }

  it('Popover 关闭期间容器不再拦截指针，等待时长内重开后恢复且不被误卸下', async () => {
    const content = React.createElement('div', null, '内容')
    await renderOverlay(React.createElement(DependablePopover, { open: true, anchorEl: anchor }, content))

    const modalRoot = document.querySelector('.MuiModal-root') as HTMLElement | null
    expect(modalRoot).not.toBeNull()
    expect(getComputedStyle(modalRoot!).pointerEvents).not.toBe('none')

    await renderOverlay(React.createElement(DependablePopover, { open: false, anchorEl: anchor }, content))
    // 退场动画窗口内容器仍在场，但已不拦截任何指针操作。
    expect(document.querySelector('.MuiModal-root')).not.toBeNull()
    expect(getComputedStyle(modalRoot!).pointerEvents).toBe('none')

    await renderOverlay(React.createElement(DependablePopover, { open: true, anchorEl: anchor }, content))
    expect(getComputedStyle(modalRoot!).pointerEvents).not.toBe('none')

    await act(async () => {
      vi.advanceTimersByTime(OVERLAY_UNMOUNT_DELAY_MS * 2)
    })
    expect(document.querySelector('.MuiModal-root')).not.toBeNull()
  })

  it('Dialog 关闭期间容器与遮罩不再拦截指针，等待时长内重开后恢复且不被误卸下', async () => {
    const content = React.createElement('div', null, '内容')
    await renderOverlay(React.createElement(DependableDialog, { open: true }, content))

    const modalRoot = document.querySelector('.MuiModal-root') as HTMLElement | null
    expect(modalRoot).not.toBeNull()
    expect(getComputedStyle(modalRoot!).pointerEvents).not.toBe('none')

    await renderOverlay(React.createElement(DependableDialog, { open: false }, content))
    // 退场动画窗口内容器与遮罩仍在场，但已不拦截任何指针操作。
    expect(document.querySelector('.MuiModal-root')).not.toBeNull()
    expect(getComputedStyle(modalRoot!).pointerEvents).toBe('none')

    await renderOverlay(React.createElement(DependableDialog, { open: true }, content))
    expect(getComputedStyle(modalRoot!).pointerEvents).not.toBe('none')

    await act(async () => {
      vi.advanceTimersByTime(OVERLAY_UNMOUNT_DELAY_MS * 2)
    })
    expect(document.querySelector('.MuiModal-root')).not.toBeNull()
  })
})
