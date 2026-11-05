import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider, Popover } from '@mui/material'
import { describe, expect, it } from 'vitest'
import { getColorThemeColors, resolveColorThemePreview } from '../domain/colorTheme'
import { createStudioMuiTheme, placeholderDiagramColors } from './colorThemeStyles'
import { OVERLAY_TRANSITION_DURATION, OVERLAY_UNMOUNT_DELAY_MS } from './overlayTransition'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// 回归测试：弹层过渡时长必须固定，禁止回退到 Grow 的「自动时长」模式。
//
// 自动模式的退出完成信号依赖可被取消的内部共享计时器（且关闭了底层过渡库的兜底
// 计时器）：切会话等高频刷新会打断它，导致退出回调丢失、弹层模态容器永久残留并
// 拦截全屏鼠标交互。固定时长后由底层过渡库的独立兜底计时器保证退出必然完成。
describe('createStudioMuiTheme 弹层过渡时长', () => {
  it('Popover、Menu 与 Dialog 的过渡时长与卸载等待同源于 overlayTransition', () => {
    const colors = getColorThemeColors(resolveColorThemePreview(undefined, null))
    const theme = createStudioMuiTheme('light', colors)
    expect(theme.components?.MuiPopover?.defaultProps?.transitionDuration).toEqual(OVERLAY_TRANSITION_DURATION)
    expect(theme.components?.MuiMenu?.defaultProps?.transitionDuration).toEqual(OVERLAY_TRANSITION_DURATION)
    expect(theme.components?.MuiDialog?.defaultProps?.transitionDuration).toEqual(OVERLAY_TRANSITION_DURATION)
    // 强制卸下必须晚于退场动画播完，动画节奏才不会被截断。
    expect(OVERLAY_UNMOUNT_DELAY_MS).toBeGreaterThanOrEqual(OVERLAY_TRANSITION_DURATION.exit)
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
      expect(String(paper?.style.transition || '')).toContain(`${OVERLAY_TRANSITION_DURATION.enter}ms`)
    } finally {
      await act(async () => {
        root.unmount()
      })
      host.remove()
      anchor.remove()
    }
  })
})

// 回归测试：依赖图配色交给 mermaid 的 classDef，必须全是实色。
// 主题里的软背景是 rgba(…) 半透明色，直接把 rgba 写进 classDef 会让整张图解析失败，
// 所以 placeholderDiagramColors 必须先按图表底色合成成不透明 hex。
describe('placeholderDiagramColors 输出 mermaid 可用的实色', () => {
  it('内置主题的每个颜色都不是函数色', () => {
    const colors = getColorThemeColors(resolveColorThemePreview(undefined, null))
    const diagramColors = placeholderDiagramColors(colors)
    for (const [key, value] of Object.entries(diagramColors)) {
      expect(value, key).toMatch(/^#[0-9a-f]{6}$/i)
      expect(value, key).not.toMatch(/rgba?\(|color-mix/i)
    }
  })
})

