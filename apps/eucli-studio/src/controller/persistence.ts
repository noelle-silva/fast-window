export function createPersistence(deps: {
  getState: () => any
  activeChatFromData: () => any
  saveMetaOnly: () => Promise<void>
}) {
  const { getState, saveMetaOnly } = deps

  function syncDraftUiToData() {
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

  async function saveMeta() {
    const state = syncDraftUiToData()
    if (!state) return
    await saveMetaOnly()
  }

  async function saveCurrentChat() {
    await saveMeta()
  }

  return {
    saveMeta,
    saveCurrentChat,
  }
}
