// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFavoriteFolders } from './useFavoriteFolders'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function createController() {
  return {
    actions: {},
    getSnapshot: () => 0,
    subscribe: () => () => {},
  }
}

function createDeps(controller: any) {
  return {
    controller,
    data: { favorites: { folders: [], chatRefsByFolderId: {} } },
    roles: [],
    groups: [],
    workspaces: [],
    clearChatSessionRunNotice: vi.fn(),
    requestSwitch: vi.fn(),
    closeFavoritesDialog: vi.fn(),
    chatSessionRunIndicatorKind: () => '' as const,
    activeTargetKind: 'role' as const,
    activeChatTargetId: '',
    activeChatId: '',
  }
}

function Harness(props: { deps: any; apiRef: React.MutableRefObject<any> }) {
  props.apiRef.current = useFavoriteFolders(props.deps)
  return null
}

function contextMenuEvent() {
  return {
    clientX: 42,
    clientY: 77,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.MouseEvent
}

// 收藏夹右键菜单只有一个通道：favoriteFolderMenu 状态。
// 弹窗的树与侧边栏的层级浏览都从这里进，所以这里验的是「入口只写那一份状态」。
describe('收藏夹右键菜单入口', () => {
  let host: HTMLDivElement | null = null
  let root: any = null
  let apiRef: React.MutableRefObject<any> = { current: null }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    apiRef = { current: null }
  })

  afterEach(() => {
    if (root) {
      act(() => root.unmount())
      root = null
    }
    host?.remove()
    host = null
  })

  function renderHook() {
    act(() => {
      root.render(<Harness deps={createDeps(createController())} apiRef={apiRef} />)
    })
  }

  it('右键把收藏夹、父级与坐标写进菜单状态，并吃掉浏览器默认菜单', () => {
    renderHook()
    const event = contextMenuEvent()

    act(() => apiRef.current.openFavoriteFolderMenu(event, 'f1', 'p1'))

    expect(apiRef.current.favoriteFolderMenu).toEqual({ folderId: 'f1', parentId: 'p1', x: 42, y: 77 })
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
  })

  it('没有收藏夹标识时不打开菜单', () => {
    renderHook()
    const event = contextMenuEvent()

    act(() => apiRef.current.openFavoriteFolderMenu(event, '', ''))

    expect(apiRef.current.favoriteFolderMenu).toEqual({ folderId: '', parentId: '', x: 0, y: 0 })
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
