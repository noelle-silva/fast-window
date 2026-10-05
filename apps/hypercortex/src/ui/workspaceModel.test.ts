import { describe, expect, it } from 'vitest'
import {
  applyActiveWorkspacePatch,
  buildRepoStateSnapshot,
  normalizeOpenTabKeys,
  normalizeScrollTops,
} from './workspaceModel'
import type { HyperCortexWorkspaceV1 } from '../core'

function ws(over: Partial<HyperCortexWorkspaceV1> = {}): HyperCortexWorkspaceV1 {
  return {
    id: 'w',
    title: 'T',
    sidebarItems: [{ type: 'tab', tabKey: 'a' }],
    tabGroups: [],
    openTabKeys: ['a'],
    tabGroupByTabKey: {},
    activeTabKey: 'a',
    ...over,
  }
}

describe('normalizeOpenTabKeys', () => {
  it.each([null, undefined, 42, 'x', {}])('returns [] for non-array input %s', input => {
    expect(normalizeOpenTabKeys(input)).toEqual([])
  })

  it('trims, drops blanks and dedupes while preserving order', () => {
    expect(normalizeOpenTabKeys([' a ', 'a', '', 7, 'b'])).toEqual(['a', 'b'])
  })
})

describe('normalizeScrollTops', () => {
  it.each([null, undefined, 42, 'x', []])('returns {} for non-object input %s', input => {
    expect(normalizeScrollTops(input)).toEqual({})
  })

  it('keeps only positive integer pixels under trimmed keys', () => {
    expect(normalizeScrollTops({ ' a ': 10.7, b: 0, c: -3, d: 'x', '': 5, e: 4 })).toEqual({ a: 10, e: 4 })
  })
})

describe('applyActiveWorkspacePatch', () => {
  it('keeps the current title for a blank or non-string patch', () => {
    expect(applyActiveWorkspacePatch(ws(), { title: '  ' }).title).toBe('T')
    expect(applyActiveWorkspacePatch(ws(), { title: 7 as unknown as string }).title).toBe('T')
  })

  it('trims a new title', () => {
    expect(applyActiveWorkspacePatch(ws(), { title: ' New ' }).title).toBe('New')
  })

  it('always returns a new object even when the patch changes nothing (current quirk)', () => {
    const base = ws()
    const result = applyActiveWorkspacePatch(base, { activeTabKey: 'a' })
    expect(result).not.toBe(base)
    expect(result).toEqual(base)
  })

  it('derives open tab keys from a sidebar-items patch', () => {
    const result = applyActiveWorkspacePatch(ws(), { sidebarItems: [{ type: 'group', id: 'g', title: 'g', color: 'c', tabKeys: ['x'] }] })
    expect(result.openTabKeys).toEqual(['x'])
    expect(result.tabGroupByTabKey).toEqual({ x: 'g' })
  })

  it('normalizes an openTabKeys patch', () => {
    expect(applyActiveWorkspacePatch(ws(), { openTabKeys: ['z', 'z'] }).openTabKeys).toEqual(['z'])
  })

  it('trims an activeTabKey patch', () => {
    expect(applyActiveWorkspacePatch(ws(), { activeTabKey: ' z ' }).activeTabKey).toBe('z')
  })

  it('falls back to derived tab groups when the patch is not an array', () => {
    expect(applyActiveWorkspacePatch(ws(), { tabGroups: 'bad' as unknown as HyperCortexWorkspaceV1['tabGroups'] }).tabGroups).toEqual([])
  })
})

describe('buildRepoStateSnapshot', () => {
  it('projects the active workspace fields onto the snapshot', () => {
    const result = buildRepoStateSnapshot([ws({ id: 'w1', title: 'A' })], 'w1')
    expect(result).toEqual({
      workspaces: [ws({ id: 'w1', title: 'A' })],
      activeWorkspaceId: 'w1',
      sidebarItems: [{ type: 'tab', tabKey: 'a' }],
      openTabKeys: ['a'],
      activeTabKey: 'a',
      tabGroups: [],
      tabGroupByTabKey: {},
    })
  })

  it('keeps the requested id even when it does not match any workspace', () => {
    expect(buildRepoStateSnapshot([ws({ id: 'w1' })], 'zzz').activeWorkspaceId).toBe('zzz')
  })

  it('falls back to the first workspace when the id is empty', () => {
    expect(buildRepoStateSnapshot([ws({ id: 'w1' })], '').activeWorkspaceId).toBe('w1')
  })

  it('returns just the workspaces and id when there are none', () => {
    expect(buildRepoStateSnapshot([], 'x')).toEqual({ workspaces: [], activeWorkspaceId: 'x' })
  })
})
