import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { FOLDER_GRID_CELL_WIDTH, FOLDER_GRID_ITEM_WIDTH, FOLDER_GRID_PADDING } from '../src/folder-grid/constants.ts'
import { createFolderGridMetrics } from '../src/folder-grid/iconLayout.ts'
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
    pageOrder: 0,
    createdAt: '',
    updatedAt: '',
    createdAtMs: 1,
    updatedAtMs: 1,
    layout: x == null || y == null ? undefined : { x, y },
  }
}

function canvasWidthForColumns(columnCount, metrics) {
  if (metrics) return metrics.padding * 2 + metrics.itemWidth + metrics.cellWidth * (columnCount - 1)
  return FOLDER_GRID_PADDING * 2 + FOLDER_GRID_ITEM_WIDTH + FOLDER_GRID_CELL_WIDTH * (columnCount - 1)
}

describe('folder grid layout', () => {
  it('computes multiple columns from the rendered canvas width', () => {
    assert.equal(getFolderGridColumnCount(0), 1)
    assert.equal(getFolderGridColumnCount(canvasWidthForColumns(4)), 4)
  })

  it('uses icon scale and column gap metrics when computing columns', () => {
    const compactMetrics = createFolderGridMetrics({ rowGap: 38, columnGap: 24, iconScale: 0.8 })
    const spaciousMetrics = createFolderGridMetrics({ rowGap: 38, columnGap: 72, iconScale: 1.3 })
    assert.equal(getFolderGridColumnCount(canvasWidthForColumns(4, compactMetrics), compactMetrics), 4)
    assert.ok(getFolderGridColumnCount(canvasWidthForColumns(4, compactMetrics), spaciousMetrics) < 4)
  })

  it('uses the configured row gap when converting vertical pixels', () => {
    const metrics = createFolderGridMetrics({ rowGap: 64, columnGap: 38, iconScale: 1 })
    const layout = getFolderGridLayoutFromPixel(metrics.padding, metrics.padding + metrics.cellHeight * 4, 4, metrics)
    assert.equal(layout.y, 4)
  })

  it('converts horizontal pixels into grid columns', () => {
    const columns = getFolderGridColumnCount(canvasWidthForColumns(4))
    assert.equal(getFolderGridLayoutFromPixel(FOLDER_GRID_PADDING, FOLDER_GRID_PADDING, columns).x, 0)
    assert.equal(getFolderGridLayoutFromPixel(FOLDER_GRID_PADDING + FOLDER_GRID_CELL_WIDTH, FOLDER_GRID_PADDING, columns).x, 1)
    assert.equal(getFolderGridLayoutFromPixel(FOLDER_GRID_PADDING + FOLDER_GRID_CELL_WIDTH * 2, FOLDER_GRID_PADDING, columns).x, 2)
  })

  it('keeps persisted positions before filling empty slots', () => {
    const items = [item('new'), item('saved', 2, 0)]
    const layouts = buildFolderGridLayoutMap(items, getFolderGridColumnCount(canvasWidthForColumns(4)))
    assert.deepEqual(layouts.get('saved'), { x: 2, y: 0 })
    assert.deepEqual(layouts.get('new'), { x: 0, y: 0 })
  })

  it('pushes icons forward when dragging into an occupied grid slot', () => {
    const items = [item('a', 0, 0), item('b', 1, 0), item('c', 2, 0)]
    const columns = getFolderGridColumnCount(canvasWidthForColumns(4))
    const base = buildFolderGridLayoutMap(items, columns)
    const next = resolveFolderGridDragLayout(items, base, 'a', { x: 1, y: 0 }, columns)
    assert.deepEqual(next.get('a'), { x: 1, y: 0 })
    assert.deepEqual(next.get('b'), { x: 2, y: 0 })
    assert.deepEqual(next.get('c'), { x: 3, y: 0 })
    assert.deepEqual(diffFolderGridLayouts(base, next).map(patch => patch.id), ['a', 'b', 'c'])
  })
})
