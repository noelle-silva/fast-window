import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { FOLDER_GRID_CELL_WIDTH, FOLDER_GRID_PADDING } from '../src/folder-grid/constants.ts'
import {
  buildFolderGridLayoutMap,
  diffFolderGridLayouts,
  getFolderGridColumnCount,
  getFolderGridLayoutFromPixel,
  resolveFolderGridDragLayout,
} from '../src/folder-grid/layout.ts'

function item(id, x, y) {
  return {
    id,
    name: id,
    path: `E:/${id}`,
    groupId: 'default',
    createdAt: '',
    updatedAt: '',
    createdAtMs: 1,
    updatedAtMs: 1,
    layout: x == null || y == null ? undefined : { x, y },
  }
}

describe('folder grid layout', () => {
  it('computes multiple columns from the rendered canvas width', () => {
    assert.equal(getFolderGridColumnCount(0), 1)
    assert.ok(getFolderGridColumnCount(720) > 1)
  })

  it('converts horizontal pixels into grid columns', () => {
    const columns = getFolderGridColumnCount(720)
    assert.equal(getFolderGridLayoutFromPixel(FOLDER_GRID_PADDING, FOLDER_GRID_PADDING, columns).x, 0)
    assert.equal(getFolderGridLayoutFromPixel(FOLDER_GRID_PADDING + FOLDER_GRID_CELL_WIDTH, FOLDER_GRID_PADDING, columns).x, 1)
    assert.equal(getFolderGridLayoutFromPixel(FOLDER_GRID_PADDING + FOLDER_GRID_CELL_WIDTH * 2, FOLDER_GRID_PADDING, columns).x, 2)
  })

  it('keeps persisted positions before filling empty slots', () => {
    const items = [item('new'), item('saved', 2, 0)]
    const layouts = buildFolderGridLayoutMap(items, getFolderGridColumnCount(720))
    assert.deepEqual(layouts.get('saved'), { x: 2, y: 0 })
    assert.deepEqual(layouts.get('new'), { x: 0, y: 0 })
  })

  it('pushes icons forward when dragging into an occupied grid slot', () => {
    const items = [item('a', 0, 0), item('b', 1, 0), item('c', 2, 0)]
    const columns = getFolderGridColumnCount(720)
    const base = buildFolderGridLayoutMap(items, columns)
    const next = resolveFolderGridDragLayout(items, base, 'a', { x: 1, y: 0 }, columns)
    assert.deepEqual(next.get('a'), { x: 1, y: 0 })
    assert.deepEqual(next.get('b'), { x: 2, y: 0 })
    assert.deepEqual(next.get('c'), { x: 3, y: 0 })
    assert.deepEqual(diffFolderGridLayouts(base, next).map(patch => patch.id), ['a', 'b', 'c'])
  })
})
