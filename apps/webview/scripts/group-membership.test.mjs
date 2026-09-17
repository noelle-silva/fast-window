import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import {
  groupContainerCount,
  groupIdForPage,
  groupItemCount,
  itemMatchesGroup,
} from '../src/collections/groupMembership.ts'

function item(id, groupId) {
  return {
    id,
    name: id,
    target: { kind: 'url', url: `https://${id}.example` },
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
    desktop: { iconLayout: { rowGap: 0, columnGap: 0, iconScale: 0.75 } },
  }
}

describe('group page ownership', () => {
  it('normalizes page id without implicit default ownership', () => {
    assert.equal(groupIdForPage(''), '')
    assert.equal(groupIdForPage('work'), 'work')
  })

  it('matches items by explicit single page ownership', () => {
    assert.equal(itemMatchesGroup(item('one', 'work'), 'work'), true)
    assert.equal(itemMatchesGroup(item('one', 'work'), 'design'), false)
    assert.equal(itemMatchesGroup(item('one', 'default'), ''), false)
  })

  it('counts items and containers per independent page', () => {
    const workspaceDoc = doc()
    assert.equal(groupItemCount(workspaceDoc, 'work'), 1)
    assert.equal(groupItemCount(workspaceDoc, 'design'), 1)
    assert.equal(groupContainerCount(workspaceDoc, 'work'), 1)
    assert.equal(groupContainerCount(workspaceDoc, 'design'), 1)
  })
})
