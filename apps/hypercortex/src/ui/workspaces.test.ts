import { describe, expect, it } from 'vitest'
import {
  ensureWorkspaceShape,
  normalizeActiveWorkspaceId,
  normalizeWorkspaces,
  pickNextWorkspaceTitle,
  updateWorkspaceById,
} from './workspaces'
import type { HyperCortexWorkspaceV1 } from '../core'

function ws(over: Partial<HyperCortexWorkspaceV1> = {}): HyperCortexWorkspaceV1 {
  return {
    id: 'w1',
    title: 'A',
    sidebarItems: [],
    tabGroups: [],
    openTabKeys: [],
    tabGroupByTabKey: {},
    activeTabKey: '',
    ...over,
  }
}

describe('pickNextWorkspaceTitle', () => {
  it('returns 工作区 1 when none are used', () => {
    expect(pickNextWorkspaceTitle([])).toBe('工作区 1')
  })

  it('skips titles already in use', () => {
    expect(pickNextWorkspaceTitle([{ title: '工作区 1' }, { title: '工作区 3' }])).toBe('工作区 2')
  })
})

describe('normalizeWorkspaces (array input)', () => {
  it('keeps valid unique workspaces, deriving fields from the sidebar items', () => {
    const input = [
      { id: 'w1', title: ' T ', sidebarItems: [{ type: 'tab', tabKey: 'a' }], activeTabKey: 'a' },
      { id: 'w1', title: 'dup' },
      { id: 'w2' },
    ]
    expect(normalizeWorkspaces(input).map(w => ({ id: w.id, title: w.title, open: w.openTabKeys, active: w.activeTabKey, sb: w.sidebarItems }))).toEqual([
      { id: 'w1', title: 'T', open: ['a'], active: 'a', sb: [{ type: 'tab', tabKey: 'a' }] },
      { id: 'w2', title: '工作区', open: [], active: '', sb: [] },
    ])
  })

  it('falls back to a default workspace when the array yields nothing usable', () => {
    const result = normalizeWorkspaces([])
    expect(result.length).toBe(1)
    expect(result[0].title).toBe('默认工作区')
    expect(result[0].openTabKeys).toEqual([])
  })
})

describe('normalizeWorkspaces (fallback path)', () => {
  it('builds a default workspace from the legacy fallback fields', () => {
    const result = normalizeWorkspaces(null, { openTabKeys: ['x', 'x', ''], activeTabKey: '  x  ' })
    expect(result.length).toBe(1)
    expect(result[0].title).toBe('默认工作区')
    expect(result[0].openTabKeys).toEqual(['x'])
    expect(result[0].activeTabKey).toBe('x')
  })

  it('uses 默认工作区 title when the input is not an array', () => {
    expect(normalizeWorkspaces(null)[0].title).toBe('默认工作区')
  })
})

describe('normalizeActiveWorkspaceId', () => {
  const wss = [ws({ id: 'w1', title: 'A' }), ws({ id: 'w2', title: 'B' })]

  it('keeps a valid id', () => {
    expect(normalizeActiveWorkspaceId('w2', wss)).toBe('w2')
  })

  it('falls back to the first workspace for a missing or blank id', () => {
    expect(normalizeActiveWorkspaceId('zzz', wss)).toBe('w1')
    expect(normalizeActiveWorkspaceId('', wss)).toBe('w1')
    expect(normalizeActiveWorkspaceId(42, wss)).toBe('w1')
  })

  it('returns an empty string when there are no workspaces', () => {
    expect(normalizeActiveWorkspaceId('x', [])).toBe('')
  })
})

describe('updateWorkspaceById', () => {
  const wss = [ws({ id: 'w1', title: 'A' }), ws({ id: 'w2', title: 'B' })]

  it('returns the same array when the updater returns the same workspace', () => {
    expect(updateWorkspaceById(wss, 'w1', current => current)).toBe(wss)
  })

  it('replaces the target workspace immutably', () => {
    const next = updateWorkspaceById(wss, 'w1', current => ({ ...current, title: 'X' }))
    expect(next.map(w => w.title)).toEqual(['X', 'B'])
    expect(wss[0].title).toBe('A')
  })

  it('returns the same array for a blank or missing id', () => {
    expect(updateWorkspaceById(wss, 'zzz', current => current)).toBe(wss)
    expect(updateWorkspaceById(wss, '', current => current)).toBe(wss)
  })
})

describe('ensureWorkspaceShape', () => {
  it('fills defaults and derives fields from the sidebar items', () => {
    const result = ensureWorkspaceShape(ws({ id: 'w', title: '  ', sidebarItems: [{ type: 'tab', tabKey: 'a' }] }))
    expect(result.id).toBe('w')
    expect(result.title).toBe('工作区')
    expect(result.openTabKeys).toEqual(['a'])
  })

  it('rebuilds sidebar items from legacy fields when none are present', () => {
    const result = ensureWorkspaceShape({ ...ws({ id: 'w', title: 'A' }), openTabKeys: ['x', 'y'] } as HyperCortexWorkspaceV1)
    expect(result.openTabKeys).toEqual(['x', 'y'])
    expect(result.sidebarItems).toEqual([{ type: 'tab', tabKey: 'x' }, { type: 'tab', tabKey: 'y' }])
  })
})
