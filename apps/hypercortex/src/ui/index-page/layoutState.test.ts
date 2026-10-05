import { describe, expect, it } from 'vitest'
import {
  applyLayoutMapToDoc,
  buildBaseLayoutMap,
  buildOrderedLayoutMap,
  buildResolvedLayoutMap,
  buildSortedLayoutMap,
} from './layoutState'
import type { FavoriteItemRef, HyperCortexFavoritesDocV1 } from '../../favorites'

function ref(id: string, x: number, y: number, w: number, h: number): FavoriteItemRef {
  return { id, folderId: 'root', kind: 'note', targetId: `t_${id}`, layout: { x, y, w, h }, createdAtMs: 1, updatedAtMs: 1 }
}

function doc(refs: FavoriteItemRef[]): HyperCortexFavoritesDocV1 {
  return {
    version: 1,
    rootFolderId: 'root',
    folders: { root: { id: 'root', title: '', description: '', createdAtMs: 1, updatedAtMs: 1 } },
    refsByFolderId: { root: refs },
  }
}

function entries(map: Map<string, { x: number; y: number; w: number; h: number }>) {
  return [...map.entries()]
}

describe('buildBaseLayoutMap', () => {
  it('normalizes each ref layout into a map keyed by ref id', () => {
    const refs = [ref('a', 0, 0, 2, 2), ref('b', 0, 0, 2, 2), ref('c', 4, 4, 3, 1)]
    expect(entries(buildBaseLayoutMap(refs))).toEqual([
      ['a', { x: 0, y: 0, w: 2, h: 2 }],
      ['b', { x: 0, y: 0, w: 2, h: 2 }],
      ['c', { x: 4, y: 4, w: 3, h: 1 }],
    ])
  })

  it('returns an empty map for no refs', () => {
    expect(buildBaseLayoutMap([]).size).toBe(0)
  })
})

describe('buildOrderedLayoutMap', () => {
  it('packs the refs in the requested order, wrapping at the column limit', () => {
    const refs = [ref('a', 0, 0, 2, 2), ref('b', 0, 0, 2, 2), ref('c', 4, 4, 3, 1)]
    expect(entries(buildOrderedLayoutMap(refs, ['c', 'a', 'b']))).toEqual([
      ['c', { x: 0, y: 0, w: 3, h: 1 }],
      ['a', { x: 3, y: 0, w: 2, h: 2 }],
      ['b', { x: 5, y: 0, w: 2, h: 2 }],
    ])
  })

  it('falls back to the base map when the order does not cover every ref', () => {
    const refs = [ref('a', 0, 0, 2, 2), ref('b', 0, 0, 2, 2), ref('c', 4, 4, 3, 1)]
    expect(entries(buildOrderedLayoutMap(refs, ['a', 'b']))).toEqual(entries(buildBaseLayoutMap(refs)))
  })

  it('falls back to the base map when the order references unknown ids', () => {
    const refs = [ref('a', 0, 0, 2, 2), ref('b', 0, 0, 2, 2)]
    expect(entries(buildOrderedLayoutMap(refs, ['a', 'ghost']))).toEqual(entries(buildBaseLayoutMap(refs)))
  })

  it('wraps to a new row when the next card does not fit', () => {
    const refs = [ref('a', 0, 0, 5, 2), ref('b', 0, 0, 5, 1), ref('c', 0, 0, 5, 1)]
    expect(entries(buildOrderedLayoutMap(refs, ['a', 'b', 'c']))).toEqual([
      ['a', { x: 0, y: 0, w: 5, h: 2 }],
      ['b', { x: 5, y: 0, w: 5, h: 1 }],
      ['c', { x: 0, y: 2, w: 5, h: 1 }],
    ])
  })
})

describe('buildResolvedLayoutMap', () => {
  it('moves the target and pushes overlapping refs down', () => {
    const refs = [ref('a', 0, 0, 2, 2), ref('b', 0, 0, 2, 2), ref('c', 4, 4, 3, 1)]
    expect(entries(buildResolvedLayoutMap(refs, 'a', { x: 0, y: 0 }))).toEqual([
      ['a', { x: 0, y: 0, w: 2, h: 2 }],
      ['b', { x: 0, y: 2, w: 2, h: 2 }],
      ['c', { x: 4, y: 4, w: 3, h: 1 }],
    ])
  })

  it('clamps the height of a patch that exceeds the max', () => {
    expect(entries(buildResolvedLayoutMap([ref('a', 0, 0, 1, 1)], 'a', { w: 1, h: 99 }))).toEqual([
      ['a', { x: 0, y: 0, w: 2, h: 8 }],
    ])
  })

  it('clamps negative x/y of a patch to zero', () => {
    expect(entries(buildResolvedLayoutMap([ref('a', 0, 0, 2, 2)], 'a', { x: -5, y: -5 }))).toEqual([
      ['a', { x: 0, y: 0, w: 2, h: 2 }],
    ])
  })
})

describe('buildSortedLayoutMap', () => {
  it('reorders the active ref before the over ref and repacks', () => {
    const refs = [ref('a', 0, 0, 2, 2), ref('b', 0, 0, 2, 2), ref('c', 4, 4, 3, 1)]
    expect(entries(buildSortedLayoutMap(refs, 'c', 'a'))).toEqual([
      ['c', { x: 0, y: 0, w: 3, h: 1 }],
      ['a', { x: 3, y: 0, w: 2, h: 2 }],
      ['b', { x: 5, y: 0, w: 2, h: 2 }],
    ])
  })

  it('returns the base map when active and over are the same', () => {
    const refs = [ref('a', 0, 0, 2, 2), ref('b', 0, 0, 2, 2), ref('c', 4, 4, 3, 1)]
    expect(entries(buildSortedLayoutMap(refs, 'a', 'a'))).toEqual(entries(buildBaseLayoutMap(refs)))
  })

  it('returns the base map when either id is unknown', () => {
    const refs = [ref('a', 0, 0, 2, 2), ref('b', 0, 0, 2, 2)]
    expect(entries(buildSortedLayoutMap(refs, 'ghost', 'a'))).toEqual(entries(buildBaseLayoutMap(refs)))
  })
})

describe('applyLayoutMapToDoc', () => {
  it('writes changed layouts and leaves other refs untouched', () => {
    const refs = [ref('a', 0, 0, 2, 2), ref('b', 0, 0, 2, 2), ref('c', 4, 4, 3, 1)]
    const next = applyLayoutMapToDoc(doc(refs), refs, new Map([['a', { x: 1, y: 1, w: 2, h: 2 }]]))
    const list = next.refsByFolderId.root
    expect(list[0].layout).toEqual({ x: 1, y: 1, w: 2, h: 2 })
    expect(list[1].layout).toEqual({ x: 0, y: 0, w: 2, h: 2 })
    expect(list[2].layout).toEqual({ x: 4, y: 4, w: 3, h: 1 })
  })

  it('returns the same doc reference when nothing changes', () => {
    const refs = [ref('a', 0, 0, 2, 2)]
    const d = doc(refs)
    expect(applyLayoutMapToDoc(d, refs, new Map([['a', { x: 0, y: 0, w: 2, h: 2 }]]))).toBe(d)
  })

  it('skips refs missing from the layout map', () => {
    const refs = [ref('a', 0, 0, 2, 2), ref('b', 1, 1, 2, 2)]
    const d = doc(refs)
    expect(applyLayoutMapToDoc(d, refs, new Map())).toBe(d)
  })
})
