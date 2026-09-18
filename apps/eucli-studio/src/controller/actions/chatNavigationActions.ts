import { clamp } from '../../core/utils'
import { removeDraftFile, removeDraftImage as removeDraftImageFromList } from '../../domain/draftFileUtils'
import {
  activateComposerDraftForCurrentSession,
  saveActiveComposerDraftMirror,
  setActiveComposerFiles,
  setActiveComposerImages,
  setActiveComposerInput,
} from '../../domain/sessionComposerDrafts'

export function createChatNavigationActions(deps: {
  state: any
  emit: () => void
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
  addDraftFilesFromFiles: (files: File[]) => any
}) {
  const { state, emit, saveMeta, ensureActiveChatLoaded, ensureChatsBoxBare, ensureGroupChatsBoxBare, setActiveWorkspace, setWorkspaceRole, createChatForActiveTarget, pickChatForActiveTarget, pickDraftImages, addDraftImagesFromFiles, addDraftFilesFromFiles } = deps

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
      emit()
    },
    removeDraftFile: (id: any) => {
      const draft = activateComposerDraftForCurrentSession(state)
      setActiveComposerFiles(state, removeDraftFile(draft.files, String(id || '')))
      emit()
    },
    setDraftFileSendPct: (id: any, pct: any) => {
      const rid = String(id || '')
      if (!rid) return
      const draft = activateComposerDraftForCurrentSession(state)
      const it = draft.files.find((x: any) => String(x?.id || '') === rid)
      if (!it) return
      it.sendPct = clamp(Math.round(Number(pct ?? 100)), 0, 100)
      setActiveComposerFiles(state, draft.files)
      emit()
    },
    pickDraftImages: () => pickDraftImages(),
    addDraftImagesFromFiles: async (files: any) => {
      await addDraftImagesFromFiles(Array.isArray(files) ? files : [])
    },
    addDraftFilesFromFiles: async (files: any) => {
      await addDraftFilesFromFiles(Array.isArray(files) ? files : [])
    },
  }
}
