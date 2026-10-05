import { describe, expect, it } from 'vitest'
import {
  applySortableMoveIntent,
  buildSortableMoveIntent,
  findSortableTabLocation,
  getSortableVisualRows,
  parseSortableId,
  parseSortableSlotId,
  sortableGroupId,
  sortableGroupSlotId,
  sortableTabId,
  sortableTopSlotId,
} from './openTabsSortableModel'
import type { SidebarItem } from './sidebarModel'

function tab(tabKey: string): SidebarItem {
  return { type: 'tab', tabKey }
}

function grp(id: string, tabKeys: string[], collapsed = false): SidebarItem {
  return { type: 'group', id, title: id, color: 'c', collapsed, tabKeys }
}

const ITEMS: SidebarItem[] = [tab('a'), grp('g1', ['b', 'c']), tab('d')]

describe('id builders', () => {
  it('builds tab and group ids', () => {
    expect(sortableTabId('a')).toBe('tab:a')
    expect(sortableGroupId('g')).toBe('group:g')
  })

  it('clamps slot indexes to non-negative integers', () => {
    expect(sortableTopSlotId(2)).toBe('slot:top:2')
    expect(sortableTopSlotId(-1.7)).toBe('slot:top:0')
    expect(sortableGroupSlotId(' g ', 3)).toBe('slot:group:g:3')
  })
})

describe('parseSortableId', () => {
  it.each([
    ['tab:a', { kind: 'tab', tabKey: 'a' }],
    ['tab: a ', { kind: 'tab', tabKey: 'a' }],
    ['tab:', null],
    ['group:g', { kind: 'group', groupId: 'g' }],
    ['group: g ', { kind: 'group', groupId: 'g' }],
    ['group:', null],
    ['x', null],
    ['', null],
    ['tab', null],
  ])('parses %s', (input, expected) => {
    expect(parseSortableId(input)).toEqual(expected)
  })
})

describe('parseSortableSlotId', () => {
  it.each([
    ['slot:top:2', { kind: 'top-slot', index: 2 }],
    ['slot:top:-1', null],
    ['slot:top:x', null],
    ['slot:top:', { kind: 'top-slot', index: 0 }],
    ['slot:group:g:2', { kind: 'group-slot', groupId: 'g', index: 2 }],
    ['slot:group:g:', { kind: 'group-slot', groupId: 'g', index: 0 }],
    ['slot:group::2', null],
    ['slot:group:a:b:1', { kind: 'group-slot', groupId: 'a:b', index: 1 }],
    ['x', null],
    ['slot:group:x', null],
  ])('parses %s', (input, expected) => {
    expect(parseSortableSlotId(input)).toEqual(expected)
  })
})

describe('findSortableTabLocation', () => {
  it('locates a grouped tab', () => {
    expect(findSortableTabLocation(ITEMS, 'c')).toEqual({ kind: 'group', groupId: 'g1', tabIndex: 1 })
  })

  it('locates a top-level tab', () => {
    expect(findSortableTabLocation(ITEMS, 'a')).toEqual({ kind: 'top', itemIndex: 0 })
  })

  it('returns null for a missing or blank key', () => {
    expect(findSortableTabLocation(ITEMS, 'zz')).toBeNull()
    expect(findSortableTabLocation(ITEMS, '')).toBeNull()
  })
})

describe('getSortableVisualRows', () => {
  it('lists top tabs and expanded group children in order', () => {
    expect(getSortableVisualRows(ITEMS)).toEqual([
      { id: 'tab:a', parsed: { kind: 'tab', tabKey: 'a' }, location: { kind: 'top', itemIndex: 0 } },
      { id: 'group:g1', parsed: { kind: 'group', groupId: 'g1' }, location: { kind: 'group', groupId: 'g1', itemIndex: 1 } },
      { id: 'tab:b', parsed: { kind: 'tab', tabKey: 'b' }, location: { kind: 'group', groupId: 'g1', tabIndex: 0 } },
      { id: 'tab:c', parsed: { kind: 'tab', tabKey: 'c' }, location: { kind: 'group', groupId: 'g1', tabIndex: 1 } },
      { id: 'tab:d', parsed: { kind: 'tab', tabKey: 'd' }, location: { kind: 'top', itemIndex: 2 } },
    ])
  })

  it('omits children of a collapsed group', () => {
    expect(getSortableVisualRows([grp('g1', ['b'], true)])).toEqual([
      { id: 'group:g1', parsed: { kind: 'group', groupId: 'g1' }, location: { kind: 'group', groupId: 'g1', itemIndex: 0 } },
    ])
  })
})

