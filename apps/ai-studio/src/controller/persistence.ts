export function createPersistence(deps: {
  getState: () => any
  activeChatFromData: () => any
  saveMetaOnly: () => Promise<void>
  saveSplitData: (data: any) => Promise<void>
  saveRoleChat: (roleId: any, chat: any) => Promise<void>
  saveGroupChat: (groupId: any, chat: any) => Promise<void>
}) {
  const { getState, activeChatFromData, saveMetaOnly, saveSplitData, saveRoleChat, saveGroupChat } = deps

  function syncDraftUiToData() {
    const state = getState()
    if (!state?.data) return null
    if (!state.data.ui || typeof state.data.ui !== 'object') state.data.ui = {}
    state.data.ui.activeRoleId = String(state.draft?.activeRoleId || '')
    ;(state.data.ui as any).activeGroupId = String(state.draft?.activeGroupId || '')
    ;(state.data.ui as any).activeTargetKind = String(state.draft?.activeTargetKind || '') === 'group' ? 'group' : 'role'
    return state
  }

  async function saveMeta() {
    const state = syncDraftUiToData()
    if (!state) return
    await saveMetaOnly()
  }

  async function saveCurrentChat() {
    const state = syncDraftUiToData()
    if (!state) return
    await saveMetaOnly()

    const kind = String(state.draft?.activeTargetKind || '') === 'group' ? 'group' : 'role'
    const targetId = kind === 'group' ? String(state.draft?.activeGroupId || '') : String(state.draft?.activeRoleId || '')
    const chat = activeChatFromData()
    if (!targetId || !chat) return
    if (kind === 'group') await saveGroupChat(targetId, chat)
    else await saveRoleChat(targetId, chat)
  }

  async function saveDataTree() {
    const state = syncDraftUiToData()
    if (!state) return
    await saveSplitData(state.data)
  }

  return {
    saveMeta,
    saveCurrentChat,
    saveDataTree,
  }
}
