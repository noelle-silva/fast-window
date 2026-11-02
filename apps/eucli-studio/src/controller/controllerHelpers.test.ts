import { describe, expect, it, vi } from 'vitest'
import { refreshScopes } from '../domain/uiRefreshScope'
import { createModalHelpers } from './controllerHelpers'

describe('弹层关闭通知', () => {
  it('closeModal 清空弹层状态并只通知 uiShell', () => {
    const state: any = {
      modal: 'confirm',
      draft: {
        deleteRoleId: 'role-a',
        deleteGroupId: 'group-a',
        deleteWorkspaceId: 'ws-a',
        deleteProviderId: 'provider-a',
        roleToolAddOpen: true,
        roleToolSearch: 'search',
        roleToolAddSelected: ['tool-a'],
        renderSafetyPolicyTarget: 'role-a',
        roleAvatarImageCropSrc: 'avatar',
        groupAvatarImageCropSrc: 'group-avatar',
        editRoleId: 'role-a',
        editGroupId: 'group-a',
        editWorkspaceId: 'ws-a',
      },
    }
    const emitScope = vi.fn()
    const { closeModal } = createModalHelpers({ state, emitScope })

    closeModal()

    expect(state.modal).toBe('')
    expect(state.draft.deleteRoleId).toBe('')
    expect(state.draft.roleToolAddOpen).toBe(false)
    expect(emitScope).toHaveBeenCalledWith(refreshScopes.uiShell())
    expect(emitScope).toHaveBeenCalledTimes(1)
  })
})
