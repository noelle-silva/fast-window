import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import {
  folderMatchesGroup,
  groupContainerCount,
  groupIdForPage,
  groupItemCount,
} from '../src/groupMembership.ts'

function item(id, groupId) {
  return {
    id,
    name: id,
    path: `E:/${id}`,
    groupId,
    pageOrder: 0,
    createdAt: '',
    updatedAt: '',
    createdAtMs: 1,
    updatedAtMs: 1,
  }
}

function container(id, groupId) {
  return {
    id,
    name: id,
    groupId,
    pageOrder: 0,
    createdAt: '',
    updatedAt: '',
    createdAtMs: 1,
    updatedAtMs: 1,
  }
}

function doc() {
  return {
    schemaVersion: 1,
    dataVersion: 3,
    groups: [
      { id: 'default', name: '默认' },
      { id: 'work', name: '工作' },
      { id: 'design', name: '设计' },
    ],
    items: [
      item('one', 'default'),
      item('two', 'design'),
      item('three', 'work'),
    ],
    containers: [
      container('box-a', 'work'),
      container('box-b', 'design'),
    ],
    desktop: { iconLayout: { rowGap: 38, columnGap: 38, iconScale: 1 } },
    updatedAt: '',
  }
}

describe('group page ownership', () => {
  it('uses default group when page id is empty', () => {
    assert.equal(groupIdForPage(''), 'default')
    assert.equal(groupIdForPage('work'), 'work')
  })

  it('matches folders by single page ownership', () => {
    assert.equal(folderMatchesGroup(item('one', 'work'), 'work'), true)
    assert.equal(folderMatchesGroup(item('one', 'work'), 'design'), false)
    assert.equal(folderMatchesGroup(item('one', 'default'), ''), true)
  })

  it('counts folders and containers per independent page', () => {
    const foldersDoc = doc()
    assert.equal(groupItemCount(foldersDoc, 'work'), 1)
    assert.equal(groupItemCount(foldersDoc, 'design'), 1)
    assert.equal(groupContainerCount(foldersDoc, 'work'), 1)
    assert.equal(groupContainerCount(foldersDoc, 'design'), 1)
  })
})
