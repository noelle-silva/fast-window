import { describe, expect, it } from 'vitest'
import {
  resolveSortMovePosition,
  resolveSortableDragMode,
  resolveSortableItemStyle,
  settleHasLanded,
  type SortableSettleSnapshot,
} from './SortableDnd'

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

function settleSnapshot(overrides: Partial<SortableSettleSnapshot> = {}): SortableSettleSnapshot {
  return {
    activeId: 'b',
    transforms: new Map([
      ['b', 'translate3d(0px, 40px, 0)'],
      ['c', 'translate3d(0px, -40px, 0)'],
    ]),
    sections: new Map([['list', 'a\u0000b\u0000c']]),
    ...overrides,
  }
}

// 松手后的位移冻结：靠「条目顺序变没变」判断数据是否落地。
describe('settleHasLanded', () => {
  it('条目顺序变了就是落地', () => {
    const landed = settleHasLanded(
      settleSnapshot(),
      new Map([['list', ['a', 'c', 'b']]]),
    )
    expect(landed).toBe(true)
  })

  it('顺序没变（哪怕是新数组）不算落地', () => {
    const landed = settleHasLanded(
      settleSnapshot(),
      new Map([['list', ['a', 'b', 'c']]]),
    )
    expect(landed).toBe(false)
  })

  it('快照里的段落整个消失也算落地', () => {
    expect(settleHasLanded(settleSnapshot(), new Map())).toBe(true)
  })

  it('只看快照里登记过的段落', () => {
    const landed = settleHasLanded(
      settleSnapshot(),
      new Map([
        ['list', ['a', 'b', 'c']],
        ['other', ['x', 'y']],
      ]),
    )
    expect(landed).toBe(false)
  })
})

describe('resolveSortableItemStyle', () => {
  it('松手后沿用快照位移，活动行保持在上层', () => {
    const settle = settleSnapshot()
    const activeStyle = resolveSortableItemStyle({
      id: 'b',
      isDragging: false,
      isDropMode: false,
      transform: '',
      transition: 'transform 200ms ease',
      settle,
    })
    const displacedStyle = resolveSortableItemStyle({
      id: 'c',
      isDragging: false,
      isDropMode: false,
      transform: '',
      transition: 'transform 200ms ease',
      settle,
    })

    expect(activeStyle.transform).toBe('translate3d(0px, 40px, 0)')
    expect(activeStyle.zIndex).toBe(2)
    expect(displacedStyle.transform).toBe('translate3d(0px, -40px, 0)')
    expect(displacedStyle.zIndex).toBeUndefined()
    // 冻结期间不挂过渡，否则会从松手位置慢慢滑回旧位置。
    expect(activeStyle.transition).toBeUndefined()
  })

  it('快照里没有位移的行继续用实时值', () => {
    const style = resolveSortableItemStyle({
      id: 'a',
      isDragging: false,
      isDropMode: false,
      transform: 'translate3d(0px, 8px, 0)',
      transition: 'transform 200ms ease',
      settle: settleSnapshot(),
    })

    expect(style.transform).toBe('translate3d(0px, 8px, 0)')
    expect(style.transition).toBe('transform 200ms ease')
  })

  it('拖拽中按实时位移走，没有被快照接管', () => {
    const style = resolveSortableItemStyle({
      id: 'b',
      isDragging: true,
      isDropMode: false,
      transform: 'translate3d(0px, 120px, 0)',
      transition: undefined,
      settle: settleSnapshot(),
    })

    expect(style.transform).toBe('translate3d(0px, 120px, 0)')
    expect(style.zIndex).toBe(2)
  })

  it('放置模式下未拖动的行不参与让位', () => {
    const style = resolveSortableItemStyle({
      id: 'c',
      isDragging: false,
      isDropMode: true,
      transform: 'translate3d(0px, -40px, 0)',
      transition: 'transform 200ms ease',
      settle: null,
    })

    expect(style.transform).toBeUndefined()
    expect(style.transition).toBeUndefined()
  })
})
