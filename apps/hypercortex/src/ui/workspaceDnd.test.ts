import { describe, expect, it } from 'vitest'
import { isSideEngaged, resolveActiveSide } from './workspaceDnd'

describe('workspaceDnd 条目当前所属容器', () => {
  it('可迁移且指针落在另一侧时，条目归指针所在容器', () => {
    expect(resolveActiveSide({ originSide: 'left', pointerSide: 'right', canTransfer: true })).toBe('right')
    expect(resolveActiveSide({ originSide: 'right', pointerSide: 'left', canTransfer: true })).toBe('left')
  })

  it('指针仍在起点侧时，条目留在起点容器', () => {
    expect(resolveActiveSide({ originSide: 'left', pointerSide: 'left', canTransfer: true })).toBe('left')
  })

  it('指针不在任一侧（两侧之间）时，条目留在起点容器', () => {
    expect(resolveActiveSide({ originSide: 'left', pointerSide: '', canTransfer: true })).toBe('left')
  })

  it('条目不可迁移时，无论指针在哪都留在起点容器', () => {
    expect(resolveActiveSide({ originSide: 'left', pointerSide: 'right', canTransfer: false })).toBe('left')
    expect(resolveActiveSide({ originSide: 'right', pointerSide: 'left', canTransfer: false })).toBe('right')
  })
})

describe('workspaceDnd 侧栏参与拖拽', () => {
  it('未拖拽时两侧都参与（静态渲染）', () => {
    expect(isSideEngaged({ dragging: false, pointerSide: '', originSide: '', side: 'left' })).toBe(true)
    expect(isSideEngaged({ dragging: false, pointerSide: '', originSide: '', side: 'right' })).toBe(true)
  })

  it('指针进入某侧（含空白区域）该侧即参与，不依赖是否压中条目', () => {
    expect(isSideEngaged({ dragging: true, pointerSide: 'right', originSide: 'left', side: 'right' })).toBe(true)
    expect(isSideEngaged({ dragging: true, pointerSide: 'left', originSide: 'right', side: 'left' })).toBe(true)
  })

  it('拖拽来源侧始终参与', () => {
    expect(isSideEngaged({ dragging: true, pointerSide: '', originSide: 'left', side: 'left' })).toBe(true)
  })

  it('指针不在且非来源的一侧不参与', () => {
    expect(isSideEngaged({ dragging: true, pointerSide: '', originSide: 'left', side: 'right' })).toBe(false)
  })
})
