// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isDroppableOnSide, isRightTarget, shouldCommitCrossDrop } from './workspaceDnd'

// 左侧条目身份以 `tab:` 前缀示意，右侧条目身份以 `ref:` 前缀示意。
const isLeftId = (id: string) => id.startsWith('tab:')
const CROSSED = 'tab:note:n1'

describe('workspaceDnd 跨栏碰撞归属', () => {
  it('指针在右侧时，跨栏中的条目作为右侧一员参与碰撞', () => {
    expect(isDroppableOnSide(CROSSED, 'right', CROSSED, isLeftId)).toBe(true)
  })

  it('指针在左侧时，跨栏中的条目不再属于左侧', () => {
    expect(isDroppableOnSide(CROSSED, 'left', CROSSED, isLeftId)).toBe(false)
  })

  it('未跨栏的左侧条目在右侧不参与碰撞，在左侧参与', () => {
    expect(isDroppableOnSide('tab:note:n2', 'right', CROSSED, isLeftId)).toBe(false)
    expect(isDroppableOnSide('tab:note:n2', 'left', CROSSED, isLeftId)).toBe(true)
  })

  it('右侧条目在右侧参与碰撞，在左侧不参与', () => {
    expect(isDroppableOnSide('ref:r1', 'right', CROSSED, isLeftId)).toBe(true)
    expect(isDroppableOnSide('ref:r1', 'left', CROSSED, isLeftId)).toBe(false)
  })

  it('无侧向时不筛选', () => {
    expect(isDroppableOnSide('ref:r1', '', CROSSED, isLeftId)).toBe(true)
    expect(isDroppableOnSide(CROSSED, '', CROSSED, isLeftId)).toBe(true)
  })
})

describe('workspaceDnd 落点判定', () => {
  it('右侧条目与已跨栏条目都算右侧目标', () => {
    expect(isRightTarget('ref:r1', CROSSED, isLeftId)).toBe(true)
    expect(isRightTarget(CROSSED, CROSSED, isLeftId)).toBe(true)
  })

  it('未跨栏的左侧条目与空落点不算右侧目标', () => {
    expect(isRightTarget('tab:note:n2', CROSSED, isLeftId)).toBe(false)
    expect(isRightTarget('', CROSSED, isLeftId)).toBe(false)
  })
})

describe('workspaceDnd 跨栏落定判定', () => {
  it('接管中且松手时指针确实在右侧才提交', () => {
    expect(shouldCommitCrossDrop({ foreignActive: true, releaseSide: 'right' })).toBe(true)
  })

  it('拉回左侧松手不提交（可回退取消）', () => {
    expect(shouldCommitCrossDrop({ foreignActive: true, releaseSide: 'left' })).toBe(false)
  })

  it('松手时指针不在任一侧也不提交', () => {
    expect(shouldCommitCrossDrop({ foreignActive: true, releaseSide: '' })).toBe(false)
  })

  it('未接管时不提交', () => {
    expect(shouldCommitCrossDrop({ foreignActive: false, releaseSide: 'right' })).toBe(false)
  })
})
