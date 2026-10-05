// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DragStartEvent } from '@dnd-kit/core'
import type { FavoriteFolder, FavoriteItemRef, HyperCortexFavoritesDocV1 } from '../favorites'
import { useFavoritesSidebarDnd, CROSS_PENDING_REF_ID } from './useFavoritesSidebarDnd'

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

function ctrlDragStart(): DragStartEvent {
  return { activatorEvent: { ctrlKey: true } } as unknown as DragStartEvent
}

let api: ReturnType<typeof useFavoritesSidebarDnd> | null = null

function Harness(props: Parameters<typeof useFavoritesSidebarDnd>[0]): null {
  api = useFavoritesSidebarDnd(props)
  return null
}

describe('useFavoritesSidebarDnd modes', () => {
  let container: HTMLDivElement
  let root: Root

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
    act(() => {
      root.render(<Harness {...props} />)
    })
  }

  function refOrder(): string[] {
    return api!.effectiveRefs.map(ref => ref.id)
  }

  it('restores the sort preview on Ctrl release and commits the reorder on drop', () => {
    const doc = fixtureDoc()
    const onReorderRefs = vi.fn()
    const onMoveRef = vi.fn()
    renderHook({ refs: doc.refsByFolderId.root, currentFolderId: 'root', doc, onReorderRefs, onMoveRef })

    act(() => api!.handleDragStart('r1', ctrlDragStart()))
    act(() => api!.handleDragOver('r1', 'r3'))
    expect(api!.moveMode).toBe(true)
    expect(refOrder()).toEqual(['r1', 'r2', 'r3', 'r4'])

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }))
    })
    expect(api!.moveMode).toBe(false)
    expect(refOrder()).toEqual(['r2', 'r3', 'r1', 'r4'])

    act(() => api!.handleDragEnd('r1', 'r3'))
    expect(onMoveRef).not.toHaveBeenCalled()
    expect(onReorderRefs).toHaveBeenCalledWith('root', ['r2', 'r3', 'r1', 'r4'])
  })

  it('keeps updating the sort preview after Ctrl release while still dragging', () => {
    const doc = fixtureDoc()
    const onReorderRefs = vi.fn()
    const onMoveRef = vi.fn()
    renderHook({ refs: doc.refsByFolderId.root, currentFolderId: 'root', doc, onReorderRefs, onMoveRef })

    act(() => api!.handleDragStart('r1', ctrlDragStart()))
    act(() => api!.handleDragOver('r1', 'r2'))
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }))
    })
    expect(refOrder()).toEqual(['r2', 'r1', 'r3', 'r4'])

    act(() => api!.handleDragOver('r1', 'r4'))
    expect(refOrder()).toEqual(['r2', 'r3', 'r4', 'r1'])

    act(() => api!.handleDragEnd('r1', 'r4'))
    expect(onMoveRef).not.toHaveBeenCalled()
    expect(onReorderRefs).toHaveBeenCalledWith('root', ['r2', 'r3', 'r4', 'r1'])
  })

  it('drops the sort preview when Ctrl is pressed again mid-drag', () => {
    const doc = fixtureDoc()
    const onReorderRefs = vi.fn()
    const onMoveRef = vi.fn()
    renderHook({ refs: doc.refsByFolderId.root, currentFolderId: 'root', doc, onReorderRefs, onMoveRef })

    act(() => api!.handleDragStart('r1'))
    act(() => api!.handleDragOver('r1', 'r3'))
    expect(refOrder()).toEqual(['r2', 'r3', 'r1', 'r4'])

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }))
    })
    expect(api!.moveMode).toBe(true)
    expect(refOrder()).toEqual(['r1', 'r2', 'r3', 'r4'])
    expect(api!.dropTargetRefId).toBe('')

    act(() => api!.handleDragOver('r1', 'r2'))
    expect(api!.dropTargetRefId).toBe('r2')

    act(() => api!.handleDragEnd('r1', 'r2'))
    expect(onMoveRef).toHaveBeenCalledWith('r1', 'f1')
    expect(onReorderRefs).not.toHaveBeenCalled()
  })

  it('moves the ref into the hovered folder when Ctrl is held at drop', () => {
    const doc = fixtureDoc()
    const onReorderRefs = vi.fn()
    const onMoveRef = vi.fn()
    renderHook({ refs: doc.refsByFolderId.root, currentFolderId: 'root', doc, onReorderRefs, onMoveRef })

    act(() => api!.handleDragStart('r1', ctrlDragStart()))
    act(() => api!.handleDragOver('r1', 'r2'))
    expect(api!.dropTargetRefId).toBe('r2')

    act(() => api!.handleDragEnd('r1', 'r2'))
    expect(onMoveRef).toHaveBeenCalledWith('r1', 'f1')
    expect(onReorderRefs).not.toHaveBeenCalled()
  })

  it('keeps pure sorting behavior when no move capability is provided', () => {
    const doc = fixtureDoc()
    const onReorderRefs = vi.fn()
    renderHook({ refs: doc.refsByFolderId.root, currentFolderId: 'root', doc, onReorderRefs })

    act(() => api!.handleDragStart('r1', ctrlDragStart()))
    act(() => api!.handleDragOver('r1', 'r3'))
    act(() => api!.handleDragEnd('r1', 'r3'))
    expect(onReorderRefs).toHaveBeenCalledWith('root', ['r2', 'r3', 'r1', 'r4'])
  })
})

