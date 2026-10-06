// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SidebarItem } from './sidebarModel'
import { useOpenTabsSortableDnd } from './useOpenTabsSortableDnd'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let api: ReturnType<typeof useOpenTabsSortableDnd> | null = null

function Harness(props: Parameters<typeof useOpenTabsSortableDnd>[0]): null {
  api = useOpenTabsSortableDnd(props)
  return null
}

function fixtureItems(): SidebarItem[] {
  return [
    { type: 'tab', tabKey: 'note:n1' },
    { type: 'group', id: 'g1', title: '分组', color: '#fff', tabKeys: ['note:n2'] },
    { type: 'tab', tabKey: 'note:n3' },
  ]
}

function containsTab(items: SidebarItem[], tabKey: string): boolean {
  return items.some(item => (item.type === 'tab' ? item.tabKey === tabKey : item.tabKeys.includes(tabKey)))
}

describe('useOpenTabsSortableDnd 跨栏接管', () => {
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

  function renderHook(): void {
    act(() => {
      root.render(<Harness enabled sidebarItems={fixtureItems()} onCommitSidebarItems={vi.fn()} />)
    })
  }

  it('跨栏接管把顶层被拖条目从本栏移出', () => {
    renderHook()
    act(() => api!.handleDragStart('tab:note:n1'))
    expect(containsTab(api!.effectiveSidebarItems, 'note:n1')).toBe(true)

    act(() => api!.beginCrossTakeover())
    expect(containsTab(api!.effectiveSidebarItems, 'note:n1')).toBe(false)
    expect(containsTab(api!.effectiveSidebarItems, 'note:n3')).toBe(true)
  })

  it('跨栏接管把分组内被拖条目从本栏移出且保留分组', () => {
    renderHook()
    act(() => api!.handleDragStart('tab:note:n2'))
    act(() => api!.beginCrossTakeover())

    expect(containsTab(api!.effectiveSidebarItems, 'note:n2')).toBe(false)
    expect(api!.effectiveSidebarItems.some(item => item.type === 'group' && item.id === 'g1')).toBe(true)
  })

  it('指针回到本侧时交还条目并按悬停重建排序预览', () => {
    renderHook()
    act(() => api!.handleDragStart('tab:note:n1'))
    act(() => api!.beginCrossTakeover())
    expect(containsTab(api!.effectiveSidebarItems, 'note:n1')).toBe(false)

    act(() => api!.handlePreviewMove('tab:note:n1', 'tab:note:n3', {} as never))
    expect(containsTab(api!.effectiveSidebarItems, 'note:n1')).toBe(true)
    expect(api!.effectiveSidebarItems.map(item => (item.type === 'tab' ? item.tabKey : item.id))).toEqual(['g1', 'note:n3', 'note:n1'])
  })

  it('拖拽取消后被拖条目回到本栏', () => {
    renderHook()
    act(() => api!.handleDragStart('tab:note:n1'))
    act(() => api!.beginCrossTakeover())
    act(() => api!.handleDragCancel())
    expect(containsTab(api!.effectiveSidebarItems, 'note:n1')).toBe(true)
  })
})
