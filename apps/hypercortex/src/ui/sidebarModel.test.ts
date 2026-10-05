import { describe, expect, it } from 'vitest'
import {
  applySidebarItemsToWorkspace,
  buildSidebarItemsFromLegacy,
  closeTabsInSidebar,
  createGroupInSidebar,
  deleteGroupFromSidebar,
  deriveSidebarFields,
  ensureSidebarItems,
  insertTabAsUngrouped,
  moveGroupBlock,
  moveGroupToIndex,
  moveTabBetweenGroups,
  moveTabInGroupRelative,
  moveTabToGroupIndex,
  moveTopLevelItemRelative,
  normalizeSidebarItems,
  updateSidebarGroup,
} from './sidebarModel'
import type { SidebarGroupItem, SidebarItem } from './sidebarModel'
import type { HyperCortexTabGroupV1, HyperCortexWorkspaceV1 } from '../core'

const DEFAULT_TITLE = '分组'
const DEFAULT_COLOR = 'hsl(210, 28%, 88%)'

function tab(tabKey: string): SidebarItem {
  return { type: 'tab', tabKey }
}

function group(id: string, tabKeys: string[] = [], extra: Partial<Pick<SidebarGroupItem, 'title' | 'color' | 'collapsed'>> = {}): SidebarGroupItem {
  return {
    type: 'group',
    id,
    title: extra.title ?? 'G',
    color: extra.color ?? 'c',
    collapsed: extra.collapsed,
    tabKeys,
  }
}

function workspace(overrides: Partial<HyperCortexWorkspaceV1> = {}): HyperCortexWorkspaceV1 {
  return {
    id: 'w1',
    title: 'WS',
    sidebarItems: [],
    tabGroups: [],
    openTabKeys: [],
    tabGroupByTabKey: {},
    activeTabKey: '',
    ...overrides,
  }
}

describe('normalizeSidebarItems', () => {
  it.each([null, undefined, 42, 'x', {}, true])('returns [] for non-array input %s', input => {
    expect(normalizeSidebarItems(input)).toEqual([])
  })

  it('skips non-object entries', () => {
    expect(normalizeSidebarItems([null, 1, 'x', [], true])).toEqual([])
  })

  it('trims tab keys and drops empty ones', () => {
    expect(normalizeSidebarItems([{ type: 'tab', tabKey: ' a ' }, { type: 'tab', tabKey: '   ' }])).toEqual([tab('a')])
  })

  it('deduplicates top-level tabs', () => {
    expect(normalizeSidebarItems([{ type: 'tab', tabKey: 'a' }, { type: 'tab', tabKey: 'a' }])).toEqual([tab('a')])
  })

  it('fills group defaults', () => {
    expect(normalizeSidebarItems([{ type: 'group', id: 'g1' }])).toEqual([
      { type: 'group', id: 'g1', title: DEFAULT_TITLE, color: DEFAULT_COLOR, collapsed: false, tabKeys: [] },
    ])
  })

  it('normalizes group fields and drops blank keys', () => {
    const result = normalizeSidebarItems([
      { type: 'group', id: ' g1 ', title: ' T ', color: ' C ', collapsed: true, tabKeys: [' a ', 7, '', 'b'] },
    ])
    expect(result).toEqual([
      { type: 'group', id: 'g1', title: 'T', color: 'C', collapsed: true, tabKeys: ['a', 'b'] },
    ])
  })

  it('treats collapsed strictly as true', () => {
    const result = normalizeSidebarItems([{ type: 'group', id: 'g1', collapsed: 'true' }])
    expect((result[0] as SidebarGroupItem).collapsed).toBe(false)
  })

  it('drops groups with empty or duplicate ids', () => {
    const result = normalizeSidebarItems([
      { type: 'group', id: '  ' },
      { type: 'group', id: 'g1' },
      { type: 'group', id: 'g1' },
    ])
    expect(result).toEqual([
      { type: 'group', id: 'g1', title: DEFAULT_TITLE, color: DEFAULT_COLOR, collapsed: false, tabKeys: [] },
    ])
  })

  it('shares the seen-tab set across top-level tabs and group tabs', () => {
    const result = normalizeSidebarItems([
      { type: 'tab', tabKey: 'a' },
      { type: 'group', id: 'g1', tabKeys: ['a', 'b'] },
    ])
    expect(result).toEqual([tab('a'), group('g1', ['b'], { title: DEFAULT_TITLE, color: DEFAULT_COLOR, collapsed: false })])
  })

  it('ignores unknown item types', () => {
    expect(normalizeSidebarItems([{ type: 'wat', tabKey: 'a' }])).toEqual([])
  })
})

