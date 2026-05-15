import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { rememberGroupSelection, resolveGroupSelection } from '../src/groupSelection.ts'

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
})