describe('buildSortableMoveIntent', () => {
  it.each([
    ['tab:b', 'slot:top:0', { kind: 'tab-to-top-index', tabKey: 'b', index: 0 }],
    ['tab:b', 'slot:group:g1:1', { kind: 'tab-to-group-index', tabKey: 'b', groupId: 'g1', index: 0 }],
    ['group:g1', 'slot:top:0', { kind: 'group-to-top-index', groupId: 'g1', index: 0 }],
    ['group:g1', 'slot:group:g1:0', { kind: 'none' }],
    ['tab:b', 'tab:c', { kind: 'tab-in-group-relative', groupId: 'g1', tabKey: 'b', targetTabKey: 'c', pos: 'after' }],
    ['tab:b', 'tab:a', { kind: 'top-relative', movingKey: 'b', targetKey: 'a', pos: 'before' }],
    ['tab:a', 'tab:c', { kind: 'tab-in-group-relative', groupId: 'g1', tabKey: 'a', targetTabKey: 'c', pos: 'after' }],
    ['group:g1', 'group:g1', { kind: 'none' }],
    ['tab:b', 'tab:b', { kind: 'none' }],
  ] as const)('builds intent %s => %s', (active, over, expected) => {
    expect(buildSortableMoveIntent(ITEMS, active, over)).toEqual(expected)
  })

  it('targets an expanded non-empty group as none', () => {
    expect(buildSortableMoveIntent([tab('a'), grp('g1', ['b'])], 'tab:a', 'group:g1')).toEqual({ kind: 'none' })
  })

  it('targets an empty group as tab-to-group-start', () => {
    expect(buildSortableMoveIntent([tab('a'), grp('g1', [], false)], 'tab:a', 'group:g1')).toEqual({ kind: 'tab-to-group-start', tabKey: 'a', groupId: 'g1' })
  })

  it('returns none for an unparseable active id', () => {
    expect(buildSortableMoveIntent(ITEMS, 'x', 'tab:a')).toEqual({ kind: 'none' })
  })
})

describe('applySortableMoveIntent', () => {
  it('applies tab-to-top-index by pulling a grouped tab to the top', () => {
    expect(applySortableMoveIntent(ITEMS, { kind: 'tab-to-top-index', tabKey: 'b', index: 0 })).toEqual([
      tab('b'),
      tab('a'),
      grp('g1', ['c']),
      tab('d'),
    ])
  })

  it('applies tab-to-group-index', () => {
    expect(applySortableMoveIntent(ITEMS, { kind: 'tab-to-group-index', tabKey: 'a', groupId: 'g1', index: 0 })).toEqual([
      grp('g1', ['a', 'b', 'c']),
      tab('d'),
    ])
  })

  it('applies group-to-top-index', () => {
    expect(applySortableMoveIntent(ITEMS, { kind: 'group-to-top-index', groupId: 'g1', index: 0 })).toEqual([
      grp('g1', ['b', 'c']),
      tab('a'),
      tab('d'),
    ])
  })

  it('applies top-relative', () => {
    expect(applySortableMoveIntent(ITEMS, { kind: 'top-relative', movingKey: 'a', targetKey: 'b', pos: 'after' })).toEqual(ITEMS)
  })

  it('applies tab-to-group-start', () => {
    expect(applySortableMoveIntent(ITEMS, { kind: 'tab-to-group-start', tabKey: 'a', groupId: 'g1' })).toEqual([
      grp('g1', ['a', 'b', 'c']),
      tab('d'),
    ])
  })

  it('applies tab-in-group-relative', () => {
    expect(applySortableMoveIntent(ITEMS, { kind: 'tab-in-group-relative', groupId: 'g1', tabKey: 'b', targetTabKey: 'c', pos: 'before' })).toEqual(ITEMS)
  })

  it('returns the input unchanged for none', () => {
    expect(applySortableMoveIntent(ITEMS, { kind: 'none' })).toEqual(ITEMS)
  })
})
