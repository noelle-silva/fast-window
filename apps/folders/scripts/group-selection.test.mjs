import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { resolveAdjacentCategoryId } from '../src/categorySelection.ts'
import { rememberGroupSelection, resolveAdjacentGroupId, resolveGroupSelection } from '../src/groupSelection.ts'

function workspace(groups) {
  return {
    id: 'folder',
    groups,
    items: [],
    containers: [],
    desktop: { iconLayout: { rowGap: 0, columnGap: 0, iconScale: 0.75 } },
  }
}

describe('group selection resolution', () => {
  it('keeps an existing preferred group', () => {
    assert.equal(resolveGroupSelection(workspace([{ id: 'default', name: '默认' }, { id: 'work', name: '工作' }]), 'work'), 'work')
  })

  it('uses the first existing group when the preferred group is gone', () => {
    assert.equal(resolveGroupSelection(workspace([{ id: 'archive', name: '归档' }]), 'work'), 'archive')
  })

  it('supports an empty group list explicitly', () => {
    assert.equal(resolveGroupSelection(workspace([]), 'work'), '')
  })

  it('stores selections independently per category', () => {
    const selections = rememberGroupSelection(rememberGroupSelection({}, 'folder', 'work'), 'url', 'read')
    assert.deepEqual(selections, { folder: 'work', url: 'read' })
  })

  it('resolves the next group inside the current workspace', () => {
    assert.equal(resolveAdjacentGroupId(workspace([{ id: 'default', name: '默认' }, { id: 'work', name: '工作' }, { id: 'archive', name: '归档' }]), 'work', 'next'), 'archive')
  })

  it('resolves the previous group inside the current workspace', () => {
    assert.equal(resolveAdjacentGroupId(workspace([{ id: 'default', name: '默认' }, { id: 'work', name: '工作' }, { id: 'archive', name: '归档' }]), 'work', 'previous'), 'default')
  })

  it('wraps adjacent group navigation at workspace edges', () => {
    assert.equal(resolveAdjacentGroupId(workspace([{ id: 'default', name: '默认' }, { id: 'work', name: '工作' }]), 'work', 'next'), 'default')
    assert.equal(resolveAdjacentGroupId(workspace([{ id: 'default', name: '默认' }, { id: 'work', name: '工作' }]), 'default', 'previous'), 'work')
  })

  it('stops adjacent group navigation at workspace edges when requested', () => {
    assert.equal(resolveAdjacentGroupId(workspace([{ id: 'default', name: '默认' }, { id: 'work', name: '工作' }]), 'work', 'next', 'stop'), null)
    assert.equal(resolveAdjacentGroupId(workspace([{ id: 'default', name: '默认' }, { id: 'work', name: '工作' }]), 'default', 'previous', 'stop'), null)
    assert.equal(resolveAdjacentGroupId(workspace([{ id: 'default', name: '默认' }, { id: 'work', name: '工作' }]), 'default', 'next', 'stop'), 'work')
  })

  it('does not invent an adjacent group when the current group is invalid', () => {
    assert.equal(resolveAdjacentGroupId(workspace([{ id: 'default', name: '默认' }, { id: 'work', name: '工作' }]), 'missing', 'next'), null)
  })

  it('does not navigate when there is no real adjacent group', () => {
    assert.equal(resolveAdjacentGroupId(workspace([{ id: 'default', name: '默认' }]), 'default', 'next'), null)
    assert.equal(resolveAdjacentGroupId(workspace([]), 'default', 'previous'), null)
  })

  it('resolves adjacent categories and stops at category edges when requested', () => {
    const categoryOrder = ['all', 'folder', 'url', 'file']

    assert.equal(resolveAdjacentCategoryId(categoryOrder, 'folder', 'previous'), 'all')
    assert.equal(resolveAdjacentCategoryId(categoryOrder, 'file', 'next'), 'all')
    assert.equal(resolveAdjacentCategoryId(categoryOrder, 'url', 'next', 'stop'), 'file')
    assert.equal(resolveAdjacentCategoryId(categoryOrder, 'file', 'next', 'stop'), null)
    assert.equal(resolveAdjacentCategoryId(categoryOrder, 'all', 'previous', 'stop'), null)
  })
})
