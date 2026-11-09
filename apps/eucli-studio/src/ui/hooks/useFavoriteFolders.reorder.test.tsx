// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFavoritesOperations } from '../../controller/favoritesOperations'
import { refreshScopes } from '../../domain/uiRefreshScope'
import { createUiCore } from '../uiCore'
import { useFavoriteFolders } from './useFavoriteFolders'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function Harness(props: { deps: any; apiRef: React.MutableRefObject<any> }) {
  props.apiRef.current = useFavoriteFolders(props.deps)
  return null
}

describe('收藏夹排序动作到层投影', () => {
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

  it('reorderFavoriteFolders 之后，层投影按新顺序返回', async () => {
    const uiCore = createUiCore()
    const state: any = {
      data: {
        favorites: {
          folders: [
            { id: 'f1', name: '甲', parentId: '', createdAt: 1, updatedAt: 1 },
            { id: 'f2', name: '乙', parentId: '', createdAt: 2, updatedAt: 2 },
          ],
          chatRefsByFolderId: { f1: [], f2: [] },
        },
      },
    }
    const ops = createFavoritesOperations({
      getState: () => state,
      save: async () => {},
      emitScope: uiCore.emitScope,
      showToast: () => {},
      activeTargetKind: () => 'role',
      activeRole: () => null,
      activeGroup: () => null,
    })
    const controller = {
      getScopeVer: (scope: string) => uiCore.getScopeVer(scope),
      subscribeScope: (scope: string, fn: () => void) => uiCore.subscribeScope(scope, fn),
      actions: {},
    } as any
    const deps = {
      controller,
      data: state.data,
      roles: [],
      groups: [],
      workspaces: [],
      clearChatSessionRunNotice: () => {},
      requestSwitch: () => {},
      closeFavoritesDialog: () => {},
      chatSessionRunIndicatorKind: () => '' as const,
      activeTargetKind: 'role' as const,
      activeChatTargetId: '',
      activeChatId: '',
    }

    act(() => {
      root.render(<Harness deps={deps} apiRef={apiRef} />)
    })
    expect(apiRef.current.buildFavoriteFolderLevel('').folders.map((folder: any) => folder.id)).toEqual(['f1', 'f2'])

    await act(async () => {
      await ops.reorderFavoriteFolders('', ['f2', 'f1'])
      uiCore.emitScope(refreshScopes.entities('favorites'))
    })

    expect(apiRef.current.buildFavoriteFolderLevel('').folders.map((folder: any) => folder.id)).toEqual(['f2', 'f1'])
  })

  it('列表没加载时先标待加载，加载完仍找不到才算丢失', () => {
    const uiCore = createUiCore()
    const state: any = {
      data: {
        favorites: {
          folders: [{ id: 'f1', name: '甲', parentId: '', createdAt: 1, updatedAt: 1 }],
          chatRefsByFolderId: {
            f1: [{ targetKind: 'role', targetId: 'role-a', roleId: '', chatId: 'chat-gone', addedAt: 1 }],
          },
        },
      },
    }
    const controller = {
      getScopeVer: (scope: string) => uiCore.getScopeVer(scope),
      subscribeScope: (scope: string, fn: () => void) => uiCore.subscribeScope(scope, fn),
      actions: {},
    } as any
    const deps = {
      controller,
      data: state.data,
      roles: [],
      groups: [],
      workspaces: [],
      clearChatSessionRunNotice: () => {},
      requestSwitch: () => {},
      closeFavoritesDialog: () => {},
      chatSessionRunIndicatorKind: () => '' as const,
      activeTargetKind: 'role' as const,
      activeChatTargetId: '',
      activeChatId: '',
    }

    act(() => {
      root.render(<Harness deps={deps} apiRef={apiRef} />)
    })
    // 会话列表还没加载：不能把「查不到」当成「已丢失」。
    expect(apiRef.current.buildFavoriteFolderLevel('f1').refs[0]).toMatchObject({
      title: '会话待加载',
      status: 'pending',
    })

    // 即使该 target 的 chatMetas 已在场，缺项也只说明本地索引是旧副本，不能升级成「已丢失」。
    state.data.chatsByRole = { 'role-a': { chatMetas: [] } }
    act(() => {
      root.render(<Harness deps={deps} apiRef={apiRef} />)
    })
    expect(apiRef.current.buildFavoriteFolderLevel('f1').refs[0]).toMatchObject({
      title: '会话待加载',
      status: 'pending',
    })
  })
})