describe('deriveSidebarFields', () => {
  it('returns empty fields for no items', () => {
    expect(deriveSidebarFields([])).toEqual({ openTabKeys: [], tabGroups: [], tabGroupByTabKey: {} })
  })

  it('flattens top tabs and group tabs in order', () => {
    const items: SidebarItem[] = [tab('a'), group('g1', ['b', 'c'], { title: 'G1', color: 'cc', collapsed: true }), tab('d')]
    expect(deriveSidebarFields(items)).toEqual({
      openTabKeys: ['a', 'b', 'c', 'd'],
      tabGroups: [{ id: 'g1', title: 'G1', color: 'cc', collapsed: true }],
      tabGroupByTabKey: { b: 'g1', c: 'g1' },
    })
  })
})

describe('buildSidebarItemsFromLegacy', () => {
  it('places ungrouped tabs first, then groups', () => {
    const items = buildSidebarItemsFromLegacy({
      openTabKeys: ['a', 'b'],
      tabGroups: [{ id: 'g1', title: 'G', color: 'c' }],
      tabGroupByTabKey: { b: 'g1' },
    })
    expect(items).toEqual([tab('a'), group('g1', ['b'], { title: 'G', color: 'c', collapsed: false })])
  })

  it('emits groups even when they hold no tabs', () => {
    const items = buildSidebarItemsFromLegacy({
      openTabKeys: [],
      tabGroups: [{ id: 'g1', title: 'G', color: 'c' }],
      tabGroupByTabKey: {},
    })
    expect(items).toEqual([group('g1', [], { title: 'G', color: 'c', collapsed: false })])
  })

  it('falls back to ungrouped when the mapped group is missing', () => {
    const items = buildSidebarItemsFromLegacy({
      openTabKeys: ['a'],
      tabGroups: [],
      tabGroupByTabKey: { a: 'ghost' },
    })
    expect(items).toEqual([tab('a')])
  })

  it('keeps the first group on duplicate ids but still emits both group blocks', () => {
    const items = buildSidebarItemsFromLegacy({
      openTabKeys: ['t'],
      tabGroups: [
        { id: 'g', title: 'A', color: 'ca' },
        { id: 'g', title: 'B', color: 'cb' },
      ],
      tabGroupByTabKey: { t: 'g' },
    })
    expect(items).toEqual([
      group('g', ['t'], { title: 'A', color: 'ca', collapsed: false }),
      group('g', ['t'], { title: 'B', color: 'cb', collapsed: false }),
    ])
  })

  it('tolerates non-array tab keys and undefined map', () => {
    const items = buildSidebarItemsFromLegacy({
      openTabKeys: null as unknown as string[],
      tabGroups: [{ id: 'g1', title: 'G', color: 'c' }],
      tabGroupByTabKey: undefined as unknown as Record<string, string>,
    })
    expect(items).toEqual([group('g1', [], { title: 'G', color: 'c', collapsed: false })])
  })

  it('applies title and color defaults', () => {
    const items = buildSidebarItemsFromLegacy({
      openTabKeys: [],
      tabGroups: [{ id: 'g1', title: '  ', color: '' } as HyperCortexTabGroupV1],
      tabGroupByTabKey: {},
    })
    expect(items).toEqual([group('g1', [], { title: DEFAULT_TITLE, color: DEFAULT_COLOR, collapsed: false })])
  })
})

describe('ensureSidebarItems', () => {
  it('prefers explicit sidebar items when present', () => {
    const items = ensureSidebarItems({
      sidebarItems: [tab('a')],
      openTabKeys: ['legacy'],
      tabGroups: [],
      tabGroupByTabKey: {},
    } as unknown as HyperCortexWorkspaceV1)
    expect(items).toEqual([tab('a')])
  })

  it('rebuilds from legacy fields when sidebar items are empty', () => {
    const items = ensureSidebarItems({
      sidebarItems: [],
      openTabKeys: ['a'],
      tabGroups: [{ id: 'g1', title: 'G', color: 'c' }],
      tabGroupByTabKey: { a: 'g1' },
    } as unknown as HyperCortexWorkspaceV1)
    expect(items).toEqual([group('g1', ['a'], { title: 'G', color: 'c', collapsed: false })])
  })

  it('rebuilds when sidebar items normalize away to nothing', () => {
    const items = ensureSidebarItems({
      sidebarItems: [{ type: 'wat' }],
      openTabKeys: ['a'],
      tabGroups: [],
      tabGroupByTabKey: {},
    } as unknown as HyperCortexWorkspaceV1)
    expect(items).toEqual([tab('a')])
  })
})

