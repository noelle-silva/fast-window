import { describe, expect, it } from 'vitest'
import {
  TAB_GROUP_PRESET_COLORS,
  normalizeTabGroupByTabKey,
  normalizeTabGroups,
  pickNextTabGroupColor,
  pickNextTabGroupTitle,
} from './tabGroups'
import type { HyperCortexTabGroupV1 } from '../core'

function group(over: Partial<HyperCortexTabGroupV1> = {}): HyperCortexTabGroupV1 {
  return { id: 'g1', title: 'G', color: 'c', ...over }
}

describe('pickNextTabGroupColor', () => {
  it('returns the first preset when none are used', () => {
    expect(pickNextTabGroupColor([])).toBe('hsl(0, 28%, 88%)')
  })

  it('skips already-used colors', () => {
    expect(pickNextTabGroupColor([group({ color: TAB_GROUP_PRESET_COLORS[0] })])).toBe('hsl(18, 28%, 88%)')
  })

  it('wraps to the first preset when every preset is used', () => {
    const all = TAB_GROUP_PRESET_COLORS.map((color, i) => group({ id: `g${i}`, color }))
    expect(pickNextTabGroupColor(all)).toBe('hsl(0, 28%, 88%)')
  })
})

describe('pickNextTabGroupTitle', () => {
  it('returns 分组 1 for no groups', () => {
    expect(pickNextTabGroupTitle([])).toBe('分组 1')
  })

  it('skips titles already in use', () => {
    expect(pickNextTabGroupTitle([group({ title: '分组 1' }), group({ id: 'g2', title: '分组 3' })])).toBe('分组 2')
  })
})

describe('normalizeTabGroups', () => {
  it.each([null, undefined, 42, 'x', {}])('returns [] for non-array input %s', input => {
    expect(normalizeTabGroups(input)).toEqual([])
  })

  it('skips non-object entries and empty/duplicate ids', () => {
    expect(normalizeTabGroups([null, 1, { id: ' a ', title: ' T ', color: ' C ', collapsed: true }, { id: 'a' }, { id: '' }, { id: 'b' }])).toEqual([
      { id: 'a', title: 'T', color: 'C', collapsed: true },
      { id: 'b', title: '分组', color: 'hsl(210, 28%, 88%)', collapsed: false },
    ])
  })

  it('applies defaults and treats collapsed strictly as true', () => {
    expect(normalizeTabGroups([{ id: 'a', collapsed: 'true' }, { id: 'b', title: 5, color: 7 }])).toEqual([
      { id: 'a', title: '分组', color: 'hsl(210, 28%, 88%)', collapsed: false },
      { id: 'b', title: '分组', color: 'hsl(210, 28%, 88%)', collapsed: false },
    ])
  })
})

describe('normalizeTabGroupByTabKey', () => {
  it.each([null, undefined, 42, 'x', []])('returns {} for non-object input %s', input => {
    expect(normalizeTabGroupByTabKey(input)).toEqual({})
  })

  it('trims keys and values and drops blanks and non-strings', () => {
    expect(normalizeTabGroupByTabKey({ ' k ': ' g ', '': 'x', z: '', n: 7 })).toEqual({ k: 'g' })
  })
})
