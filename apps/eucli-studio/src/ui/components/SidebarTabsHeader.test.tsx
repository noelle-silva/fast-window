// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material'
import { getColorThemeColors, resolveColorThemePreview } from '../../domain/colorTheme'
import { createStudioMuiTheme } from '../colorThemeStyles'
import { SidebarTabsHeader } from './SidebarTabsHeader'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const noop = () => {}

describe('侧边栏页签栏', () => {
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

  function renderHeader(element: React.ReactElement) {
    const theme = createStudioMuiTheme('light', getColorThemeColors(resolveColorThemePreview(undefined, null)))
    act(() => {
      root.render(<ThemeProvider theme={theme}>{element}</ThemeProvider>)
    })
  }

  it('按页签表铺开，当前值落在选中态', () => {
    renderHeader(
      <SidebarTabsHeader
        ariaLabel="测试页签"
        tabs={[{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }]}
        value="a"
        onChange={noop}
      />,
    )

    const tabs = Array.from(host!.querySelectorAll('[role="tab"]'))
    expect(tabs.map((it) => it.textContent)).toEqual(['甲', '乙'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(tabs[1].getAttribute('aria-selected')).toBe('false')
    expect(host!.querySelector('[role="tablist"]')!.getAttribute('aria-label')).toBe('测试页签')
  })

  it('点另一个页签把值回传给调用方', () => {
    const seen: string[] = []
    renderHeader(
      <SidebarTabsHeader
        ariaLabel="测试页签"
        tabs={[{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }]}
        value="a"
        onChange={(next) => seen.push(next)}
      />,
    )

    act(() => {
      ;(host!.querySelectorAll('[role="tab"]')[1] as HTMLElement).click()
    })
    expect(seen).toEqual(['b'])
  })

  it('左侧附加控件排在页签前面', () => {
    renderHeader(
      <SidebarTabsHeader
        ariaLabel="测试页签"
        tabs={[{ value: 'a', label: '甲' }]}
        value="a"
        onChange={noop}
        leading={<button aria-label="附加动作" />}
      />,
    )

    const leading = host!.querySelector('[aria-label="附加动作"]') as HTMLElement
    const tablist = host!.querySelector('[role="tablist"]') as HTMLElement
    expect(leading).toBeTruthy()
    expect(leading.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('左右方向键循环切换，Home 与 End 直接到两端', () => {
    const seen: string[] = []
    renderHeader(
      <SidebarTabsHeader
        ariaLabel="测试页签"
        tabs={[{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }, { value: 'c', label: '丙' }]}
        value="a"
        onChange={(next) => seen.push(next)}
      />,
    )

    const first = host!.querySelectorAll('[role="tab"]')[0] as HTMLElement
    act(() => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    })

    expect(seen).toEqual(['b', 'c', 'c', 'a'])
  })

  it('只有选中的页签进入键盘焦点顺序', () => {
    renderHeader(
      <SidebarTabsHeader
        ariaLabel="测试页签"
        tabs={[{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }]}
        value="b"
        onChange={noop}
      />,
    )

    expect(Array.from(host!.querySelectorAll('[role="tab"]')).map((it) => it.getAttribute('tabindex'))).toEqual([
      '-1',
      '0',
    ])
  })
})
