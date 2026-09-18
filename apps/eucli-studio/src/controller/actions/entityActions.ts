import { NEW_ROLE_ID, NEW_GROUP_ID, NEW_WORKSPACE_ID } from '../../domain/constants'
import { moveListItemById, type ListMovePosition } from '../../domain/listOrdering'
import type { AiChatShowToast } from '../../gateway/capabilities'

export function createEntityActions(deps: {
  state: any
  emit: () => void
  saveMeta: () => Promise<any>
  showToast?: AiChatShowToast
  getProvider: (providerId: string) => any
  closeModal: () => void
  saveRoleOrder: (roleIds: string[]) => Promise<any>
  openProvidersEditor: () => any
  openProviderInlineEditor: (providerId: string) => any
  saveProviderInlineEditor: () => any
  createProvider: () => any
  deleteProvider: (providerId: string) => Promise<boolean>
  openRoleEditor: (roleId: string) => any
  createRole: () => any
  saveRoleEditor: () => any
  deleteRole: (roleId: string) => Promise<boolean>
  openGroupEditor: (groupId: string) => any
  createGroup: () => any
  saveGroupEditor: () => any
  deleteGroup: (groupId: string) => Promise<boolean>
  openWorkspaceEditor: (workspaceId: string) => any
  openNewWorkspaceEditor: () => any
  saveWorkspaceEditor: () => any
  deleteWorkspaceEditor: (workspaceId: string) => Promise<boolean>
  addWorkspaceDirectory: () => any
  removeWorkspaceDirectory: (index: any) => any
  setWorkspaceDirectoryField: (index: any, field: any, value: any) => any
  refreshWorkspacePromptPreview: () => any
  pickRoleAvatarImage: () => any
  clearRoleAvatarImage: () => any
  pickGroupAvatarImage: () => any
  clearGroupAvatarImage: () => any
  renameChatTitle: (roleId: string, chatId: string, title: string) => any
  renameGroupChatTitle: (groupId: string, chatId: string, title: string) => any
  renameWorkspaceChatTitle: (workspaceId: string, chatId: string, title: string) => any
  deleteChatForRole: (roleId: string, chatId: string) => any
  deleteChatForGroup: (groupId: string, chatId: string) => any
  deleteChatForWorkspace: (workspaceId: string, chatId: string) => any
}) {
  const { state, emit, saveMeta, showToast, getProvider, closeModal, saveRoleOrder, openProvidersEditor, openProviderInlineEditor, saveProviderInlineEditor, createProvider, deleteProvider, openRoleEditor, createRole, saveRoleEditor, deleteRole, openGroupEditor, createGroup, saveGroupEditor, deleteGroup, openWorkspaceEditor, openNewWorkspaceEditor, saveWorkspaceEditor, deleteWorkspaceEditor, addWorkspaceDirectory, removeWorkspaceDirectory, setWorkspaceDirectoryField, refreshWorkspacePromptPreview, pickRoleAvatarImage, clearRoleAvatarImage, pickGroupAvatarImage, clearGroupAvatarImage, renameChatTitle, renameGroupChatTitle, renameWorkspaceChatTitle, deleteChatForRole, deleteChatForGroup, deleteChatForWorkspace } = deps

  return {
    closeModal: () => closeModal(),
    openProviders: () => openProvidersEditor(),
    createProvider: () => createProvider(),
    openProviderEditor: (providerId: any) => openProviderInlineEditor(String(providerId || '')),
    closeProviderEditor: () => {
      state.draft.editProviderId = ''
      emit()
    },
    saveProvider: () => saveProviderInlineEditor(),
    moveRole: (roleId: any, targetRoleId: any, position: any) => {
      if (!state.data || !Array.isArray(state.data.roles)) return
      const rid = String(roleId || '').trim()
      const targetRid = String(targetRoleId || '').trim()
      const pos: ListMovePosition = String(position || '').trim() === 'after' ? 'after' : 'before'
      if (!rid || !targetRid || rid === targetRid) return

      const nextRoles = moveListItemById(state.data.roles, (role: any) => String(role?.id || ''), rid, targetRid, pos)
      if (nextRoles === state.data.roles) return

      state.data.roles = nextRoles
      saveRoleOrder(state.data.roles.map((role: any) => String(role?.id || ''))).catch(() => {})
      emit()
    },
    askDeleteProvider: (providerId: any) => {
      state.draft.deleteProviderId = String(providerId || '')
      state.draft.deleteRoleId = ''
      ;(state.draft as any).deleteGroupId = ''
      state.modal = 'confirm'
      emit()
    },
    openRoleEditor: (roleId: any) => openRoleEditor(String(roleId || '')),
    createRole: () => createRole(),
    saveRole: () => saveRoleEditor(),
    openGroupEditor: (groupId: any) => openGroupEditor(String(groupId || '')),
    createGroup: () => createGroup(),
    saveGroup: () => saveGroupEditor(),
    openWorkspaceEditor: (workspaceId: any) => openWorkspaceEditor(String(workspaceId || '')),
    openNewWorkspaceEditor: () => openNewWorkspaceEditor(),
    saveWorkspace: () => saveWorkspaceEditor(),
    addWorkspaceDirectory: () => addWorkspaceDirectory(),
    removeWorkspaceDirectory: (index: any) => removeWorkspaceDirectory(index),
    setWorkspaceDirectoryField: (index: any, field: any, value: any) => setWorkspaceDirectoryField(index, field, value),
    refreshWorkspacePromptPreview: () => refreshWorkspacePromptPreview(),
    askDeleteRole: (roleId: any) => {
      const rid = String(roleId || '')
      if (!rid || rid === NEW_ROLE_ID) return
      state.draft.deleteRoleId = rid
      ;(state.draft as any).deleteGroupId = ''
      state.draft.deleteProviderId = ''
      state.modal = 'confirm'
      emit()
    },
    askDeleteGroup: (groupId: any) => {
      const gid = String(groupId || '')
      if (!gid || gid === NEW_GROUP_ID) return
      ;(state.draft as any).deleteGroupId = gid
      state.draft.deleteRoleId = ''
      state.draft.deleteProviderId = ''
      state.modal = 'confirm'
      emit()
    },
    askDeleteWorkspace: (workspaceId: any) => {
      const wid = String(workspaceId || '')
      if (!wid || wid === NEW_WORKSPACE_ID) return
      ;(state.draft as any).deleteWorkspaceId = wid
      state.draft.deleteRoleId = ''
      ;(state.draft as any).deleteGroupId = ''
      state.draft.deleteProviderId = ''
      state.modal = 'confirm'
      emit()
    },
    confirmDelete: async () => {
      const rid = String(state.draft.deleteRoleId || '')
      const gid = String((state.draft as any).deleteGroupId || '')
      const wid = String((state.draft as any).deleteWorkspaceId || '')
      const pid = String(state.draft.deleteProviderId || '')
      const nextRenderSafetyPolicy = String((state.draft as any).renderSafetyPolicyTarget || '').trim() === 'unsafe' ? 'unsafe' : ''
      let ok = true
      if (rid) ok = await deleteRole(rid)
      if (gid) ok = await deleteGroup(gid)
      if (wid) ok = await deleteWorkspaceEditor(wid)
      if (pid) ok = await deleteProvider(pid)
      if (nextRenderSafetyPolicy && state.data) {
        ;(state.data.settings as any).renderSafetyPolicy = nextRenderSafetyPolicy
        await saveMeta().catch((e: any) => {
          ok = false
          showToast?.(String(e?.message || e || '保存渲染安全策略失败'), { kind: 'error' })
        })
      }
      if (ok) {
        closeModal()
      }
      emit()
    },
    renameChat: (roleId: any, chatId: any, title: any) => renameChatTitle(String(roleId || ''), String(chatId || ''), String(title ?? '')),
    renameGroupChat: (groupId: any, chatId: any, title: any) => renameGroupChatTitle(String(groupId || ''), String(chatId || ''), String(title ?? '')),
    renameWorkspaceChat: (workspaceId: any, chatId: any, title: any) => renameWorkspaceChatTitle(String(workspaceId || ''), String(chatId || ''), String(title ?? '')),
    deleteChat: (roleId: any, chatId: any) => deleteChatForRole(String(roleId || ''), String(chatId || '')),
    deleteGroupChat: (groupId: any, chatId: any) => deleteChatForGroup(String(groupId || ''), String(chatId || '')),
    deleteWorkspaceChat: (workspaceId: any, chatId: any) => deleteChatForWorkspace(String(workspaceId || ''), String(chatId || '')),
    roleProviderChanged: (providerId: any) => {
      state.draft.roleProviderId = String(providerId || '')
      const p = getProvider(state.draft.roleProviderId)
      const cachedItems = Array.isArray(p?.registeredModels) ? p.registeredModels.map((model: any) => String(model?.id || '')).filter(Boolean) : []
      state.models = { loading: false, error: '', items: cachedItems.slice(0, 300) }
      state.draft.roleModelId = ''
      state.draft.roleCustomModelId = ''
      emit()
    },
    roleModelSourceChanged: (source: any) => {
      state.draft.roleModelSource = String(source || '') === 'model_group' ? 'model_group' : 'provider'
      state.draft.roleProviderId = ''
      state.draft.roleModelGroupId = ''
      state.draft.roleModelId = ''
      state.draft.roleCustomModelId = ''
      state.models = { loading: false, error: '', items: [] }
      emit()
    },
    roleModelGroupChanged: (groupId: any) => {
      state.draft.roleModelGroupId = String(groupId || '')
      state.draft.roleModelId = ''
      state.draft.roleCustomModelId = ''
      emit()
    },
    roleModelChanged: (modelId: any) => {
      state.draft.roleModelId = String(modelId || '')
      emit()
    },
    pickRoleAvatarImage: () => pickRoleAvatarImage(),
    clearRoleAvatarImage: () => clearRoleAvatarImage(),
    pickGroupAvatarImage: () => pickGroupAvatarImage(),
    clearGroupAvatarImage: () => clearGroupAvatarImage(),
  }
}
