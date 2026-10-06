// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FavoriteFolder, FavoriteItemRef, HyperCortexFavoritesDocV1 } from '../favorites'
import { useFavoritesSidebarDnd } from './useFavoritesSidebarDnd'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function folder(id: string): FavoriteFolder {
  return { id, title: id, description: '', createdAtMs: 1, updatedAtMs: 1 }
}

function itemRef(id: string, kind: FavoriteItemRef['kind'], targetId: string): FavoriteItemRef {
  return { id, folderId: 'root', kind, targetId, layout: { x: 0, y: 0, w: 2, h: 2 }, createdAtMs: 1, updatedAtMs: 1 }
}

// r1 / r3 / r4 是笔记引用，r2 是指向收藏夹 f1 的文件夹引用。
function fixtureDoc(): HyperCortexFavoritesDocV1 {
  return {
    version: 1,
    rootFolderId: 'root',
    folders: { root: folder('root'), f1: folder('f1') },
    refsByFolderId: {
      root: [itemRef('r1', 'note', 'n1'), itemRef('r2', 'folder', 'f1'), itemRef('r3', 'note', 'n3'), itemRef('r4', 'note', 'n4')],
    },
  }
}

let api: ReturnType<typeof useFavoritesSidebarDnd> | null = null

function Harness(props: Parameters<typeof useFavoritesSidebarDnd>[0]): null {
  api = useFavoritesSidebarDnd(props)
  return null
}

describe('useFavoritesSidebarDnd modes', () => {
  let container: HTMLDivElement
  let root: Root
  let current: Parameters<typeof useFavoritesSidebarDnd>[0]

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    api = null
  })

  function renderHook(props: Parameters<typeof useFavoritesSidebarDnd>[0]): void {
    current = props
    act(() => {
      root.render(<Harness {...props} />)
    })
  }

  function rerender(patch: Partial<Parameters<typeof useFavoritesSidebarDnd>[0]>): void {
    current = { ...current, ...patch }
    act(() => {
      root.render(<Harness {...current} />)
    })
  }

  function refOrder(): string[] {
    return api!.effectiveRefs.map(ref => ref.id)
  }

  it('按下 Ctrl 期间无排序预演，松开后按悬停位置恢复预演并在松手提交重排', () => {
    const doc = fixtureDoc()
    const onReorderRefs = vi.fn()
    const onMoveRef = vi.fn()
    renderHook({ refs: doc.refsByFolderId.root, currentFolderId: 'root', doc, onReorderRefs, onMoveRef, activeId: 'r1', foreignItem: null, modifierHeld: true })

    act(() => api!.handleDragStart())
    act(() => api!.handleDragOver('r1', 'r3'))
    expect(api!.moveMode).toBe(true)
    expect(refOrder()).toEqual(['r1', 'r2', 'r3', 'r4'])

    rerender({ modifierHeld: false })
    expect(api!.moveMode).toBe(false)
    expect(refOrder()).toEqual(['r2', 'r3', 'r1', 'r4'])

    act(() => api!.handleDragEnd('r1', 'r3'))
    expect(onMoveRef).not.toHaveBeenCalled()
    expect(onReorderRefs).toHaveBeenCalledWith('root', ['r2', 'r3', 'r1', 'r4'])
  })

  it('松开 Ctrl 后继续拖拽仍持续更新排序预演', () => {
    const doc = fixtureDoc()
    const onReorderRefs = vi.fn()
    const onMoveRef = vi.fn()
    renderHook({ refs: doc.refsByFolderId.root, currentFolderId: 'root', doc, onReorderRefs, onMoveRef, activeId: 'r1', foreignItem: null, modifierHeld: true })

    act(() => api!.handleDragStart())
    act(() => api!.handleDragOver('r1', 'r2'))
    rerender({ modifierHeld: false })
    expect(refOrder()).toEqual(['r2', 'r1', 'r3', 'r4'])

    act(() => api!.handleDragOver('r1', 'r4'))
    expect(refOrder()).toEqual(['r2', 'r3', 'r4', 'r1'])

    act(() => api!.handleDragEnd('r1', 'r4'))
    expect(onMoveRef).not.toHaveBeenCalled()
    expect(onReorderRefs).toHaveBeenCalledWith('root', ['r2', 'r3', 'r4', 'r1'])
  })

  it('拖动中按下 Ctrl 即丢弃排序预演并切到移动模式', () => {
    const doc = fixtureDoc()
    const onReorderRefs = vi.fn()
    const onMoveRef = vi.fn()
    renderHook({ refs: doc.refsByFolderId.root, currentFolderId: 'root', doc, onReorderRefs, onMoveRef, activeId: 'r1', foreignItem: null, modifierHeld: false })

    act(() => api!.handleDragStart())
    act(() => api!.handleDragOver('r1', 'r3'))
    expect(refOrder()).toEqual(['r2', 'r3', 'r1', 'r4'])

    rerender({ modifierHeld: true })
    expect(api!.moveMode).toBe(true)
    expect(refOrder()).toEqual(['r1', 'r2', 'r3', 'r4'])
    expect(api!.dropTargetRefId).toBe('')

    act(() => api!.handleDragOver('r1', 'r2'))
    expect(api!.dropTargetRefId).toBe('r2')

    act(() => api!.handleDragEnd('r1', 'r2'))
    expect(onMoveRef).toHaveBeenCalledWith('r1', 'f1')
    expect(onReorderRefs).not.toHaveBeenCalled()
  })

  it('松手时按住 Ctrl 则移入悬停收藏夹', () => {
    const doc = fixtureDoc()
    const onReorderRefs = vi.fn()
    const onMoveRef = vi.fn()
    renderHook({ refs: doc.refsByFolderId.root, currentFolderId: 'root', doc, onReorderRefs, onMoveRef, activeId: 'r1', foreignItem: null, modifierHeld: true })

    act(() => api!.handleDragStart())
    act(() => api!.handleDragOver('r1', 'r2'))
    expect(api!.dropTargetRefId).toBe('r2')

    act(() => api!.handleDragEnd('r1', 'r2'))
    expect(onMoveRef).toHaveBeenCalledWith('r1', 'f1')
    expect(onReorderRefs).not.toHaveBeenCalled()
  })

  it('未提供移动能力时保持纯排序行为', () => {
    const doc = fixtureDoc()
    const onReorderRefs = vi.fn()
    renderHook({ refs: doc.refsByFolderId.root, currentFolderId: 'root', doc, onReorderRefs, activeId: 'r1', foreignItem: null, modifierHeld: false })

    act(() => api!.handleDragStart())
    act(() => api!.handleDragOver('r1', 'r3'))
    act(() => api!.handleDragEnd('r1', 'r3'))
    expect(onReorderRefs).toHaveBeenCalledWith('root', ['r2', 'r3', 'r1', 'r4'])
  })
})

