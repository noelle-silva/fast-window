import { describe, expect, it } from 'vitest'
import {
  entityDeleteHelperText,
  folderDeleteHelperText,
  folderTitle,
  getRefFrame,
  getRefGridSpan,
  getRefPixelRect,
} from './helpers'
import type { FavoriteItemRef, HyperCortexFavoritesDocV1 } from '../../favorites'

function ref(id: string, x: number, y: number, w: number, h: number): FavoriteItemRef {
  return { id, folderId: 'root', kind: 'note', targetId: `t_${id}`, layout: { x, y, w, h }, createdAtMs: 1, updatedAtMs: 1 }
}

function doc(overrides: Partial<HyperCortexFavoritesDocV1> = {}): HyperCortexFavoritesDocV1 {
  return {
    version: 1,
    rootFolderId: 'root',
    folders: { root: { id: 'root', title: '', description: '', createdAtMs: 1, updatedAtMs: 1 } },
    refsByFolderId: { root: [] },
    ...overrides,
  }
}

describe('folderTitle', () => {
  it('returns 根目录 for root and for blank ids', () => {
    expect(folderTitle(doc(), 'root')).toBe('根目录')
    expect(folderTitle(doc(), '')).toBe('根目录')
    expect(folderTitle(doc(), '   ')).toBe('根目录')
  })

  it('returns 未命名文件夹 for a missing folder', () => {
    expect(folderTitle(doc(), 'nope')).toBe('未命名文件夹')
  })

  it('returns the stored title as-is without trimming (current quirk)', () => {
    const d = doc({
      folders: {
        root: { id: 'root', title: '', description: '', createdAtMs: 1, updatedAtMs: 1 },
        g1: { id: 'g1', title: '  ', description: '', createdAtMs: 1, updatedAtMs: 1 },
      },
    })
    expect(folderTitle(d, 'g1')).toBe('  ')
  })
})

describe('getRefGridSpan', () => {
  it('maps a normalized layout to 1-based grid spans', () => {
    expect(getRefGridSpan(ref('a', 0, 0, 2, 2))).toEqual({ gridColumn: '1 / span 2', gridRow: '1 / span 2' })
  })

  it('clamps the span when the layout overflows the grid', () => {
    expect(getRefGridSpan(ref('a', 11, 3, 5, 9))).toEqual({ gridColumn: '12 / span 1', gridRow: '4 / span 9' })
  })
})

describe('getRefFrame', () => {
  it.each([
    [0, { width: 8, height: 152 }],
    [100, { width: 10, height: 152 }],
    [-50, { width: 8, height: 152 }],
  ])('computes the frame for grid width %s', (gridWidth, expected) => {
    expect(getRefFrame({ x: 0, y: 0, w: 2, h: 2 }, gridWidth)).toEqual(expected)
  })

  it('computes a fractional column width', () => {
    const frame = getRefFrame({ x: 0, y: 0, w: 2, h: 2 }, 1200)
    expect(frame.width).toBeCloseTo(193.33333333333334, 10)
    expect(frame.height).toBe(152)
  })
})

describe('getRefPixelRect', () => {
  it.each([
    [0, { left: 24, top: 160, width: 8, height: 152 }],
    [100, { left: 27, top: 160, width: 10, height: 152 }],
    [-50, { left: 24, top: 160, width: 8, height: 152 }],
  ])('computes the pixel rect for grid width %s', (gridWidth, expected) => {
    expect(getRefPixelRect({ x: 3, y: 2, w: 2, h: 2 }, gridWidth)).toEqual(expected)
  })

  it('computes a fractional left offset', () => {
    const rect = getRefPixelRect({ x: 3, y: 2, w: 2, h: 2 }, 1200)
    expect(rect.left).toBeCloseTo(302, 10)
    expect(rect.width).toBeCloseTo(193.33333333333334, 10)
  })
})

describe('folderDeleteHelperText', () => {
  it('warns about the root folder', () => {
    expect(folderDeleteHelperText('root')).toBe('根目录是系统入口，不能删除。')
  })

  it('explains entity deletion otherwise', () => {
    expect(folderDeleteHelperText('g1')).toBe('这是 delete entity，会删除收藏夹本体，并清理所有页面里对它的引用。')
  })
})

describe('entityDeleteHelperText', () => {
  it.each([
    ['folder', '这是 delete entity，不是 remove ref。删除后，所有页面中指向这个收藏夹的卡片都会被清理。'],
    ['note', '这是 delete entity，不是 remove ref。删除后，现有页面中的相关卡片会变成失效引用卡片。'],
    ['asset', '这是 delete entity，不是 remove ref。确认后附件会移入回收站，现有页面中的相关卡片会变成失效引用卡片。'],
  ] as const)('returns the copy for kind %s', (kind, expected) => {
    expect(entityDeleteHelperText(kind)).toBe(expected)
  })
})