describe('applySidebarItemsToWorkspace', () => {
  it('writes normalized items and derived fields, keeping other workspace fields', () => {
    const base = workspace({ id: 'keep', title: 'Kept', activeTabKey: 'a' })
    const result = applySidebarItemsToWorkspace(base, [tab('a'), group('g1', ['b'], { title: 'G', color: 'c' })])
    expect(result).toEqual({
      id: 'keep',
      title: 'Kept',
      activeTabKey: 'a',
      sidebarItems: [tab('a'), group('g1', ['b'], { title: 'G', color: 'c', collapsed: false })],
      openTabKeys: ['a', 'b'],
      tabGroups: [{ id: 'g1', title: 'G', color: 'c', collapsed: false }],
      tabGroupByTabKey: { b: 'g1' },
    })
  })

  it('does not mutate the input workspace', () => {
    const base = workspace({ openTabKeys: ['old'] })
    applySidebarItemsToWorkspace(base, [tab('a')])
    expect(base.openTabKeys).toEqual(['old'])
    expect(base.sidebarItems).toEqual([])
  })
})

describe('insertTabAsUngrouped', () => {
  it('leaves the list unchanged for an empty key', () => {
    const input = [tab('a')]
    expect(insertTabAsUngrouped(input, '  ', 0)).toEqual(input)
  })

  it('inserts at the requested index', () => {
    expect(insertTabAsUngrouped([tab('a'), tab('c')], 'b', 1)).toEqual([tab('a'), tab('b'), tab('c')])
  })

  it('clamps negative and overflowing indexes', () => {
    expect(insertTabAsUngrouped([tab('a')], 'b', -5)).toEqual([tab('b'), tab('a')])
    expect(insertTabAsUngrouped([tab('a')], 'b', 99)).toEqual([tab('a'), tab('b')])
  })

  it('removes an existing top-level duplicate before inserting', () => {
    expect(insertTabAsUngrouped([tab('a'), tab('b')], 'a', 1)).toEqual([tab('b'), tab('a')])
  })

  it('pulls a tab out of its group and back to the top level', () => {
    expect(insertTabAsUngrouped([group('g1', ['x', 'y'])], 'x', 0)).toEqual([tab('x'), group('g1', ['y'])])
  })

  it('inserts into an empty list', () => {
    expect(insertTabAsUngrouped([], 'a', 0)).toEqual([tab('a')])
  })
})

describe('moveTabBetweenGroups', () => {
  it('returns a clone when required arguments are blank', () => {
    const input = [tab('a'), group('g1', [])]
    expect(moveTabBetweenGroups({ sidebarItems: input, tabKey: '', targetGroupId: 'g1' })).toEqual(input)
    expect(moveTabBetweenGroups({ sidebarItems: input, tabKey: 'a', targetGroupId: '  ' })).toEqual(input)
  })

  it('appends to the target group when no anchor is given', () => {
    const result = moveTabBetweenGroups({ sidebarItems: [tab('a'), group('g1', ['x'])], tabKey: 'a', targetGroupId: 'g1' })
    expect(result).toEqual([group('g1', ['x', 'a'])])
  })

  it('inserts before or after the anchor tab', () => {
    const before = moveTabBetweenGroups({ sidebarItems: [group('g1', ['x', 'y']), tab('a')], tabKey: 'a', targetGroupId: 'g1', targetTabKey: 'y', pos: 'before' })
    expect(before).toEqual([group('g1', ['x', 'a', 'y'])])
    const after = moveTabBetweenGroups({ sidebarItems: [group('g1', ['x', 'y']), tab('a')], tabKey: 'a', targetGroupId: 'g1', targetTabKey: 'x', pos: 'after' })
    expect(after).toEqual([group('g1', ['x', 'a', 'y'])])
  })

  it('appends when the anchor tab is absent', () => {
    const result = moveTabBetweenGroups({ sidebarItems: [group('g1', ['x']), tab('a')], tabKey: 'a', targetGroupId: 'g1', targetTabKey: 'ghost' })
    expect(result).toEqual([group('g1', ['x', 'a'])])
  })

  it('drops the tab when the target group is missing', () => {
    const result = moveTabBetweenGroups({ sidebarItems: [tab('a'), group('g1', ['x'])], tabKey: 'a', targetGroupId: 'ghost' })
    expect(result).toEqual([group('g1', ['x'])])
  })
})

