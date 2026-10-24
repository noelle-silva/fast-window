import { describe, expect, it, vi } from 'vitest'
import { createChatInteractionActions } from './chatInteractionActions'

function createHarness() {
  const state: any = { data: {} }
  const ensureWorkspaceChatLoaded = vi.fn(async () => ({ id: 'session-b1', roleId: 'role-b' }))
  const aiGenerateChatTitle = vi.fn(async () => ({ title: '新标题' }))
  const reloadWorkspaceSession = vi.fn(async () => ({}))
  const emit = vi.fn()
  const actions = createChatInteractionActions({
    state,
    emit,
    showToast: vi.fn(),
    ensureWorkspaceChatLoaded,
    aiGenerateChatTitle,
    reloadWorkspaceSession,
  } as any)
  return { actions, ensureWorkspaceChatLoaded, aiGenerateChatTitle, reloadWorkspaceSession, emit }
}

describe('工作区会话智能起名', () => {
  it('加载、起名与回读都使用工作区编号与会话自身角色', async () => {
    const harness = createHarness()

    await harness.actions.aiGenerateWorkspaceChatTitle('ws-1', 'role-b', 'session-b1')

    expect(harness.ensureWorkspaceChatLoaded).toHaveBeenCalledWith('ws-1', 'role-b', 'session-b1')
    expect(harness.aiGenerateChatTitle).toHaveBeenCalledWith('role-b', 'session-b1', 'ws-1')
    expect(harness.reloadWorkspaceSession).toHaveBeenCalledWith('ws-1', 'role-b', 'session-b1')
    expect(harness.emit).toHaveBeenCalled()
  })
})
