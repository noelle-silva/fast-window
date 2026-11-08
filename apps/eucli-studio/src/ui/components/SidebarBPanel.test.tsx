// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material'
import { getColorThemeColors, resolveColorThemePreview } from '../../domain/colorTheme'
import { createStudioMuiTheme } from '../colorThemeStyles'
import { SidebarBPanel } from './SidebarBPanel'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const noop = () => {}

const workspaces = [
  { id: 'ws-1', name: '工作区一', directories: [{ path: 'E:/a' }] },
  { id: 'ws-2', name: '工作区二', directories: [] },
]

function createProps(overrides: Partial<React.ComponentProps<typeof SidebarBPanel>> = {}): React.ComponentProps<typeof SidebarBPanel> {
  return {
    side: 'right',
    width: 260,
    sidebarRef: null,
    resizing: false,
    onSplitterPointerDown: noop,
    topbarOpacity: 100,
    topbarBlur: 0,
    workspaces,
    activeWorkspaceId: 'ws-1',
    activeTargetKind: 'workspace',
    openPluginSettings: noop,
    onSelectWorkspace: noop,
    onOpenWorkspaceEditor: noop,
    onMoveWorkspace: noop,
    ...overrides,
  }
}

describe('侧边栏 B 的工作区列表', () => {
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

  function renderPanel(overrides: Partial<React.ComponentProps<typeof SidebarBPanel>> = {}) {
    const theme = createStudioMuiTheme('light', getColorThemeColors(resolveColorThemePreview(undefined, null)))
    act(() => {
      root.render(
        <ThemeProvider theme={theme}>
          <SidebarBPanel {...createProps(overrides)} />
        </ThemeProvider>,
      )
    })
  }

  it('按工作区顺序逐行列出，工具行的两个入口都在', () => {
    renderPanel()

    expect(host!.textContent).toContain('工作区一')
    expect(host!.textContent).toContain('工作区二')
    expect(host!.querySelector('[aria-label="选择工作区"]')).toBeTruthy()
    expect(host!.querySelector('[aria-label="新建工作区"]')).toBeTruthy()
  })

  it('每一行带自己的设置入口，行本身是可选中的按钮', () => {
    renderPanel()

    expect(host!.querySelector('[aria-label="设置 工作区一"]')).toBeTruthy()
    expect(host!.querySelector('[aria-label="设置 工作区二"]')).toBeTruthy()
    expect(host!.querySelector('[role="button"][aria-label="工作区二"]')).toBeTruthy()
  })

  it('没有工作区时给出空态提示', () => {
    renderPanel({ workspaces: [] })

    expect(host!.textContent).toContain('还没有工作区')
  })
})
