import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider, Popover } from '@mui/material'
import { describe, expect, it } from 'vitest'
import { getColorThemeColors, resolveColorThemePreview } from '../domain/colorTheme'
import { createStudioMuiTheme } from './colorThemeStyles'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// 回归测试：弹层过渡时长必须固定，禁止回退到 Grow 的「自动时长」模式。
//
// 自动模式的退出完成信号依赖可被取消的内部共享计时器（且关闭了底层过渡库的兜底
// 计时器）：切会话等高频刷新会打断它，导致退出回调丢失、弹层模态容器永久残留并
// 拦截全屏鼠标交互。固定时长后由底层过渡库的独立兜底计时器保证退出必然完成。
describe('createStudioMuiTheme 弹层过渡时长', () => {
  it('Popover 与 Menu 均固定过渡时长，不落到自动模式', () => {
    const colors = getColorThemeColors(resolveColorThemePreview(undefined, null))
    const theme = createStudioMuiTheme('light', colors)
    expect(theme.components?.MuiPopover?.defaultProps?.transitionDuration).toEqual({ enter: 225, exit: 195 })
    expect(theme.components?.MuiMenu?.defaultProps?.transitionDuration).toEqual({ enter: 225, exit: 195 })
  })

  it('渲染出的弹层实际使用固定时长', async () => {
    // @vitest-environment happy-dom 由 vitest.config 全局提供
    const colors = getColorThemeColors(resolveColorThemePreview(undefined, null))
    const theme = createStudioMuiTheme('light', colors)
    const host = document.createElement('div')
    const anchor = document.createElement('button')
    document.body.appendChild(host)
    document.body.appendChild(anchor)
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(
          React.createElement(
            ThemeProvider,
            { theme },
            React.createElement(Popover, { open: true, anchorEl: anchor }, React.createElement('div', null, 'content')),
          ),
        )
      })
      const paper = document.querySelector('.MuiPopover-paper') as HTMLElement | null
      expect(paper).not.toBeNull()
      expect(String(paper?.style.transition || '')).toContain('225ms')
    } finally {
      await act(async () => {
        root.unmount()
      })
      host.remove()
      anchor.remove()
    }
  })
})