describe('useFavoritesSidebarDnd cross-column takeover', () => {
  let container: HTMLDivElement
  let root: Root

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
    act(() => {
      root.render(<Harness {...props} />)
    })
  }

  function refOrder(): string[] {
    return api!.effectiveRefs.map(ref => ref.id)
  }

  it('takes over a foreign item and previews it in the native sort order', () => {
    const doc = fixtureDoc()
    const onCommitForeign = vi.fn()
    renderHook({ refs: doc.refsByFolderId.root, currentFolderId: 'root', doc, onCommitForeign })

    act(() => api!.beginForeign({ kind: 'note', targetId: 'n9' }, false))
    expect(refOrder()).toEqual(['r1', 'r2', 'r3', 'r4', CROSS_PENDING_REF_ID])

    act(() => api!.handleDragOver(CROSS_PENDING_REF_ID, 'r3'))
    expect(refOrder()).toEqual(['r1', 'r2', CROSS_PENDING_REF_ID, 'r3', 'r4'])

    act(() => api!.handleDragEnd(CROSS_PENDING_REF_ID, 'r3'))
    expect(onCommitForeign).toHaveBeenCalledWith(
      { kind: 'note', targetId: 'n9' },
      { moveMode: false, overRefId: 'r3', insertIndex: 2 },
    )
    expect(refOrder()).toEqual(['r1', 'r2', 'r3', 'r4'])
  })

  it('drops a foreign item into the hovered folder while Ctrl is held', () => {
    const doc = fixtureDoc()
    const onCommitForeign = vi.fn()
    renderHook({ refs: doc.refsByFolderId.root, currentFolderId: 'root', doc, onCommitForeign, onMoveRef: vi.fn() })

    act(() => api!.beginForeign({ kind: 'asset', targetId: 'a.png' }, true))
    act(() => api!.handleDragOver(CROSS_PENDING_REF_ID, 'r2'))
    expect(api!.moveMode).toBe(true)
    expect(api!.dropTargetRefId).toBe('r2')

    act(() => api!.handleDragEnd(CROSS_PENDING_REF_ID, 'r2'))
    expect(onCommitForeign).toHaveBeenCalledWith(
      { kind: 'asset', targetId: 'a.png' },
      { moveMode: true, overRefId: 'r2', insertIndex: -1 },
    )
  })

  it('clears the foreign preview when it leaves the right side', () => {
    const doc = fixtureDoc()
    const onCommitForeign = vi.fn()
    renderHook({ refs: doc.refsByFolderId.root, currentFolderId: 'root', doc, onCommitForeign })

    act(() => api!.beginForeign({ kind: 'note', targetId: 'n9' }, false))
    expect(refOrder()).toContain(CROSS_PENDING_REF_ID)
    act(() => api!.endForeign())
    expect(refOrder()).toEqual(['r1', 'r2', 'r3', 'r4'])
  })
})
