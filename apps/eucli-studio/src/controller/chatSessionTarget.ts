export type ChatSettingsTarget = {
  kind: 'role' | 'group' | 'workspace'
  targetId: string
  roleId: string
  groupId: string
  workspaceId: string
  sessionId: string
  chat: any
}

// 会话级设置的统一目标标识：kind+targetId+sessionId。
// 控制器队列与 UI 显示条件必须使用同一个标识推导，避免两侧语义漂移造成跨会话误判。
export function chatSettingsTargetKey(target: Pick<ChatSettingsTarget, 'kind' | 'targetId' | 'sessionId'>) {
  return JSON.stringify([target.kind, target.targetId, target.sessionId])
}

export function createChatSessionTarget(deps: {
  getState: () => any
  activeTargetKind: () => ChatSettingsTarget['kind']
  activeChat: () => any
  activeRole: () => any
  activeGroup: () => any
  activeWorkspace: () => any
  pendingChatForTarget: (state: any, kind: ChatSettingsTarget['kind'], targetId: string) => any
  workspaceRoleTargetId: (workspaceId: unknown, roleId: unknown) => string
}) {
  const {
    getState,
    activeTargetKind,
    activeChat,
    activeRole,
    activeGroup,
    activeWorkspace,
    pendingChatForTarget,
    workspaceRoleTargetId,
  } = deps

  function captureChatSettingsTarget(): ChatSettingsTarget | null {
    const kind = activeTargetKind()
    const chat = activeChat()
    if (!chat || (chat as any).clientDraft) {
      return chat
        ? {
            kind,
            targetId: kind === 'group' ? String(activeGroup()?.id || '').trim() : kind === 'workspace' ? workspaceRoleTargetId(activeWorkspace()?.id, activeRole()?.id) : String(activeRole()?.id || '').trim(),
            roleId: String((chat as any)?.roleId || activeRole()?.id || getState().draft?.activeRoleId || '').trim(),
            groupId: kind === 'group' ? String(activeGroup()?.id || '').trim() : '',
            workspaceId: kind === 'workspace' ? String(activeWorkspace()?.id || '').trim() : '',
            sessionId: String(chat?.id || '').trim(),
            chat,
          }
        : null
    }
    const state = getState()
    const roleId = String((chat as any)?.roleId || activeRole()?.id || state.draft?.activeRoleId || '').trim()
    const groupId = kind === 'group' ? String(activeGroup()?.id || state.draft?.activeGroupId || '').trim() : ''
    const workspaceId = kind === 'workspace' ? String(activeWorkspace()?.id || (state.draft as any)?.activeWorkspaceId || '').trim() : ''
    const targetId = kind === 'group' ? groupId : kind === 'workspace' ? workspaceRoleTargetId(workspaceId, roleId) : roleId
    const sessionId = String(chat?.id || '').trim()
    if (!targetId || !sessionId) return null
    return { kind, targetId, roleId: kind === 'group' ? '' : roleId, groupId, workspaceId, sessionId, chat }
  }

  function currentChatForSettingsTarget(target: ChatSettingsTarget) {
    const state = getState()
    const pending = pendingChatForTarget(state, target.kind, target.targetId)
    if (pending) return pending
    const box = target.kind === 'group'
      ? state.data?.chatsByGroup?.[target.targetId]
      : target.kind === 'workspace'
        ? state.data?.chatsByWorkspace?.[target.targetId]
        : state.data?.chatsByRole?.[target.targetId]
    const chats = Array.isArray(box?.chats) ? box.chats : []
    return chats.find((item: any) => String(item?.id || '').trim() === target.sessionId) || null
  }

  return { captureChatSettingsTarget, currentChatForSettingsTarget }
}