describe('moveGroupBlock', () => {
  it('returns a clone for blank or identical ids', () => {
    const input = [group('g1', []), group('g2', [])]
    expect(moveGroupBlock(input, '', 'g2', 'before')).toEqual(input)
    expect(moveGroupBlock(input, 'g1', 'g1', 'before')).toEqual(input)
  })

  it('moves a group before and after another', () => {
    const input = [group('g1', []), group('g2', []), group('g3', [])]
    expect(moveGroupBlock(input, 'g1', 'g2', 'after')).toEqual([group('g2', []), group('g1', []), group('g3', [])])
    expect(moveGroupBlock(input, 'g3', 'g1', 'before')).toEqual([group('g3', []), group('g1', []), group('g2', [])])
  })

  it('returns a clone when a group is missing', () => {
    const input = [group('g1', [])]
    expect(moveGroupBlock(input, 'g1', 'ghost', 'before')).toEqual(input)
    expect(moveGroupBlock(input, 'ghost', 'g1', 'before')).toEqual(input)
  })
})

describe('moveTopLevelItemRelative', () => {
  it('returns a clone for blank or identical keys', () => {
    const input = [tab('a'), tab('b')]
    expect(moveTopLevelItemRelative(input, '', 'b', 'before')).toEqual(input)
    expect(moveTopLevelItemRelative(input, 'a', 'a', 'before')).toEqual(input)
  })

  it('reorders top-level tabs', () => {
    expect(moveTopLevelItemRelative([tab('a'), tab('b'), tab('c')], 'c', 'a', 'before')).toEqual([tab('c'), tab('a'), tab('b')])
    expect(moveTopLevelItemRelative([tab('a'), tab('b'), tab('c')], 'a', 'c', 'after')).toEqual([tab('b'), tab('c'), tab('a')])
  })

  it('promotes a grouped tab relative to a top-level tab', () => {
    const result = moveTopLevelItemRelative([group('g1', ['x']), tab('a')], 'x', 'a', 'before')
    expect(result).toEqual([group('g1', []), tab('x'), tab('a')])
  })

  it('returns a clone when the target is missing', () => {
    const input = [tab('a')]
    expect(moveTopLevelItemRelative(input, 'a', 'ghost', 'before')).toEqual(input)
  })

  it('returns a clone when the moving key is neither top-level nor grouped', () => {
    const input = [tab('a')]
    expect(moveTopLevelItemRelative(input, 'ghost', 'a', 'before')).toEqual(input)
  })
})

describe('moveTabInGroupRelative', () => {
  it('returns a clone for blank or identical keys', () => {
    const input = [group('g1', ['a', 'b'])]
    expect(moveTabInGroupRelative(input, '', 'a', 'b', 'before')).toEqual(input)
    expect(moveTabInGroupRelative(input, 'g1', 'a', 'a', 'before')).toEqual(input)
  })

  it('reorders tabs inside a group', () => {
    const result = moveTabInGroupRelative([group('g1', ['a', 'b', 'c'])], 'g1', 'c', 'a', 'before')
    expect(result).toEqual([group('g1', ['c', 'a', 'b'])])
  })

  it('drops the moving tab when the group is missing', () => {
    const result = moveTabInGroupRelative([group('g1', ['a', 'b'])], 'ghost', 'a', 'b', 'before')
    expect(result).toEqual([group('g1', ['b'])])
  })

  it('drops the moving tab when the anchor is missing', () => {
    const result = moveTabInGroupRelative([group('g1', ['a', 'b'])], 'g1', 'a', 'ghost', 'before')
    expect(result).toEqual([group('g1', ['b'])])
  })
})

describe('moveGroupToIndex', () => {
  it('returns a clone for a blank id', () => {
    const input = [group('g1', [])]
    expect(moveGroupToIndex(input, '', 0)).toEqual(input)
  })

  it('moves a group to a clamped index', () => {
    const input = [group('g1', []), group('g2', []), group('g3', [])]
    expect(moveGroupToIndex(input, 'g3', 0)).toEqual([group('g3', []), group('g1', []), group('g2', [])])
    expect(moveGroupToIndex(input, 'g1', 99)).toEqual([group('g2', []), group('g3', []), group('g1', [])])
  })

  it('returns a clone when the group is missing', () => {
    const input = [group('g1', [])]
    expect(moveGroupToIndex(input, 'ghost', 0)).toEqual(input)
  })
})

