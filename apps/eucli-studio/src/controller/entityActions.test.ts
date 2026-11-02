import { describe, expect, it, vi } from 'vitest'
import { refreshScopes } from '../domain/uiRefreshScope'
import { createEntityActions } from './actions/entityActions'

function createHarness(reorderRoles = vi.fn(async () => {}), reorderProviders = vi.fn(async () => {})) {
  const state: any = {
    data: {
      roles: [
        { id: 'role-a', name: 'A' },
        { id: 'role-b', name: 'B' },
        { id: 'role-c', name: 'C' },
      ],
      settings: {
        providers: [
          { id: 'provider-a', name: 'A' },
          { id: 'provider-b', name: 'B' },
        ],
      },
    },
    draft: {},
  }
  const emitScope = vi.fn()
  const showToast = vi.fn()
  const actions = createEntityActions({
    state,
    emitScope,
    showToast,
    reorderRoles,
    reorderProviders,
    moveWorkspace: async () => {},
  } as any)
  return { state, emitScope, showToast, actions, reorderRoles, reorderProviders }
}

describe('实体通知地址', () => {
  it('角色与供应商排序分别通知各自实体域，不触发全局广播', async () => {
    const state: any = {
      data: {
        roles: [{ id: 'role-a' }, { id: 'role-b' }],
        settings: { providers: [{ id: 'provider-a' }, { id: 'provider-b' }] },
      },
      draft: {},
    }
    const emitScope = vi.fn()
    const actions = createEntityActions({
      state,
      emitScope,
      reorderRoles: vi.fn(async () => {}),
      reorderProviders: vi.fn(async () => {}),
    } as any)

    await actions.moveRole('role-a', 'role-b', 'after')
    await actions.moveProvider('provider-a', 'provider-b', 'after')

    expect(emitScope.mock.calls.map((call) => call[0])).toEqual([
      refreshScopes.entities('roles'),
      refreshScopes.entities('providers'),
    ])
  })
})

describe('角色手动排序', () => {
  it('拖拽后立即更新视窗顺序，并把完整顺序写入业务端', async () => {
    const harness = createHarness()

    await harness.actions.moveRole('role-a', 'role-c', 'after')

    expect(harness.state.data.roles.map((role: any) => role.id)).toEqual(['role-b', 'role-c', 'role-a'])
    expect(harness.reorderRoles).toHaveBeenCalledWith(['role-b', 'role-c', 'role-a'])
    expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.entities('roles'))
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

describe('供应商手动排序', () => {
  it('拖拽后立即更新视窗顺序，并把完整顺序写入业务端', async () => {
    const harness = createHarness()

    await harness.actions.moveProvider('provider-a', 'provider-b', 'after')

    expect(harness.state.data.settings.providers.map((provider: any) => provider.id)).toEqual(['provider-b', 'provider-a'])
    expect(harness.reorderProviders).toHaveBeenCalledWith(['provider-b', 'provider-a'])
  })
})
