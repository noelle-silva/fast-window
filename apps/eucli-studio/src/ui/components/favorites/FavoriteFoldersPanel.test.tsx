// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material'
import { getColorThemeColors, resolveColorThemePreview } from '../../../domain/colorTheme'
import { createStudioMuiTheme } from '../../colorThemeStyles'
import { FavoriteFoldersPanel, type FavoriteFoldersPanelProps } from './FavoriteFoldersPanel'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const noop = () => {}

function createProps(overrides: Partial<FavoriteFoldersPanelProps> = {}): FavoriteFoldersPanelProps {
  return {
    favoriteFolders: [],
    renderFavoriteFolderTree: () => null,
    collapseAllFavoriteFolders: noop,
    openCreateFavoriteFolder: noop,
    favoriteSearchOpen: false,
    setFavoriteSearchOpen: noop as any,
    favoriteSearchText: '',
    setFavoriteSearchText: noop as any,
    favoriteSearchInputRef: { current: null },
    ...overrides,
  }
}

describe('会话收藏夹面板', () => {
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

  function renderPanel(overrides: Partial<FavoriteFoldersPanelProps> = {}) {
    const theme = createStudioMuiTheme('light', getColorThemeColors(resolveColorThemePreview(undefined, null)))
    act(() => {
      root.render(
        <ThemeProvider theme={theme}>
          <FavoriteFoldersPanel {...createProps(overrides)} />
        </ThemeProvider>,
      )
    })
  }

  it('没有收藏夹时给出空态，不铺列表', () => {
    renderPanel()

    expect(host!.textContent).toContain('还没有收藏夹')
    expect(host!.querySelector('ul')).toBeNull()
  })

  it('有收藏夹时把文件夹树铺进列表', () => {
    renderPanel({
      favoriteFolders: [{ id: 'f1', name: '甲文件夹' }],
      renderFavoriteFolderTree: () => <div>甲文件夹节点</div>,
    })

    expect(host!.querySelector('ul')).toBeTruthy()
    expect(host!.textContent).toContain('甲文件夹节点')
  })

  it('搜索框随开关展开，收起时不占可见位置', () => {
    renderPanel({ favoriteSearchOpen: false })
    expect(host!.querySelector('.MuiCollapse-root')!.className).toContain('MuiCollapse-hidden')

    renderPanel({ favoriteSearchOpen: true })
    expect(host!.querySelector('.MuiCollapse-root')!.className).not.toContain('MuiCollapse-hidden')
    expect(host!.querySelector('input')!.getAttribute('placeholder')).toBe('搜索收藏夹…')
  })

  it('输入搜索词交回上层', () => {
    const seen: string[] = []
    renderPanel({ favoriteSearchOpen: true, setFavoriteSearchText: ((next: any) => seen.push(next)) as any })

    const input = host!.querySelector('input') as HTMLInputElement
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setValue.call(input, '甲')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(seen).toEqual(['甲'])
  })

  it('搜索框按 Esc 收起并清空词', () => {
    const opened: boolean[] = []
    const cleared: string[] = []
    renderPanel({
      favoriteSearchOpen: true,
      setFavoriteSearchOpen: ((next: any) => opened.push(next)) as any,
      setFavoriteSearchText: ((next: any) => cleared.push(next)) as any,
    })

    act(() => {
      ;(host!.querySelector('input') as HTMLInputElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })

    expect(opened).toEqual([false])
    expect(cleared).toEqual([''])
  })
})
