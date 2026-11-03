import { GLOBAL_REFRESH_SCOPE, refreshScopes } from '../../domain/uiRefreshScope'
import {
  activateComposerDraftForCurrentSession,
  saveActiveComposerDraftMirror,
} from '../../domain/sessionComposerDrafts'
import { createDraftActions } from './draftActions'

export function createChatNavigationActions(deps: {
  state: any
  emitScope: (scope: string) => void
  saveMeta: () => Promise<any>
  ensureActiveChatLoaded: () => Promise<any>
  ensureChatsBoxBare: (roleId: string) => any
  ensureGroupChatsBoxBare: (groupId: string) => any
  setActiveWorkspace: (workspaceId: any) => any
  setWorkspaceRole: (roleId: any) => any
  createChatForActiveTarget: () => any
  pickChatForActiveTarget: (chatId: any) => any
  pickDraftImages: () => any
  addDraftImagesFromFiles: (files: File[]) => any
}) {
  const { state, emitScope, saveMeta, ensureActiveChatLoaded, ensureChatsBoxBare, ensureGroupChatsBoxBare, setActiveWorkspace, setWorkspaceRole, createChatForActiveTarget, pickChatForActiveTarget, pickDraftImages, addDraftImagesFromFiles } = deps
  const draftActions = createDraftActions({ state, emitScope })

  function notifyScopes(scopes: readonly string[]) {
    const addresses = scopes.filter((scope) => scope && scope !== GLOBAL_REFRESH_SCOPE)
    for (const address of addresses) emitScope(address)
  }

  function notifyLoadedChat(kind: 'role' | 'group', targetId: string, box: any) {
    const chatId = String(box?.activeChatId || '').trim()
    if (!targetId || !chatId) return
    const activeKind = String(state.draft?.activeTargetKind || state.data?.ui?.activeTargetKind || 'role')
    const activeTargetId = kind === 'group'
      ? String(state.draft?.activeGroupId || '')
      : String(state.draft?.activeRoleId || '')
    if (activeKind !== kind || activeTargetId !== targetId) return
    notifyScopes([
      refreshScopes.navigation(),
      refreshScopes.session(kind, targetId, chatId),
    ])
  }

  return {
    setActiveRole: (roleId: any) => {
      const targetId = String(roleId || '')
      saveActiveComposerDraftMirror(state)
      state.branchDraft = null
      ;(state.draft as any).activeTargetKind = 'role'
      state.draft.activeRoleId = targetId
      const box = ensureChatsBoxBare(targetId)
      activateComposerDraftForCurrentSession(state)
      notifyScopes([
        refreshScopes.navigation(),
        refreshScopes.composer(),
      ])
      ensureActiveChatLoaded().catch(() => {}).finally(() => notifyLoadedChat('role', targetId, box))
      saveMeta().catch(() => {})
    },
    setActiveGroup: (groupId: any) => {
      const targetId = String(groupId || '')
      saveActiveComposerDraftMirror(state)
      state.branchDraft = null
      ;(state.draft as any).activeTargetKind = 'group'
      ;(state.draft as any).activeGroupId = targetId
      const box = ensureGroupChatsBoxBare(targetId)
      activateComposerDraftForCurrentSession(state)
      notifyScopes([
        refreshScopes.navigation(),
        refreshScopes.composer(),
      ])
      ensureActiveChatLoaded().catch(() => {}).finally(() => notifyLoadedChat('group', targetId, box))
      saveMeta().catch(() => {})
    },
    setActiveWorkspace: (workspaceId: any) => {
      setActiveWorkspace(workspaceId)
    },
    setWorkspaceRole: (roleId: any) => {
      setWorkspaceRole(roleId)
    },
    setActiveChat: (chatId: any) => {
      saveActiveComposerDraftMirror(state)
      state.branchDraft = null
      Promise.resolve(pickChatForActiveTarget(String(chatId || ''))).catch(() => {})
    },
    createChat: () => {
      return createChatForActiveTarget()
    },
    ...draftActions,
    pickDraftImages: () => pickDraftImages(),
    addDraftImagesFromFiles: async (files: any) => {
      await addDraftImagesFromFiles(Array.isArray(files) ? files : [])
    },
  }
}
