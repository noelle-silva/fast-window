// @vitest-environment happy-dom
//
// 派生列表失效依据单一来源守护（收藏夹模态）：
// 收藏夹列表只允许以显式刷新地址为失效依据。
// 时序场景：先打开模态（列表为空），收藏数据后到（就地写入 + 对应地址通知），
// 列表必须自动出现，不得依赖切换视图或对象引用比对来补救。
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material'
import { getColorThemeColors, resolveColorThemePreview } from '../../domain/colorTheme'
import { refreshScopes } from '../../domain/uiRefreshScope'
import { createStudioMuiTheme } from '../colorThemeStyles'
import { FavoritesDialog } from '../dialogs/FavoritesDialog'
import { createUiCore } from '../uiCore'
import { useFavoriteFolders } from './useFavoriteFolders'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const noop: any = () => {}
const emptyIndicator: any = () => ''

function createControllerStub(uiCore: ReturnType<typeof createUiCore>) {
  return {
    getSnapshot: () => uiCore.getVer(),
    subscribe: uiCore.subscribe,
    getScopeVer: (scope: string) => uiCore.getScopeVer(scope),
    subscribeScope: (scope: string, fn: () => void) => uiCore.subscribeScope(scope, fn),
    fmtTime: () => '',
    actions: {},
  } as any
}

function createData() {
  return {
    chatsByRole: {},
    chatsByGroup: {},
    chatsByWorkspace: {},
    favorites: { folders: [] as any[], chatRefsByFolderId: {} as Record<string, any[]> },
  } as any
}

function FavoritesHarness(props: { controller: any; data: any }) {
  const favorites = useFavoriteFolders({
    controller: props.controller,
    data: props.data,
    roles: [],
    groups: [],
    workspaces: [],
    clearChatSessionRunNotice: noop,
    requestSwitch: noop,
    closeFavoritesDialog: noop,
    chatSessionRunIndicatorKind: emptyIndicator,
    activeTargetKind: 'workspace',
    activeChatTargetId: '',
    activeChatId: '',
  })

  return (
    <FavoritesDialog
      open
      onClose={noop}
      favoriteFolders={favorites.favoriteFolders}
      renderFavoriteFolderTree={favorites.renderFavoriteFolderTree}
      collapseAllFavoriteFolders={favorites.collapseAllFavoriteFolders}
      openCreateFavoriteFolder={favorites.openCreateFavoriteFolder}
      favoriteSearchOpen={favorites.favoriteSearchOpen}
      setFavoriteSearchOpen={favorites.setFavoriteSearchOpen}
      favoriteSearchText={favorites.favoriteSearchText}
      setFavoriteSearchText={favorites.setFavoriteSearchText}
      favoriteSearchInputRef={favorites.favoriteSearchInputRef}
    />
  )
}

describe('收藏夹模态：显式刷新地址', () => {
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

  function renderHarness(element: React.ReactElement) {
    const theme = createStudioMuiTheme('light', getColorThemeColors(resolveColorThemePreview(undefined, null)))
    act(() => {
      root.render(<ThemeProvider theme={theme}>{element}</ThemeProvider>)
    })
  }

  it('先打开收藏夹、收藏数据后到时，收藏夹列表自动出现且无需切换视图', () => {
    const uiCore = createUiCore()
    const controller = createControllerStub(uiCore)
    const data = createData()

    renderHarness(<FavoritesHarness controller={controller} data={data} />)
    expect(document.body.textContent).toContain('还没有收藏夹')
    const globalVersion = uiCore.getVer()

    act(() => {
      data.favorites.folders.push({ id: 'f1', name: '后到收藏夹', parentId: '', createdAt: 1 })
      uiCore.emitScope(refreshScopes.entities('favorites'))
    })

    expect(uiCore.getVer()).toBe(globalVersion)
    expect(document.body.textContent).toContain('后到收藏夹')
  })
})
