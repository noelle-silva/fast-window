import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import {
  excludeGroupId,
  folderGroupLabel,
  folderMatchesGroup,
  groupIdsForFilter,
  groupItemCount,
  includeGroupId,
  sameGroupIds,
} from '../src/groupMembership.ts'

function item(id, groupIds) {
  return {
    id,
    name: id,
    path: `E:/${id}`,
    groupIds,
    createdAt: '',
    updatedAt: '',
    createdAtMs: 1,
    updatedAtMs: 1,
  }
}

function doc() {
  return {
    schemaVersion: 1,
    dataVersion: 2,
    groups: [
      { id: 'default', name: '默认' },
      { id: 'work', name: '工作' },
      { id: 'design', name: '设计' },
    ],
    items: [
      item('one', ['default', 'work']),
      item('two', ['design']),
      item('three', ['work', 'design']),
    ],
    containers: [],
    desktop: { iconLayout: { rowGap: 38, columnGap: 38, iconScale: 1 } },
    updatedAt: '',
  }
}

describe('group membership', () => {
  it('uses current filter as the default group selection for new folders', () => {
    assert.deepEqual(groupIdsForFilter('__all__'), ['default'])
    assert.deepEqual(groupIdsForFilter('work'), ['work'])
  })

  it('adds and removes group ids without duplicating memberships', () => {
    assert.deepEqual(includeGroupId(['default'], 'work'), ['default', 'work'])
    assert.deepEqual(includeGroupId(['default', 'work'], 'work'), ['default', 'work'])
    assert.deepEqual(excludeGroupId(['default', 'work'], 'default'), ['work'])
  })

  it('compares group sets without depending on order', () => {
    assert.equal(sameGroupIds(['work', 'design'], ['design', 'work']), true)
    assert.equal(sameGroupIds(['work'], ['work', 'design']), false)
  })

  it('matches folders by containing the selected group', () => {
    assert.equal(folderMatchesGroup(item('one', ['default', 'work']), 'work'), true)
    assert.equal(folderMatchesGroup(item('one', ['default', 'work']), 'design'), false)
    assert.equal(folderMatchesGroup(item('one', ['default', 'work']), '__all__'), true)
  })

  it('counts and labels folders with multiple group memberships', () => {
    const foldersDoc = doc()
    assert.equal(groupItemCount(foldersDoc, 'work'), 2)
    assert.equal(groupItemCount(foldersDoc, 'design'), 2)
    assert.equal(folderGroupLabel(foldersDoc, foldersDoc.items[0]), '默认、工作')
  })
})
