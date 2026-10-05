import { describe, expect, it } from 'vitest'
import {
  moveListItem,
  normalizeDefaultFaceKinds,
  normalizeFaceKindOrder,
  orderKindsByGlobalOrder,
  resolveNoteFaceOrder,
} from './facePreferences'
import type { HyperCortexNoteFaceManifestV2 } from './noteFaces'

/**
 * 行为锁定测试（084 · 拆分期护栏）：
 * 锁定面类型顺序规范化、列表搬移与笔记面顺序解析的纯逻辑行为。
 */

function faceMap(map: Record<string, { kind: string }>): Record<string, HyperCortexNoteFaceManifestV2> {
  return map as unknown as Record<string, HyperCortexNoteFaceManifestV2>
}

describe('normalizeFaceKindOrder', () => {
  it('puts valid input kinds first, then appends the remaining known kinds', () => {
    expect(normalizeFaceKindOrder(['b', 'a'], ['a', 'b', 'c'])).toEqual(['b', 'a', 'c'])
  })

  it('drops unknown kinds and duplicate entries', () => {
    expect(normalizeFaceKindOrder(['z', 'a', 'a'], ['a', 'b'])).toEqual(['a', 'b'])
  })

  it('trims entries before matching', () => {
    expect(normalizeFaceKindOrder([' a '], ['a'])).toEqual(['a'])
  })

  it('coerces non-string entries to strings', () => {
    expect(normalizeFaceKindOrder([1], ['1'])).toEqual(['1'])
  })

  it('falls back to the known kinds when the value is not an array', () => {
    expect(normalizeFaceKindOrder(null, ['a', 'b'])).toEqual(['a', 'b'])
    expect(normalizeFaceKindOrder('a', ['a', 'b'])).toEqual(['a', 'b'])
    expect(normalizeFaceKindOrder(undefined, ['a', 'b'])).toEqual(['a', 'b'])
  })

  it('dedupes the known kind list and handles an empty known list', () => {
    expect(normalizeFaceKindOrder([], ['a', 'a', 'b'])).toEqual(['a', 'b'])
    expect(normalizeFaceKindOrder(['a'], [])).toEqual([])
  })
})

describe('normalizeDefaultFaceKinds', () => {
  it('keeps creatable kinds in input order and dedupes', () => {
    expect(normalizeDefaultFaceKinds(['b', 'a', 'b'], ['a', 'b', 'c'])).toEqual(['b', 'a'])
  })

  it('drops unknown kinds and trims entries', () => {
    expect(normalizeDefaultFaceKinds([' z ', 'a'], ['a'])).toEqual(['a'])
  })

  it('returns an empty list for a non-array or empty creatable set', () => {
    expect(normalizeDefaultFaceKinds(null, ['a'])).toEqual([])
    expect(normalizeDefaultFaceKinds(['a'], [])).toEqual([])
  })
})

describe('moveListItem', () => {
  it('moves an item forward and backward', () => {
    expect(moveListItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(moveListItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
  })

  it('returns a fresh copy for a zero delta', () => {
    const list = ['a', 'b', 'c']
    const moved = moveListItem(list, 1, 0)
    expect(moved).toEqual(['a', 'b', 'c'])
    expect(moved).not.toBe(list)
  })

  it('returns a fresh copy when the move would leave the list', () => {
    const list = ['a', 'b', 'c']
    expect(moveListItem(list, -1, 1)).toEqual(['a', 'b', 'c'])
    expect(moveListItem(list, 0, -1)).toEqual(['a', 'b', 'c'])
    expect(moveListItem(list, 2, 1)).toEqual(['a', 'b', 'c'])
    expect(moveListItem(list, 0, 5)).toEqual(['a', 'b', 'c'])
    expect(moveListItem(list, 0, 1)).not.toBe(list)
  })

  it('returns an empty list for an empty input', () => {
    expect(moveListItem([], 0, 0)).toEqual([])
  })

  it('inserts undefined when the index is out of range but the target is valid', () => {
    expect(moveListItem(['a', 'b'], 2, -1)).toEqual(['a', undefined, 'b'])
  })
})

describe('orderKindsByGlobalOrder', () => {
  it('reorders known kinds by the global order', () => {
    expect(orderKindsByGlobalOrder(['c', 'a', 'b'], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('keeps uncovered kinds in their original relative order after the global ones', () => {
    expect(orderKindsByGlobalOrder(['c', 'a', 'b'], ['b'])).toEqual(['b', 'c', 'a'])
    expect(orderKindsByGlobalOrder(['x', 'a', 'y'], ['a'])).toEqual(['a', 'x', 'y'])
  })

  it('ignores global kinds absent from the list and dedupes the list', () => {
    expect(orderKindsByGlobalOrder(['a', 'a', 'b'], ['z', 'b'])).toEqual(['b', 'a'])
  })

  it('returns the deduped list for an empty global order and empty list', () => {
    expect(orderKindsByGlobalOrder(['b', 'a', 'b'], [])).toEqual(['b', 'a'])
    expect(orderKindsByGlobalOrder([], ['a'])).toEqual([])
  })
})

describe('resolveNoteFaceOrder', () => {
  const faces = faceMap({ f1: { kind: 'a' }, f2: { kind: 'b' }, f3: { kind: 'a' }, f4: { kind: 'c' } })

  it('puts explicit face order first, then global kind order, then the rest', () => {
    expect(resolveNoteFaceOrder({ faceOrder: ['f4'], faces, globalKindOrder: ['a', 'b', 'c'] })).toEqual([
      'f4',
      'f1',
      'f3',
      'f2',
    ])
  })

  it('orders by global kind order when no explicit order is given', () => {
    expect(resolveNoteFaceOrder({ faces, globalKindOrder: ['a', 'b', 'c'] })).toEqual(['f1', 'f3', 'f2', 'f4'])
  })

  it('appends unknown-kind faces in key order', () => {
    expect(resolveNoteFaceOrder({ faces: faceMap({ f1: { kind: 'a' }, f5: { kind: 'z' } }), globalKindOrder: ['a'] })).toEqual([
      'f1',
      'f5',
    ])
  })

  it('skips explicit ids that do not exist and ignores a non-array order', () => {
    expect(resolveNoteFaceOrder({ faceOrder: ['ghost', 'f2'], faces, globalKindOrder: ['a'] })).toEqual(['f2', 'f1', 'f3', 'f4'])
    expect(resolveNoteFaceOrder({ faceOrder: 'f2', faces, globalKindOrder: ['a'] })).toEqual(['f1', 'f3', 'f2', 'f4'])
  })

  it('dedupes explicit and derived ids', () => {
    expect(resolveNoteFaceOrder({ faceOrder: ['f1', 'f1'], faces, globalKindOrder: ['a'] })).toEqual(['f1', 'f3', 'f2', 'f4'])
  })

  it('returns an empty list for missing faces', () => {
    expect(resolveNoteFaceOrder({})).toEqual([])
    expect(resolveNoteFaceOrder({ faces: null })).toEqual([])
  })
})
