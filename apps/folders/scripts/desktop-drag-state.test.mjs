import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { isContainerDropTargetActive, resolveDesktopDragMode, resolveDesktopDropIntent } from '../src/desktopDragState.ts'

function containerEntry(id) {
  return {
    kind: 'container',
    id,
    name: id,
    container: container(id),
  }
}

function folderEntry(id) {
  return {
    kind: 'folder',
    id,
    name: id,
    item: folderItem(id),
  }
}

function container(id) {
  return {
    id,
    name: id,
    createdAt: '',
    updatedAt: '',
    createdAtMs: 1,
    updatedAtMs: 1,
  }
}

function folderItem(id) {
  return {
    id,
    name: id,
    path: `E:/${id}`,
    groupId: 'default',
    createdAt: '',
    updatedAt: '',
    createdAtMs: 1,
    updatedAtMs: 1,
  }
}

describe('desktop drag drop intent', () => {
  it('resolves a container drop from an overlay hover target', () => {
    const intent = resolveDesktopDropIntent({
      dragMode: 'overlay',
      hoverTarget: { entry: containerEntry('container-a'), layout: { x: 1, y: 2 } },
    }, null, null)

    assert.deepEqual(intent, { kind: 'container', containerId: 'container-a' })
  })

  it('keeps an opened container as the active drop target after desktop hover moves away', () => {
    const currentDrag = {
      item: folderItem('folder-a'),
      mode: 'overlay',
      dropIntent: { kind: 'container', containerId: 'container-a' },
    }
    const intent = resolveDesktopDropIntent({ dragMode: 'reflow' }, currentDrag, container('container-a'))

    assert.deepEqual(intent, { kind: 'container', containerId: 'container-a' })
    assert.equal(resolveDesktopDragMode({ dragMode: 'reflow' }, intent), 'overlay')
    assert.equal(isContainerDropTargetActive(currentDrag, container('container-a')), true)
  })

  it('does not keep a stale container intent for a different opened container', () => {
    const currentDrag = {
      item: folderItem('folder-a'),
      mode: 'overlay',
      dropIntent: { kind: 'container', containerId: 'container-a' },
    }

    assert.equal(resolveDesktopDropIntent({ dragMode: 'reflow' }, currentDrag, container('container-b')), undefined)
    assert.equal(isContainerDropTargetActive(currentDrag, container('container-b')), false)
  })

  it('resolves a new-container drop from an overlay folder hover target', () => {
    const intent = resolveDesktopDropIntent({
      dragMode: 'overlay',
      hoverTarget: { entry: folderEntry('folder-b'), layout: { x: 3, y: 4 } },
    }, null, null)

    assert.deepEqual(intent, { kind: 'new-container', targetItemId: 'folder-b', layout: { x: 3, y: 4 } })
  })
})
