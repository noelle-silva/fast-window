import { NEW_ROLE_ID, NEW_GROUP_ID, NEW_WORKSPACE_ID } from '../../domain/constants'
import { moveListItemById, type ListMovePosition } from '../../domain/listOrdering'
import { normalizeModelRef } from '../../domain/modelRefUtils'
import { addRoleModelCandidate, modelCandidateKey, normalizeDefaultCandidateId, normalizeRoleModelCandidates, removeRoleModelCandidate } from '../../domain/roleModelCandidates'
import type { AiChatShowToast } from '../../gateway/capabilities'
import { GLOBAL_REFRESH_SCOPE, refreshScopes } from '../../domain/uiRefreshScope'
import { deleteConfirmationScopes, type EntityDeleteOptions } from '../entityDeleteNotification'

export function createEntityActions(deps: {
  state: any
  emitScope: (scope: string) => void
  saveMeta: () => Promise<any>
  showToast?: AiChatShowToast
  getProvider: (providerId: string) => any
  closeModal: (options?: { notify?: boolean }) => void
  reorderRoles: (roleIds: string[]) => Promise<void>
  reorderProviders: (providerIds: string[]) => Promise<void>
  moveWorkspace: (workspaceId: string, targetWorkspaceId: string, position: ListMovePosition) => Promise<void>
  openProvidersEditor: () => any
  openProviderInlineEditor: (providerId: string) => any
  saveProviderInlineEditor: () => any
  createProvider: () => any
  deleteProvider: (providerId: string, options?: EntityDeleteOptions) => Promise<boolean>
  openRoleEditor: (roleId: string) => any
  openRoleEditorInPlace: (roleId: string) => any
  createRole: () => any
  createRoleInPlace: () => any
  saveRoleEditor: () => any
  deleteRole: (roleId: string, options?: EntityDeleteOptions) => Promise<boolean>
  openGroupEditor: (groupId: string) => any
  openGroupEditorInPlace: (groupId: string) => any
  createGroup: () => any
  createGroupInPlace: () => any
  saveGroupEditor: () => any
  deleteGroup: (groupId: string, options?: EntityDeleteOptions) => Promise<boolean>
  openWorkspaceEditor: (workspaceId: string) => any
  openWorkspaceEditorInPlace: (workspaceId: string) => any
  openNewWorkspaceEditor: () => any
  createWorkspaceInPlace: () => any
  saveWorkspaceEditor: () => any
  deleteWorkspaceEditor: (workspaceId: string, options?: EntityDeleteOptions) => Promise<boolean>
  addWorkspaceDirectory: () => any
  removeWorkspaceDirectory: (index: any) => any
  setWorkspaceDirectoryField: (index: any, field: any, value: any) => any
  setWorkspaceRoleRegistered: (roleId: any, registered: any) => any
  refreshWorkspacePromptPreview: () => any
  pickRoleAvatarImage: () => any
  clearRoleAvatarImage: () => any
  pickGroupAvatarImage: () => any
  clearGroupAvatarImage: () => any
  renameChatTitle: (roleId: string, chatId: string, title: string) => any
  renameGroupChatTitle: (groupId: string, chatId: string, title: string) => any
  renameWorkspaceChatTitle: (workspaceId: string, roleId: string, chatId: string, title: string) => any
  deleteChatForRole: (roleId: string, chatId: string) => any
  deleteChatForGroup: (groupId: string, chatId: string) => any
  deleteChatForWorkspace: (workspaceId: string, roleId: string, chatId: string) => any
}) {
  const { state, emitScope, saveMeta, showToast, getProvider, closeModal, reorderRoles, reorderProviders, moveWorkspace, openProvidersEditor, openProviderInlineEditor, saveProviderInlineEditor, createProvider, deleteProvider, openRoleEditor, openRoleEditorInPlace, createRole, createRoleInPlace, saveRoleEditor, deleteRole, openGroupEditor, openGroupEditorInPlace, createGroup, createGroupInPlace, saveGroupEditor, deleteGroup, openWorkspaceEditor, openWorkspaceEditorInPlace, openNewWorkspaceEditor, createWorkspaceInPlace, saveWorkspaceEditor, deleteWorkspaceEditor, addWorkspaceDirectory, removeWorkspaceDirectory, setWorkspaceDirectoryField, setWorkspaceRoleRegistered, refreshWorkspacePromptPreview, pickRoleAvatarImage, clearRoleAvatarImage, pickGroupAvatarImage, clearGroupAvatarImage, renameChatTitle, renameGroupChatTitle, renameWorkspaceChatTitle, deleteChatForRole, deleteChatForGroup, deleteChatForWorkspace } = deps
  let roleMoveSeq = 0
  let providerMoveSeq = 0

  function notifyScopes(scopes: readonly string[]) {
    const addresses = new Set(scopes.filter((scope) => scope && scope !== GLOBAL_REFRESH_SCOPE))
    for (const address of addresses) emitScope(address)
  }

  return {
    closeModal: () => closeModal(),
    openProviders: () => openProvidersEditor(),
    createProvider: () => createProvider(),
    openProviderEditor: (providerId: any) => openProviderInlineEditor(String(providerId || '')),
    closeProviderEditor: () => {
      state.draft.editProviderId = ''
      notifyScopes([refreshScopes.uiShell()])
    },
    saveProvider: () => saveProviderInlineEditor(),
    moveRole: async (roleId: any, targetRoleId: any, position: any) => {
      if (!state.data || !Array.isArray(state.data.roles)) return
      const rid = String(roleId || '').trim()
      const targetRid = String(targetRoleId || '').trim()
      const pos: ListMovePosition = String(position || '').trim() === 'after' ? 'after' : 'before'
      if (!rid || !targetRid || rid === targetRid) return

      const previousRoles = state.data.roles
      const nextRoles = moveListItemById(previousRoles, (role: any) => String(role?.id || ''), rid, targetRid, pos)
      if (nextRoles === previousRoles) return

      const seq = ++roleMoveSeq
      state.data.roles = nextRoles
      notifyScopes([refreshScopes.entities('roles')])
      try {
        await reorderRoles(nextRoles.map((role: any) => String(role?.id || '')))
      } catch (e: any) {
        // 快速连续拖拽时，旧请求失败不能覆盖更新的本地顺序。
        if (seq !== roleMoveSeq) return
        state.data.roles = previousRoles
      notifyScopes([refreshScopes.entities('roles')])
        showToast?.(String(e?.message || e || '角色排序保存失败'), { kind: 'error' })
      }
    },
    moveWorkspace: (workspaceId: any, targetWorkspaceId: any, position: any) =>
      moveWorkspace(String(workspaceId || ''), String(targetWorkspaceId || ''), String(position || '').trim() === 'after' ? 'after' : 'before'),
    moveProvider: async (providerId: any, targetProviderId: any, position: any) => {
      const providers = state.data?.settings?.providers
      if (!Array.isArray(providers)) return
      const pid = String(providerId || '').trim()
      const targetPid = String(targetProviderId || '').trim()
      const pos: ListMovePosition = String(position || '').trim() === 'after' ? 'after' : 'before'
      if (!pid || !targetPid || pid === targetPid) return

      const previous = providers
      const next = moveListItemById(previous, (provider: any) => String(provider?.id || ''), pid, targetPid, pos)
      if (next === previous) return

      const seq = ++providerMoveSeq
      state.data.settings.providers = next
      notifyScopes([refreshScopes.entities('providers')])
      try {
        await reorderProviders(next.map((provider: any) => String(provider?.id || '')))
      } catch (e: any) {
        if (seq !== providerMoveSeq) return
        state.data.settings.providers = previous
      notifyScopes([refreshScopes.entities('providers')])
        showToast?.(String(e?.message || e || '供应商排序保存失败'), { kind: 'error' })
      }
    },
    askDeleteProvider: (providerId: any) => {
      state.draft.deleteProviderId = String(providerId || '')
      state.draft.deleteRoleId = ''
      ;(state.draft as any).deleteGroupId = ''
      state.modal = 'confirm'
      notifyScopes([refreshScopes.uiShell()])
    },
    openRoleEditor: (roleId: any) => openRoleEditor(String(roleId || '')),
    openRoleEditorInPlace: (roleId: any) => openRoleEditorInPlace(String(roleId || '')),
    createRole: () => createRole(),
    createRoleInPlace: () => createRoleInPlace(),
    saveRole: () => saveRoleEditor(),
    openGroupEditor: (groupId: any) => openGroupEditor(String(groupId || '')),
    openGroupEditorInPlace: (groupId: any) => openGroupEditorInPlace(String(groupId || '')),
    createGroup: () => createGroup(),
    createGroupInPlace: () => createGroupInPlace(),
    saveGroup: () => saveGroupEditor(),
    openWorkspaceEditor: (workspaceId: any) => openWorkspaceEditor(String(workspaceId || '')),
    openWorkspaceEditorInPlace: (workspaceId: any) => openWorkspaceEditorInPlace(String(workspaceId || '')),
    openNewWorkspaceEditor: () => openNewWorkspaceEditor(),
    createWorkspaceInPlace: () => createWorkspaceInPlace(),
    saveWorkspace: () => saveWorkspaceEditor(),
    addWorkspaceDirectory: () => addWorkspaceDirectory(),
    removeWorkspaceDirectory: (index: any) => removeWorkspaceDirectory(index),
    setWorkspaceDirectoryField: (index: any, field: any, value: any) => setWorkspaceDirectoryField(index, field, value),
    setWorkspaceRoleRegistered: (roleId: any, registered: any) => setWorkspaceRoleRegistered(String(roleId || ''), Boolean(registered)),
    refreshWorkspacePromptPreview: () => refreshWorkspacePromptPreview(),
    askDeleteRole: (roleId: any) => {
      const rid = String(roleId || '')
      if (!rid || rid === NEW_ROLE_ID) return
      state.draft.deleteRoleId = rid
      ;(state.draft as any).deleteGroupId = ''
      state.draft.deleteProviderId = ''
      state.modal = 'confirm'
      notifyScopes([refreshScopes.uiShell()])
    },
    askDeleteGroup: (groupId: any) => {
      const gid = String(groupId || '')
      if (!gid || gid === NEW_GROUP_ID) return
      ;(state.draft as any).deleteGroupId = gid
      state.draft.deleteRoleId = ''
      state.draft.deleteProviderId = ''
      state.modal = 'confirm'
      notifyScopes([refreshScopes.uiShell()])
    },
    askDeleteWorkspace: (workspaceId: any) => {
      const wid = String(workspaceId || '')
      if (!wid || wid === NEW_WORKSPACE_ID) return
      ;(state.draft as any).deleteWorkspaceId = wid
      state.draft.deleteRoleId = ''
      ;(state.draft as any).deleteGroupId = ''
      state.draft.deleteProviderId = ''
      state.modal = 'confirm'
      notifyScopes([refreshScopes.uiShell()])
    },
    confirmDelete: async () => {
      const rid = String(state.draft.deleteRoleId || '')
      const gid = String((state.draft as any).deleteGroupId || '')
      const wid = String((state.draft as any).deleteWorkspaceId || '')
      const pid = String(state.draft.deleteProviderId || '')
      const nextRenderSafetyPolicy = String((state.draft as any).renderSafetyPolicyTarget || '').trim() === 'unsafe' ? 'unsafe' : ''
      const settingsChanged = Boolean(nextRenderSafetyPolicy && state.data)
      let ok = true
      if (rid) ok = await deleteRole(rid, { notify: false })
      if (gid) ok = await deleteGroup(gid, { notify: false })
      if (wid) ok = await deleteWorkspaceEditor(wid, { notify: false })
      if (pid) ok = await deleteProvider(pid, { notify: false })
      if (settingsChanged) {
        ;(state.data.settings as any).renderSafetyPolicy = nextRenderSafetyPolicy
        await saveMeta().catch((e: any) => {
          ok = false
          showToast?.(String(e?.message || e || '保存渲染安全策略失败'), { kind: 'error' })
        })
      }
      if (ok) closeModal({ notify: false })
      notifyScopes(deleteConfirmationScopes({
        role: Boolean(rid),
        group: Boolean(gid),
        workspace: Boolean(wid),
        provider: Boolean(pid),
        settingsChanged,
      }))
    },
    renameChat: (roleId: any, chatId: any, title: any) => renameChatTitle(String(roleId || ''), String(chatId || ''), String(title ?? '')),
    renameGroupChat: (groupId: any, chatId: any, title: any) => renameGroupChatTitle(String(groupId || ''), String(chatId || ''), String(title ?? '')),
    renameWorkspaceChat: (workspaceId: any, roleId: any, chatId: any, title: any) => renameWorkspaceChatTitle(String(workspaceId || ''), String(roleId || ''), String(chatId || ''), String(title ?? '')),
    deleteChat: (roleId: any, chatId: any) => deleteChatForRole(String(roleId || ''), String(chatId || '')),
    deleteGroupChat: (groupId: any, chatId: any) => deleteChatForGroup(String(groupId || ''), String(chatId || '')),
    deleteWorkspaceChat: (workspaceId: any, roleId: any, chatId: any) => deleteChatForWorkspace(String(workspaceId || ''), String(roleId || ''), String(chatId || '')),
    roleProviderChanged: (providerId: any) => {
      state.draft.roleProviderId = String(providerId || '')
      const p = getProvider(state.draft.roleProviderId)
      const cachedItems = Array.isArray(p?.registeredModels) ? p.registeredModels.map((model: any) => String(model?.id || '')).filter(Boolean) : []
      state.models = { loading: false, error: '', items: cachedItems.slice(0, 300) }
      state.draft.roleModelId = ''
      state.draft.roleCustomModelId = ''
      notifyScopes([refreshScopes.uiShell()])
    },
    roleModelSourceChanged: (source: any) => {
      state.draft.roleModelSource = String(source || '') === 'model_group' ? 'model_group' : 'provider'
      notifyScopes([refreshScopes.uiShell()])
    },
    roleModelGroupChanged: (groupId: any) => {
      state.draft.roleModelGroupId = String(groupId || '')
      state.draft.roleModelGroupModelId = ''
      state.draft.roleCustomModelId = ''
      notifyScopes([refreshScopes.uiShell()])
    },
    roleModelChanged: (modelId: any) => {
      const mid = String(modelId || '')
      if (String(state.draft.roleModelSource || '') === 'model_group') state.draft.roleModelGroupModelId = mid
      else state.draft.roleModelId = mid
      notifyScopes([refreshScopes.uiShell()])
    },
    // 把当前选择（来源 + 供应商/模型组 + 模型）作为一个候选加入角色候选池。
    addRoleModelCandidate: () => {
      const modelSource = String(state.draft.roleModelSource || '') === 'model_group' ? 'model_group' : 'provider'
      const ref = modelSource === 'model_group'
        ? { kind: 'model_group', providerId: '', groupId: String(state.draft.roleModelGroupId || '').trim(), modelId: String(state.draft.roleModelGroupModelId || '').trim() }
        : { kind: 'provider', providerId: String(state.draft.roleProviderId || '').trim(), groupId: '', modelId: String(state.draft.roleModelId || '').trim() }
      const normalized = normalizeModelRef(ref)
      if (!normalized) return showToast?.('请先选择要加入的模型', { kind: 'error' })
      const next = addRoleModelCandidate(state.draft.roleModelCandidates, normalized)
      if (next.length === normalizeRoleModelCandidates(state.draft.roleModelCandidates).length) return showToast?.('该模型已在候选池中', { kind: 'error' })
      state.draft.roleModelCandidates = next
      state.draft.roleDefaultModelCandidateId = normalizeDefaultCandidateId(state.draft.roleDefaultModelCandidateId, next)
      notifyScopes([refreshScopes.uiShell()])
    },
    removeRoleModelCandidate: (id: any) => {
      const next = removeRoleModelCandidate(state.draft.roleModelCandidates, id)
      state.draft.roleModelCandidates = next
      state.draft.roleDefaultModelCandidateId = normalizeDefaultCandidateId(state.draft.roleDefaultModelCandidateId, next)
      notifyScopes([refreshScopes.uiShell()])
    },
    setDefaultRoleModelCandidate: (id: any) => {
      const next = normalizeRoleModelCandidates(state.draft.roleModelCandidates)
      const target = String(id || '').trim()
      if (!next.some((candidate) => modelCandidateKey(candidate) === target)) return
      state.draft.roleDefaultModelCandidateId = target
      notifyScopes([refreshScopes.uiShell()])
    },
    pickRoleAvatarImage: () => pickRoleAvatarImage(),
    clearRoleAvatarImage: () => clearRoleAvatarImage(),
    pickGroupAvatarImage: () => pickGroupAvatarImage(),
    clearGroupAvatarImage: () => clearGroupAvatarImage(),
  }
}
