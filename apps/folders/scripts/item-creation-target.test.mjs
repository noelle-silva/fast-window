import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { assertItemCreationTarget, containerItemCreationTarget, desktopItemCreationTarget } from '../src/itemCreationTarget.ts'

function workspace() {
  return {
    id: 'folder',
    groups: [{ id: 'work', name: '工作' }, { id: 'archive', name: '归档' }],
    containers: [{ id: 'container-a', name: '收纳架 A', groupId: 'work', pageOrder: 0, createdAt: '', updatedAt: '', createdAtMs: 0, updatedAtMs: 0 }],
    items: [],
    desktop: { iconLayout: { rowGap: 0, columnGap: 0, iconScale: 0.75 } },
  }
}

describe('item creation target', () => {
  it('resolves desktop creation to an existing group only', () => {
    assert.deepEqual(desktopItemCreationTarget(workspace(), 'work'), { groupId: 'work' })
    assert.throws(() => desktopItemCreationTarget(workspace(), 'missing'), /group does not exist/)
  })

  it('resolves container creation to the container and its group', () => {
    const currentWorkspace = workspace()
    assert.deepEqual(containerItemCreationTarget(currentWorkspace, currentWorkspace.containers[0]), { groupId: 'work', containerId: 'container-a' })
  })

  it('rejects container creation when the container is not in the workspace', () => {
    assert.throws(() => containerItemCreationTarget(workspace(), { id: 'missing', name: '丢失', groupId: 'work', pageOrder: 0, createdAt: '', updatedAt: '', createdAtMs: 0, updatedAtMs: 0 }), /container does not exist/)
  })

  it('asserts saved item targets keep container and group consistent', () => {
    assert.doesNotThrow(() => assertItemCreationTarget(workspace(), { groupId: 'work', containerId: 'container-a' }))
    assert.throws(() => assertItemCreationTarget(workspace(), { groupId: 'archive', containerId: 'container-a' }), /group mismatch/)
  })
})
