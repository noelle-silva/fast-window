import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { applyContainerItemDesktopExtraction, isContainerSoftClosedForExtractDrag, resolveContainerExtractDragMode } from '../src/containerExtractDragState.ts'
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

function foldersDoc() {
  return {
    schemaVersion: 1,
    dataVersion: 1,
    groups: [{ id: 'default', name: '默认' }],
    items: [
      { ...folderItem('inside'), containerId: 'container-a', containerLayout: { x: 0, y: 0 } },
      { ...folderItem('desktop'), layout: { x: 1, y: 0 } },
    ],
    containers: [{ ...container('container-a'), layout: { x: 0, y: 0 } }],
    desktop: { iconLayout: { rowGap: 38, columnGap: 38, iconScale: 1 } },
    updatedAt: '',
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

describe('container extract drag state', () => {
  it('switches to desktop mode only after leaving the container boundary', () => {
    const boundary = { left: 10, right: 110, top: 20, bottom: 120 }

    assert.equal(resolveContainerExtractDragMode({ clientX: 60, clientY: 60 }, boundary), 'container')
    assert.equal(resolveContainerExtractDragMode({ clientX: 111, clientY: 60 }, boundary), 'desktop')
    assert.equal(resolveContainerExtractDragMode({ clientX: 60, clientY: 19 }, boundary), 'desktop')
    assert.equal(resolveContainerExtractDragMode({ clientX: 60, clientY: 60 }, null), 'container')
  })

  it('soft closes only the active container during desktop extraction', () => {
    const drag = { containerId: 'container-a', item: folderItem('inside'), mode: 'desktop' }

    assert.equal(isContainerSoftClosedForExtractDrag(drag, container('container-a')), true)
    assert.equal(isContainerSoftClosedForExtractDrag(drag, container('container-b')), false)
    assert.equal(isContainerSoftClosedForExtractDrag({ ...drag, mode: 'container' }, container('container-a')), false)
  })

  it('applies desktop extraction without mutating unrelated container items', () => {
    const nextDoc = applyContainerItemDesktopExtraction(foldersDoc(), 'container-a', 'inside', [
      { kind: 'folder', id: 'inside', layout: { x: 2, y: 0 } },
      { kind: 'folder', id: 'desktop', layout: { x: 3, y: 0 } },
      { kind: 'container', id: 'container-a', layout: { x: 0, y: 1 } },
    ])

    const moved = nextDoc.items.find(item => item.id === 'inside')
    const desktop = nextDoc.items.find(item => item.id === 'desktop')
    assert.equal(moved.containerId, undefined)
    assert.equal(moved.containerLayout, undefined)
    assert.deepEqual(moved.layout, { x: 2, y: 0 })
    assert.deepEqual(desktop.layout, { x: 3, y: 0 })
    assert.deepEqual(nextDoc.containers[0].layout, { x: 0, y: 1 })
  })

  it('rejects extraction patches for folders that are still in a container', () => {
    assert.throws(() => applyContainerItemDesktopExtraction(foldersDoc(), 'container-a', 'inside', [
      { kind: 'folder', id: 'inside', layout: { x: 2, y: 0 } },
      { kind: 'folder', id: 'missing', layout: { x: 3, y: 0 } },
    ]), /desktop entry not found/)
    assert.throws(() => applyContainerItemDesktopExtraction(foldersDoc(), 'container-a', 'desktop', [
      { kind: 'folder', id: 'desktop', layout: { x: 2, y: 0 } },
    ]), /folder is not in container/)
  })
})
