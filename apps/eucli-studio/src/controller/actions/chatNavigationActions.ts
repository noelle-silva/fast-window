import { removeDraftImage as removeDraftImageFromList } from '../../domain/draftImageUtils'
import { COMPOSER_REFRESH_SCOPE } from '../../domain/uiRefreshScope'
import {
  activateComposerDraftForCurrentSession,
  saveActiveComposerDraftMirror,
  setActiveComposerImages,
  setActiveComposerInput,
} from '../../domain/sessionComposerDrafts'

export function createChatNavigationActions(deps: {
  state: any
  emit: () => void
  emitScope?: (scope: string) => void
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
  const { state, emit, emitScope, saveMeta, ensureActiveChatLoaded, ensureChatsBoxBare, ensureGroupChatsBoxBare, setActiveWorkspace, setWorkspaceRole, createChatForActiveTarget, pickChatForActiveTarget, pickDraftImages, addDraftImagesFromFiles } = deps

  return {
    setActiveRole: (roleId: any) => {
      saveActiveComposerDraftMirror(state)
      state.branchDraft = null
      ;(state.draft as any).activeTargetKind = 'role'
      state.draft.activeRoleId = String(roleId || '')
      ensureChatsBoxBare(state.draft.activeRoleId)
      activateComposerDraftForCurrentSession(state)
      ensureActiveChatLoaded().catch(() => {}).finally(() => emit())
      saveMeta().catch(() => {})
      emit()
    },
    setActiveGroup: (groupId: any) => {
      saveActiveComposerDraftMirror(state)
      state.branchDraft = null
      ;(state.draft as any).activeTargetKind = 'group'
      ;(state.draft as any).activeGroupId = String(groupId || '')
      ensureGroupChatsBoxBare((state.draft as any).activeGroupId)
      activateComposerDraftForCurrentSession(state)
      ensureActiveChatLoaded().catch(() => {}).finally(() => emit())
      saveMeta().catch(() => {})
      emit()
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
    setDraft: (key: any, value: any) => {
      const k = String(key || '')
      if (!k) return
      if (k === 'input') {
        // 输入草稿由输入区本地状态承载，这里只写数据不广播：
        // 若在此广播，输入区每次按键都会被外部刷新重置，选择器会被顶掉。
        setActiveComposerInput(state, value)
        return
      }
      if ((k === 'workspaceName' || k === 'workspacePrompt') && state.modal === 'workspace') {
        ;(state.draft as any).workspaceActualPromptStale = true
        ;(state.draft as any).workspaceActualPromptError = ''
      }
      ;(state.draft as any)[k] = value
      emit()
    },
    removeDraftImage: (id: any) => {
      const draft = activateComposerDraftForCurrentSession(state)
      setActiveComposerImages(state, removeDraftImageFromList(draft.images, String(id || '')))
      // 草稿图片只该动输入区，走 composer 范围，不惊动整页。
      if (emitScope) emitScope(COMPOSER_REFRESH_SCOPE)
      else emit()
    },
    pickDraftImages: () => pickDraftImages(),
    addDraftImagesFromFiles: async (files: any) => {
      await addDraftImagesFromFiles(Array.isArray(files) ? files : [])
    },
  }
}
