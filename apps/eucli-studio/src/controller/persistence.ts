export function createPersistence(deps: {
  getState: () => any
  saveMetaOnly: (options?: { explicitReset?: boolean }) => Promise<void>
}) {
  const { getState, saveMetaOnly } = deps

  // 客户端偏好（活动角色 / 群组 / 工作区 / 目标类型）从 draft 回写到 state.data.ui。
  // 聊天正文属于业务端，不在这里保存。
  function syncPreferencesToData() {
    const state = getState()
    if (!state?.data) return null
    if (!state.data.ui || typeof state.data.ui !== 'object') state.data.ui = {}
    state.data.ui.activeRoleId = String(state.draft?.activeRoleId || '')
    ;(state.data.ui as any).activeGroupId = String(state.draft?.activeGroupId || '')
    ;(state.data.ui as any).activeWorkspaceId = String((state.draft as any)?.activeWorkspaceId || '')
    const targetKind = String(state.draft?.activeTargetKind || '').trim()
    ;(state.data.ui as any).activeTargetKind = targetKind === 'group' ? 'group' : targetKind === 'workspace' ? 'workspace' : 'role'
    return state
  }

  // explicitReset 只能在用户点击设置页「恢复默认」时传 true：
  // 它绕过「空值保险丝」，是默认值覆盖历史设置唯一被允许的入口。
  async function savePreferences(options?: { explicitReset?: boolean }) {
    const state = syncPreferencesToData()
    if (!state) return
    await saveMetaOnly(options)
  }

  return {
    savePreferences,
  }
}
