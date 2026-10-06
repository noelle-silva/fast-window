// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FavoriteFolder, FavoriteItemRef, HyperCortexFavoritesDocV1 } from '../favorites'
import { FavoritesTreePickerDialog, type FavoritesTreePickerDialogProps } from './FavoritesTreePickerDialog'

beforeAll(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }
})

function folder(id: string, title: string): FavoriteFolder {
  return { id, title, description: '', createdAtMs: 1, updatedAtMs: 1 }
}

function ref(id: string, folderId: string, kind: FavoriteItemRef['kind'], targetId: string): FavoriteItemRef {
  return { id, folderId, kind, targetId, layout: { x: 0, y: 0, w: 2, h: 2 }, createdAtMs: 1, updatedAtMs: 1 }
}

// 根 ├ 一 ─ 二（含笔记 n1）
//     └ 三 ─ 四
// 前序渲染顺序固定为：root、一、二、三、四。
function fixture(): HyperCortexFavoritesDocV1 {
  return {
    version: 1,
    rootFolderId: 'root',
    folders: { root: folder('root', ''), f1: folder('f1', '一'), f2: folder('f2', '二'), f3: folder('f3', '三'), f4: folder('f4', '四') },
    refsByFolderId: {
      root: [ref('r-f1', 'root', 'folder', 'f1'), ref('r-f3', 'root', 'folder', 'f3')],
      f1: [ref('r-f2', 'f1', 'folder', 'f2')],
      f2: [ref('r-n1', 'f2', 'note', 'n1')],
      f3: [ref('r-f4', 'f3', 'folder', 'f4')],
    },
  }
}

let activeRoot: Root | null = null

afterEach(() => {
  if (activeRoot) {
    act(() => activeRoot!.unmount())
    activeRoot = null
  }
  document.body.innerHTML = ''
})

async function renderPicker(props: FavoritesTreePickerDialogProps): Promise<void> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  activeRoot = createRoot(container)
  await act(async () => {
    activeRoot!.render(React.createElement(FavoritesTreePickerDialog, props))
  })
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 40))
  })
}

function checkboxStates(): { checked: boolean; disabled: boolean }[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).map(input => ({
    checked: input.checked,
    disabled: input.disabled,
  }))
}

function annotationCount(): number {
  return Array.from(document.querySelectorAll('*')).filter(element => element.textContent === CYCLE_REASON).length
}

function clickCheckbox(index: number): void {
  const input = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[index]
  act(() => input.click())
}

function clickButton(label: string): void {
  const button = Array.from(document.querySelectorAll('button')).find(node => node.textContent?.trim() === label)
  if (!button) throw new Error(`未找到按钮：${label}`)
  act(() => button.click())
}

const CYCLE_REASON = '会形成循环引用，不能添加'

describe('FavoritesTreePickerDialog 循环引用灰化', () => {
  it('收藏到：目标自身与其子收藏夹灰掉、行内标注且不放勾选框，其余可勾选', async () => {
    await renderPicker({ open: true, mode: 'favorite', kind: 'folder', targetId: 'f1', doc: fixture(), onClose: () => {}, onSave: () => {} })
    // 「一」「二」灰掉且无勾选框，只剩 root、三、四三个勾选框。
    expect(annotationCount()).toBe(2)
    const states = checkboxStates()
    expect(states).toHaveLength(3)
    expect(states.every(state => !state.disabled)).toBe(true)
    // 已含 f1 的根目录预勾选。
    expect(states[0].checked).toBe(true)
  })

  it('移动到：源页不可选，循环目标灰掉、行内标注且不放勾选框', async () => {
    await renderPicker({ open: true, mode: 'move', kind: 'folder', targetId: 'f1', sourceFolderId: 'f3', doc: fixture(), onClose: () => {}, onSave: () => {} })
    expect(annotationCount()).toBe(2)
    // root、三（源页，禁用）、四三个勾选框。
    const states = checkboxStates()
    expect(states.map(state => state.disabled)).toEqual([false, true, false])
    expect(states.every(state => !state.checked)).toBe(true)
  })

  it('笔记不涉及循环，不做灰化', async () => {
    await renderPicker({ open: true, mode: 'favorite', kind: 'note', targetId: 'n1', doc: fixture(), onClose: () => {}, onSave: () => {} })
    expect(annotationCount()).toBe(0)
    const states = checkboxStates()
    expect(states).toHaveLength(5)
    expect(states.every(state => !state.disabled)).toBe(true)
    // 含该笔记的「二」预勾选。
    expect(states[2].checked).toBe(true)
  })
})

describe('FavoritesTreePickerDialog 添加已有收藏夹', () => {
  it('已在当前页的收藏夹预勾选，循环目标灰掉且不放勾选框', async () => {
    await renderPicker({ open: true, mode: 'add-folder', containerFolderId: 'f1', doc: fixture(), onClose: () => {}, onSave: () => {} })
    // 根目录与「一」灰掉无勾选框，剩「二」「三」「四」三个勾选框。
    expect(annotationCount()).toBe(2)
    const states = checkboxStates()
    expect(states).toHaveLength(3)
    expect(states[0].checked).toBe(true)
  })

  it('确认时回传选中与已勾选集合，支持一次多选增删', async () => {
    const onSave = vi.fn()
    await renderPicker({ open: true, mode: 'add-folder', containerFolderId: 'f1', doc: fixture(), onClose: () => {}, onSave })
    clickCheckbox(0) // 取消「二」
    clickCheckbox(1) // 勾选「三」
    clickButton('保存')
    expect(onSave).toHaveBeenCalledTimes(1)
    const result = onSave.mock.calls[0][0]
    expect([...result.selectedFolderIds].sort()).toEqual(['f3'])
    expect([...result.alreadySavedFolderIds]).toEqual(['f2'])
  })
})
