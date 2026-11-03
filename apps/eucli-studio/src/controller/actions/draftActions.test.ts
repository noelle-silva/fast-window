import { describe, expect, it, vi } from 'vitest'
import { refreshScopes } from '../../domain/uiRefreshScope'
import { createDraftActions } from './draftActions'

function createHarness() {
  const state: any = {
    modal: '',
    draft: {
      activeTargetKind: 'role',
      activeRoleId: 'role-a',
      activeGroupId: '',
      activeWorkspaceId: '',
    },
  }
  const emitScope = vi.fn()
  const actions = createDraftActions({ state, emitScope })
  return { state, emitScope, actions }
}

describe('草稿写入语义', () => {
  it('输入区逐键写入不广播，避免外部刷新重置输入区', () => {
    const harness = createHarness()

    harness.actions.setComposerInput('正在输入')

    expect(harness.state.draft.input).toBe('正在输入')
    expect(harness.emitScope).not.toHaveBeenCalled()
  })

  it('外部程序化写入必须广播 composer 范围', () => {
    const harness = createHarness()

    harness.actions.setComposerInputExternal('外部写入')

    expect(harness.state.draft.input).toBe('外部写入')
    expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.composer())
  })

  it('输入草稿不再允许通过通用 setDraft 写入，必须走显式入口', () => {
    const harness = createHarness()

    expect(() => harness.actions.setDraft('input', '错误入口')).toThrowError(/setComposerInput/)
    expect(harness.emitScope).not.toHaveBeenCalled()
  })

  it('非输入草稿字段归 uiShell，草稿图片归 composer', () => {
    const harness = createHarness()

    harness.actions.setDraft('workspaceName', '新工作区')
    harness.actions.removeDraftImage('img-1')

    expect(harness.state.draft.workspaceName).toBe('新工作区')
    expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.uiShell())
    expect(harness.emitScope).toHaveBeenCalledWith(refreshScopes.composer())
  })
})
