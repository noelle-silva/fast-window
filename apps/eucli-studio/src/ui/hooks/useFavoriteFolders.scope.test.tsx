// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { refreshScopes } from '../../domain/uiRefreshScope'
import { createUiCore } from '../uiCore'
import { useFavoriteFolders } from './useFavoriteFolders'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function createController(uiCore: ReturnType<typeof createUiCore>) {
  return {
    getScopeVer: (scope: string) => uiCore.getScopeVer(scope),
    subscribeScope: (scope: string, fn: () => void) => uiCore.subscribeScope(scope, fn),
    actions: {},
  } as any
}

function createDeps(controller: any, data: any) {
  return {
    controller,
    data,
    roles: [],
    groups: [],
    workspaces: [],
    clearChatSessionRunNotice: () => {},
    requestSwitch: () => {},
    closeChatPicker: () => {},
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

describe('收藏夹范围订阅', () => {
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

  it('只由 entities:favorites 刷新，全局 emit 不再兜底', () => {
    const uiCore = createUiCore()
    const controller = createController(uiCore)
    const data: any = { favorites: { folders: [], chatRefsByFolderId: {} } }

    act(() => {
      root.render(<Harness deps={createDeps(controller, data)} apiRef={apiRef} />)
    })
    expect(apiRef.current.favoriteChildrenMap).toEqual({})

    act(() => {
      data.favorites.folders.push({ id: 'f1', name: '工作', parentId: '', createdAt: 1 })
      uiCore.emit()
    })
    expect(apiRef.current.favoriteChildrenMap).toEqual({})

    act(() => {
      uiCore.emitScope(refreshScopes.entities('favorites'))
    })
    expect(Object.keys(apiRef.current.favoriteChildrenMap)).toContain('')
    expect(apiRef.current.favoriteChildrenMap[''][0]).toMatchObject({ id: 'f1', name: '工作' })
    expect(uiCore.getVer()).toBe(1)
  })
})
