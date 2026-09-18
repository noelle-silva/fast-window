import { describe, expect, it } from 'vitest'
import { createChatSessionTarget } from './chatSessionTarget'

function createHarness() {
  let state: any = {
    draft: { activeRoleId: 'role-1', activeGroupId: 'group-1', activeWorkspaceId: 'workspace-1' },
    data: {
      chatsByRole: { 'role-1': { chats: [{ id: 'role-session' }] } },
      chatsByGroup: { 'group-1': { chats: [{ id: 'group-session' }] } },
      chatsByWorkspace: { 'workspace-1/role-1': { chats: [{ id: 'workspace-session' }] } },
    },
  }
  let kind: 'role' | 'group' | 'workspace' = 'role'
  let chat: any = state.data.chatsByRole['role-1'].chats[0]
  const target = createChatSessionTarget({
    getState: () => state,
    activeTargetKind: () => kind,
    activeChat: () => chat,
    activeRole: () => ({ id: 'role-1' }),
    activeGroup: () => ({ id: 'group-1' }),
    activeWorkspace: () => ({ id: 'workspace-1' }),
    pendingChatForTarget: () => null,
    workspaceRoleTargetId: (workspaceId, roleId) => `${workspaceId}/${roleId}`,
  })
  return { target, setKind: (value: typeof kind) => { kind = value }, setChat: (value: any) => { chat = value }, setState: (value: any) => { state = value } }
}

describe('chat settings target protection', () => {
  it.each([
    ['role', 'role-session', ['role', 'role-1', 'role-session']],
    ['group', 'group-session', ['group', 'group-1', 'group-session']],
    ['workspace', 'workspace-session', ['workspace', 'workspace-1/role-1', 'workspace-session']],
  ] as const)('captures the complete %s target before a switch', (kind, sessionId, key) => {
    const harness = createHarness()
    harness.setKind(kind)
    harness.setChat({ id: sessionId, roleId: 'role-1' })
    const captured = harness.target.captureChatSettingsTarget()
    expect(captured && [captured.kind, captured.targetId, captured.sessionId]).toEqual(key)
  })

  it('looks up the captured session, not the currently selected session', () => {
    const harness = createHarness()
    const captured = harness.target.captureChatSettingsTarget()!
    harness.setChat({ id: 'new-session' })
    expect(harness.target.currentChatForSettingsTarget(captured)).toEqual({ id: 'role-session' })
  })

  it('does not create a target without a session id', () => {
    const harness = createHarness()
    harness.setChat({ id: '' })
    expect(harness.target.captureChatSettingsTarget()).toBeNull()
  })
})
