// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material'
import { getColorThemeColors, resolveColorThemePreview } from '../../../domain/colorTheme'
import { createStudioMuiTheme } from '../../colorThemeStyles'
import { FavoriteFolderActions, type FavoriteFolderActionsProps } from './FavoriteFolderActions'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const noop = () => {}

function createProps(overrides: Partial<FavoriteFolderActionsProps> = {}): FavoriteFolderActionsProps {
  return {
    favoriteFolders: [],
    collapseAllFavoriteFolders: noop,
    openCreateFavoriteFolder: noop,
    favoriteSearchOpen: false,
    setFavoriteSearchOpen: noop as any,
    setFavoriteSearchText: noop as any,
    ...overrides,
  }
}

describe('会话收藏夹工具按钮', () => {
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

  function renderActions(overrides: Partial<FavoriteFolderActionsProps> = {}) {
    const theme = createStudioMuiTheme('light', getColorThemeColors(resolveColorThemePreview(undefined, null)))
    act(() => {
      root.render(
        <ThemeProvider theme={theme}>
          <FavoriteFolderActions {...createProps(overrides)} />
        </ThemeProvider>,
      )
    })
  }

  it('搜索关着时点一下把开关翻到开', () => {
    const seen: any[] = []
    renderActions({ favoriteSearchOpen: false, setFavoriteSearchOpen: ((next: any) => seen.push(next)) as any })

    act(() => {
      ;(host!.querySelector('button[aria-label="搜索收藏夹"]') as HTMLElement).click()
    })

    expect(seen).toHaveLength(1)
    expect(typeof seen[0]).toBe('function')
    expect(seen[0](false)).toBe(true)
  })

  it('搜索开着时点一下会收起并清空词', () => {
    const opened: any[] = []
    const cleared: string[] = []
    renderActions({
      favoriteSearchOpen: true,
      setFavoriteSearchOpen: ((next: any) => opened.push(next)) as any,
      setFavoriteSearchText: ((next: any) => cleared.push(next)) as any,
    })

    act(() => {
      ;(host!.querySelector('button[aria-label="关闭搜索"]') as HTMLElement).click()
    })

    expect(opened).toHaveLength(1)
    expect(opened[0](true)).toBe(false)
    expect(cleared).toEqual([''])
  })

  it('没有收藏夹时折叠全部禁用', () => {
    renderActions({ favoriteFolders: [] })
    expect((host!.querySelector('button[aria-label="折叠全部"]') as HTMLButtonElement).disabled).toBe(true)

    renderActions({ favoriteFolders: [{ id: 'f1' }] })
    expect((host!.querySelector('button[aria-label="折叠全部"]') as HTMLButtonElement).disabled).toBe(false)
  })

  it('新建文件夹落在根层', () => {
    const seen: string[] = []
    renderActions({ openCreateFavoriteFolder: (parentId) => seen.push(String(parentId)) as any })

    act(() => {
      ;(host!.querySelector('button[aria-label="新建文件夹"]') as HTMLElement).click()
    })

    expect(seen).toEqual([''])
  })
})