describe('useFavoritesSidebarDnd cross-column takeover', () => {
  let container: HTMLDivElement
  let root: Root
  let current: Parameters<typeof useFavoritesSidebarDnd>[0]

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    api = null
  })

  function renderHook(props: Parameters<typeof useFavoritesSidebarDnd>[0]): void {
    current = props
    act(() => {
      root.render(<Harness {...props} />)
    })
  }

  function rerender(patch: Partial<Parameters<typeof useFavoritesSidebarDnd>[0]>): void {
    current = { ...current, ...patch }
    act(() => {
      root.render(<Harness {...current} />)
    })
  }

  function refOrder(): string[] {
    return api!.effectiveRefs.map(ref => ref.id)
  }

  const NOTE_TAB = 'tab:note:n9'

  it('外来条目以同一身份加入本栏并按落点提交', () => {
    const doc = fixtureDoc()
    const onCommitForeign = vi.fn()
    renderHook({
      refs: doc.refsByFolderId.root,
      currentFolderId: 'root',
      doc,
      onCommitForeign,
      activeId: NOTE_TAB,
      foreignItem: { id: NOTE_TAB, kind: 'note', targetId: 'n9' },
      modifierHeld: false,
    })

    act(() => api!.handleDragStart())
    expect(refOrder()).toEqual(['r1', 'r2', 'r3', 'r4', NOTE_TAB])

    act(() => api!.handleDragOver(NOTE_TAB, 'r3'))
    expect(refOrder()).toEqual(['r1', 'r2', NOTE_TAB, 'r3', 'r4'])

    act(() => api!.handleDragEnd(NOTE_TAB, 'r3'))
    expect(onCommitForeign).toHaveBeenCalledWith(
      { id: NOTE_TAB, kind: 'note', targetId: 'n9' },
      { moveMode: false, overRefId: 'r3', insertIndex: 2 },
    )

    rerender({ activeId: '', foreignItem: null })
    expect(refOrder()).toEqual(['r1', 'r2', 'r3', 'r4'])
  })

  it('外来条目首次事件时尚未随渲染到达本栏也能立即落进空位', () => {
    const doc = fixtureDoc()
    const onCommitForeign = vi.fn()
    renderHook({
      refs: doc.refsByFolderId.root,
      currentFolderId: 'root',
      doc,
      onCommitForeign,
      activeId: NOTE_TAB,
      foreignItem: null,
      modifierHeld: false,
    })

    // 首次事件时外来载荷尚未随渲染到达本栏，预览仍应立即落在悬停空位。
    act(() => api!.handleDragOver(NOTE_TAB, 'r3'))
    rerender({ foreignItem: { id: NOTE_TAB, kind: 'note', targetId: 'n9' } })
    expect(refOrder()).toEqual(['r1', 'r2', NOTE_TAB, 'r3', 'r4'])
  })

  it('按住 Ctrl 时外来条目放入悬停收藏夹', () => {
    const doc = fixtureDoc()
    const onCommitForeign = vi.fn()
    const ASSET_TAB = 'tab:asset:a.png'
    renderHook({
      refs: doc.refsByFolderId.root,
      currentFolderId: 'root',
      doc,
      onCommitForeign,
      onMoveRef: vi.fn(),
      activeId: ASSET_TAB,
      foreignItem: { id: ASSET_TAB, kind: 'asset', targetId: 'a.png' },
      modifierHeld: true,
    })

    act(() => api!.handleDragStart())
    act(() => api!.handleDragOver(ASSET_TAB, 'r2'))
    expect(api!.moveMode).toBe(true)
    expect(api!.dropTargetRefId).toBe('r2')

    act(() => api!.handleDragEnd(ASSET_TAB, 'r2'))
    expect(onCommitForeign).toHaveBeenCalledWith(
      { id: ASSET_TAB, kind: 'asset', targetId: 'a.png' },
      { moveMode: true, overRefId: 'r2', insertIndex: -1 },
    )
  })
})
