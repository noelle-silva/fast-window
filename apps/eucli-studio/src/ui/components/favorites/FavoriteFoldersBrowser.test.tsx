// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material'
import { getColorThemeColors, resolveColorThemePreview } from '../../../domain/colorTheme'
import type { FavoriteFolderLevelEntry } from '../../../domain/favoriteFolderLevel'
import { createStudioMuiTheme } from '../../colorThemeStyles'
import { FavoriteFoldersBrowser, type FavoriteFoldersBrowserProps } from './FavoriteFoldersBrowser'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const noop = () => {}

function entry(overrides: Partial<FavoriteFolderLevelEntry> = {}): FavoriteFolderLevelEntry {
  return {
    key: 'role::role-a::::chat-1',
    targetKind: 'role',
    targetId: 'role-a',
    roleId: '',
    chatId: 'chat-1',
    title: '甲会话',
    snippet: '最后一句',
    targetName: '甲角色',
    targetImage: '',
    selected: false,
    runningKind: '',
    ...overrides,
  }
}

function createProps(overrides: Partial<FavoriteFoldersBrowserProps> = {}): FavoriteFoldersBrowserProps {
  return {
    level: { folders: [], refs: [] },
    canGoBack: false,
    onBack: noop,
    onCreateFolder: noop,
    onOpenRef: noop,
    onRefContextMenu: noop,
    onNavigate: noop,
    onReorderFolders: noop,
    onReorderRefs: noop,
    onMoveRef: noop,
    ...overrides,
  }
}

describe('会话收藏夹层级浏览', () => {
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

  function renderBrowser(overrides: Partial<FavoriteFoldersBrowserProps> = {}) {
    const theme = createStudioMuiTheme('light', getColorThemeColors(resolveColorThemePreview(undefined, null)))
    act(() => {
      root.render(
        <ThemeProvider theme={theme}>
          <FavoriteFoldersBrowser {...createProps(overrides)} />
        </ThemeProvider>,
      )
    })
  }

  it('只铺当前层：子文件夹与会话同列出现', () => {
    renderBrowser({
      level: { folders: [{ id: 'f1', name: '甲文件夹' }], refs: [entry()] },
    })

    expect(host!.textContent).toContain('甲文件夹')
    expect(host!.textContent).toContain('甲会话')
    expect(host!.textContent).toContain('甲角色')
  })

  it('点文件夹进入下一层，不展开收起', () => {
    const seen: string[] = []
    renderBrowser({ level: { folders: [{ id: 'f1', name: '甲文件夹' }], refs: [] }, onNavigate: (id) => seen.push(id) })

    act(() => {
      ;(host!.querySelector('[role="button"][aria-label="甲文件夹"]') as HTMLElement).click()
    })

    expect(seen).toEqual(['f1'])
  })

  it('点会话把整条引用交回上层', () => {
    const opened: FavoriteFolderLevelEntry[] = []
    renderBrowser({ level: { folders: [], refs: [entry()] }, onOpenRef: (item) => opened.push(item) })

    act(() => {
      ;(host!.querySelector('[role="button"][aria-label="甲会话"]') as HTMLElement).click()
    })

    expect(opened.map((item) => item.chatId)).toEqual(['chat-1'])
  })

  it('当前会话落在选中态', () => {
    renderBrowser({ level: { folders: [], refs: [entry({ selected: true })] } })

    expect(host!.querySelector('[role="button"][aria-label="甲会话"]')!.getAttribute('aria-current')).toBe('true')
  })

  it('空文件夹给出提示', () => {
    renderBrowser()

    expect(host!.textContent).toContain('这个收藏夹还是空的')
  })

  it('返回按钮在分类自己的工具行最左侧，来路为空时禁用', () => {
    const seen: string[] = []
    renderBrowser({ canGoBack: false })
    expect((host!.querySelector('button[aria-label="返回上一层级"]') as HTMLButtonElement).disabled).toBe(true)

    renderBrowser({ canGoBack: true, onBack: () => seen.push('back') })
    const back = host!.querySelector('button[aria-label="返回上一层级"]') as HTMLButtonElement
    expect(back.disabled).toBe(false)
    act(() => back.click())
    expect(seen).toEqual(['back'])
  })
})