describe('moveTabToGroupIndex', () => {
  it('returns a clone for blank ids', () => {
    const input = [tab('a')]
    expect(moveTabToGroupIndex(input, '', 'g1', 0)).toEqual(input)
    expect(moveTabToGroupIndex(input, 'a', '', 0)).toEqual(input)
  })

  it('moves a top-level tab into a group at a clamped index', () => {
    const input = [tab('a'), group('g1', ['x', 'y'])]
    expect(moveTabToGroupIndex(input, 'a', 'g1', 1)).toEqual([group('g1', ['x', 'a', 'y'])])
    expect(moveTabToGroupIndex(input, 'a', 'g1', 99)).toEqual([group('g1', ['x', 'y', 'a'])])
    expect(moveTabToGroupIndex(input, 'a', 'g1', -3)).toEqual([group('g1', ['a', 'x', 'y'])])
  })

  it('drops the tab when the target group is missing', () => {
    const result = moveTabToGroupIndex([tab('a'), group('g1', ['x'])], 'a', 'ghost', 0)
    expect(result).toEqual([group('g1', ['x'])])
  })
})

describe('createGroupInSidebar', () => {
  it('returns a clone for a blank id', () => {
    const input = [tab('a')]
    expect(createGroupInSidebar(input, { id: '  ', title: 'G', color: 'c' })).toEqual(input)
  })

  it('appends a group with defaults and empty tabs', () => {
    const result = createGroupInSidebar([tab('a')], { id: 'g1', title: '', color: '', collapsed: true })
    expect(result).toEqual([tab('a'), { type: 'group', id: 'g1', title: DEFAULT_TITLE, color: DEFAULT_COLOR, collapsed: true, tabKeys: [] }])
  })
})

describe('updateSidebarGroup', () => {
  it('leaves non-matching groups untouched', () => {
    const input = [group('g1', ['a'], { title: 'G', color: 'c' })]
    expect(updateSidebarGroup(input, 'ghost', { title: 'X' })).toEqual(input)
  })

  it('applies string and boolean patches only', () => {
    const input = [group('g1', ['a'], { title: 'G', color: 'c', collapsed: false })]
    const result = updateSidebarGroup(input, 'g1', { title: 'T', color: 'C', collapsed: true })
    expect(result).toEqual([group('g1', ['a'], { title: 'T', color: 'C', collapsed: true })])
  })

  it('ignores patches of the wrong type', () => {
    const input = [group('g1', ['a'], { title: 'G', color: 'c', collapsed: false })]
    const result = updateSidebarGroup(input, 'g1', { title: 7 as unknown as string, color: 7 as unknown as string, collapsed: 'yes' as unknown as boolean })
    expect(result).toEqual(input)
  })

  it('does not mutate the input', () => {
    const input = [group('g1', ['a'], { title: 'G', color: 'c' })]
    updateSidebarGroup(input, 'g1', { title: 'T' })
    expect((input[0] as SidebarGroupItem).title).toBe('G')
  })
})

describe('deleteGroupFromSidebar', () => {
  it('returns a clone for a blank or missing id', () => {
    const input = [group('g1', [])]
    expect(deleteGroupFromSidebar(input, '')).toEqual(input)
    expect(deleteGroupFromSidebar(input, 'ghost')).toEqual(input)
  })

  it('promotes the group tabs to top level at the group position', () => {
    const result = deleteGroupFromSidebar([tab('a'), group('g', ['x', 'y']), tab('b')], 'g')
    expect(result).toEqual([tab('a'), tab('x'), tab('y'), tab('b')])
  })
})

describe('closeTabsInSidebar', () => {
  it('returns a clone when nothing is being closed', () => {
    const input = [tab('a'), group('g1', ['b'])]
    expect(closeTabsInSidebar(input, [])).toEqual(input)
    expect(closeTabsInSidebar(input, null as unknown as string[])).toEqual(input)
    expect(closeTabsInSidebar(input, ['  '])).toEqual(input)
  })

  it('removes closed top-level tabs and filters group tabs', () => {
    const result = closeTabsInSidebar([tab('a'), group('g1', ['b', 'c'])], [' a ', 'b'])
    expect(result).toEqual([group('g1', ['c'])])
  })

  it('keeps groups that end up empty', () => {
    const result = closeTabsInSidebar([group('g1', ['b'])], ['b'])
    expect(result).toEqual([group('g1', [])])
  })
})
