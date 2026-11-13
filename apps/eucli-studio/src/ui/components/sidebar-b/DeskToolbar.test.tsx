// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material'
import { getColorThemeColors, resolveColorThemePreview } from '../../../domain/colorTheme'
import { createStudioMuiTheme } from '../../colorThemeStyles'
import { DeskToolbar } from './DeskToolbar'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const noop = () => {}

describe('工作桌面工具行', () => {
  let host: HTMLDivElement | null = null
  let root: any = null

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    if (root) {
      act(() => root.unmount())
      root = null
    }
    host?.remove()
    host = null
  })

  function renderToolbar(props: Partial<React.ComponentProps<typeof DeskToolbar>> = {}) {
    const theme = createStudioMuiTheme('light', getColorThemeColors(resolveColorThemePreview(undefined, null)))
    act(() => {
      root.render(
        <ThemeProvider theme={theme}>
          <DeskToolbar hasExpandedGroups onCollapseAll={noop} onCreateGroup={noop} {...props} />
        </ThemeProvider>,
      )
    })
  }

  function labels(): string[] {
    return Array.from(host!.querySelectorAll('button[aria-label]')).map(
      (node) => node.getAttribute('aria-label') || '',
    )
  }

  it('收起全部排在新建分组的左边', () => {
    renderToolbar()

    expect(labels()).toEqual(['收起全部', '新建分组'])
  })

  it('有展开着的分组时可点，点击交给回调', () => {
    let calls = 0
    renderToolbar({ onCollapseAll: () => (calls += 1) })

    const button = host!.querySelector('button[aria-label="收起全部"]') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    act(() => button.click())
    expect(calls).toBe(1)
  })

  it('没有展开着的分组时置灰，不给无效果的动作', () => {
    renderToolbar({ hasExpandedGroups: false })

    const button = host!.querySelector('button[aria-label="收起全部"]') as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})
