import { describe, expect, it, vi } from 'vitest'
import { createEntityActions } from './actions/entityActions'

function createHarness(reorderRoles = vi.fn(async () => {})) {
  const state: any = {
    data: {
      roles: [
        { id: 'role-a', name: 'A' },
        { id: 'role-b', name: 'B' },
        { id: 'role-c', name: 'C' },
      ],
    },
    draft: {},
  }
  const emit = vi.fn()
  const showToast = vi.fn()
  const actions = createEntityActions({
    state,
    emit,
    showToast,
    reorderRoles,
    moveWorkspace: async () => {},
  } as any)
  return { state, emit, showToast, actions, reorderRoles }
}

describe('角色手动排序', () => {
  it('拖拽后立即更新视窗顺序，并把完整顺序写入业务端', async () => {
    const harness = createHarness()

    await harness.actions.moveRole('role-a', 'role-c', 'after')

    expect(harness.state.data.roles.map((role: any) => role.id)).toEqual(['role-b', 'role-c', 'role-a'])
    expect(harness.reorderRoles).toHaveBeenCalledWith(['role-b', 'role-c', 'role-a'])
    expect(harness.emit).toHaveBeenCalled()
  })

  it('业务端拒绝排序时回滚视窗顺序并提示', async () => {
    const reorderRoles = vi.fn(async () => {
      throw new Error('排序失败')
    })
    const harness = createHarness(reorderRoles)

    await harness.actions.moveRole('role-a', 'role-b', 'after')

    expect(harness.state.data.roles.map((role: any) => role.id)).toEqual(['role-a', 'role-b', 'role-c'])
    expect(harness.showToast).toHaveBeenCalled()
  })
})
