import { describe, expect, it } from 'vitest'
import { resolveSortMovePosition, resolveSortableDragMode } from './SortableDnd'

// 拖拽模式与插入方向的纯判定：这两种规则被排序与放置两条链路共同使用，
// 单独锁住它们，避免以后调整交互时把语义改歪。
describe('resolveSortableDragMode', () => {
  it('按住 Ctrl 是放置，否则是排序', () => {
    expect(resolveSortableDragMode(true)).toBe('drop')
    expect(resolveSortableDragMode(false)).toBe('sort')
  })
})

describe('resolveSortMovePosition', () => {
  const items = ['a', 'b', 'c']

  it('向下拖动落在目标之后，向上拖动落在目标之前', () => {
    expect(resolveSortMovePosition(items, 'a', 'c')).toBe('after')
    expect(resolveSortMovePosition(items, 'c', 'a')).toBe('before')
  })

  it('同一项或不在列表里的项没有插入方向', () => {
    expect(resolveSortMovePosition(items, 'a', 'a')).toBeNull()
    expect(resolveSortMovePosition(items, 'a', 'missing')).toBeNull()
  })
})
