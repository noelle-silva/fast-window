import { now, uid, clamp, clampTemp, normImagePaths } from '../core/utils'
import { createStateAccessors } from '../state/stateAccessors'
import { activeEbRoleRunCards, activeEbRoleRunCardsForSession, activeEbRunCardsForTarget } from '../domain/activeRunCards'
import { chatMetaFromChat } from '../domain/chatMeta'
import { writeChatListProjection } from '../domain/chatListProjection'
import { NEW_GROUP_ID, NEW_PROVIDER_ID, NEW_ROLE_ID } from '../domain/constants'
import { emptyRoleToolPolicy, normalizeRoleToolPolicy } from '../domain/toolPolicy'
import { modelCandidateKey, normalizeDefaultCandidateId, normalizeRoleModelCandidates } from '../domain/roleModelCandidates'
import { clearPendingChatForTarget, createPendingChatEntry } from '../domain/pendingChat'
import type { SessionWriteGuard } from '../storage/sessionWriteGuard'
import { firstChatIdInBox, readActiveChatSelection, writeActiveChatSelection } from '../domain/activeChatSelection'
import { activateComposerDraftForCurrentSession, saveActiveComposerDraftMirror } from '../domain/sessionComposerDrafts'
import type { AiChatShowToast } from '../gateway/capabilities'
import { normalizeReasoningEffort, normalizeReasoningFields } from '../domain/reasoning'
import { refreshScopes } from '../domain/uiRefreshScope'

function looksLikeImageDataUrl(s: any): boolean {
  const t = String(s || '')
  return t.startsWith('data:image/')
}

function shrinkImageDataUrl(dataUrl: string, maxSide: number): Promise<string> {
  return new Promise((resolve) => {
    try {
      const u = String(dataUrl || '').trim()
      if (!looksLikeImageDataUrl(u)) return resolve('')

      const max = clamp(Math.round(Number(maxSide || 0)), 64, 4096)
      const img = new Image()
      img.decoding = 'async'
      img.onload = () => {
        try {
          const w0 = Number(img.naturalWidth || 0)
          const h0 = Number(img.naturalHeight || 0)
          if (!w0 || !h0) return resolve('')

          const s = Math.min(1, max / Math.max(w0, h0))
          const w = Math.max(1, Math.round(w0 * s))
          const h = Math.max(1, Math.round(h0 * s))

          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d')
          if (!ctx) return resolve('')
          ctx.clearRect(0, 0, w, h)
          ctx.drawImage(img, 0, 0, w, h)

          const out = canvas.toDataURL('image/png')
          resolve(looksLikeImageDataUrl(out) ? out : '')
        } catch (_) {
          resolve('')
        }
      }
      img.onerror = () => resolve('')
      img.src = u
    } catch (_) {
      resolve('')
    }
  })
}

function roleSessionHasActiveRun(state: any, roleId: string, sessionId: string): boolean {
  return activeEbRoleRunCardsForSession(state, roleId, sessionId).length > 0
}

function groupSessionHasActiveRun(state: any, groupId: string, sessionId: string): boolean {
  return activeEbRunCardsForTarget(state, 'group', groupId, sessionId).length > 0
}

function groupHasActiveRun(state: any, groupId: string): boolean {
  const gid = String(groupId || '').trim()
  if (!gid) return false
  return activeEbRoleRunCards(state).some((card) => String(card?.groupId || '').trim() === gid)
}

function imageBasename(p: string): string {
  const s = String(p || '')
  const a = s.lastIndexOf('/')
  const b = s.lastIndexOf('\\')
  const i = Math.max(a, b)
  return i >= 0 ? s.slice(i + 1) : s
}

function boxHasChatRef(box: any, chatId: string) {
  if (!chatId) return false
  if (Array.isArray(box?.chatMetas) && box.chatMetas.some((c: any) => String(c?.id || '') === chatId)) return true
  return Array.isArray(box?.chats) && box.chats.some((c: any) => String(c?.id || '') === chatId)
}

export function createEntityEditors(deps: {
  getState: () => any
  save: () => Promise<void>
  saveRoleEntity?: (role: any) => Promise<void>
  removeRoleEntity?: (roleId: any) => Promise<void>
  saveGroupEntity?: (group: any) => Promise<void>
  removeGroupEntity?: (groupId: any) => Promise<void>
  saveProviderEntity?: (provider: any) => Promise<void>
  removeProviderEntity?: (providerId: any) => Promise<void>
  emitScope: (scope: string) => void
  closeModal: () => void
  showToast?: AiChatShowToast
  pickImageFiles?: (maxCount?: number) => Promise<any[]>
  filesImages: { delete?: (req: any) => Promise<any> }
  ensureChatLoaded?: (rid: string, cid: string) => Promise<any>
  ensureGroupChatLoaded?: (gid: string, cid: string) => Promise<any>
  renameRoleChatInStore?: (rid: string, cid: string, title: string) => Promise<void>
  renameGroupChatInStore?: (gid: string, cid: string, title: string) => Promise<void>
  removeChatInStore?: (kind: 'role' | 'group', targetId: string, chatId: string) => Promise<void>
  setRoleActiveChatSelection?: (roleId: string, chatId: string) => Promise<void>
  setGroupActiveChatSelection?: (groupId: string, chatId: string) => Promise<void>
  removeLoadedChat?: (kind: 'role' | 'group', targetId: string, chatId: string) => void
  // 删除会话 / 实体时推进代数并作废缓存：删除之前发起的读写不得回填。
  onChatDeleted?: (kind: 'role' | 'group', targetId: string, chatId: string) => void
  onTargetDeleted?: (kind: 'role' | 'group', targetId: string) => void
  // 重命名回包也要带代数：期间会话被删除，旧标题不能把会话重新写回列表。
  sessionWrites?: SessionWriteGuard
  cleanupFavoriteRefsForTarget: (kind: string, targetId: string) => void
  cleanupFavoriteRefsForChat: (targetKind: string, targetId: string, roleId: string, chatId: string) => void
}) {
  const { getState, save, saveRoleEntity, removeRoleEntity, saveGroupEntity, removeGroupEntity, saveProviderEntity, removeProviderEntity, emitScope, closeModal, showToast, pickImageFiles, filesImages, ensureChatLoaded, ensureGroupChatLoaded, renameRoleChatInStore, renameGroupChatInStore, removeChatInStore, setRoleActiveChatSelection, setGroupActiveChatSelection, removeLoadedChat, onChatDeleted, onTargetDeleted, sessionWrites, cleanupFavoriteRefsForTarget, cleanupFavoriteRefsForChat } = deps
  const sa = createStateAccessors({ getState })

  function scrollToBottomSoon() {
    // UI 负责滚动逻辑（React）
  }

  function notifyScopes(scopes: readonly string[]) {
    for (const scope of scopes) {
      if (scope) emitScope(scope)
    }
  }

  function notifyChatSelected(kind: 'role' | 'group', targetId: string, chatId: string) {
    if (!targetId || !chatId) return
    notifyScopes([
      refreshScopes.navigation(),
      refreshScopes.composer(),
      refreshScopes.chatList(kind, targetId),
    ])
  }

  function notifyChatLoaded(kind: 'role' | 'group', targetId: string, chatId: string) {
    if (!targetId || !chatId) return
    notifyScopes([
      refreshScopes.session(kind, targetId, chatId),
      refreshScopes.chatList(kind, targetId),
    ])
  }

  function loadPickedChatInBackground(kind: 'role' | 'group', targetId: string, chatId: string, load?: (targetId: string, chatId: string) => Promise<any>) {
    if (typeof load !== 'function') return
    Promise.resolve()
      .then(() => load(targetId, chatId))
      .then((chat) => {
        const state = getState()
        if (!state.data) return
        const box = kind === 'group' ? (state.data as any).chatsByGroup?.[targetId] : state.data.chatsByRole?.[targetId]
        const stillActive = String(box?.activeChatId || '') === chatId
        if (stillActive) notifyChatLoaded(kind, targetId, chatId)
        if (stillActive && chat) scrollToBottomSoon()
      })
      .catch((error: any) => {
        const state = getState()
        const box = kind === 'group' ? (state.data as any)?.chatsByGroup?.[targetId] : state.data?.chatsByRole?.[targetId]
        if (String(box?.activeChatId || '') !== chatId) return
        showToast?.(String(error?.message || error || '会话加载失败'), { kind: 'error' })
        notifyScopes([refreshScopes.session(kind, targetId, chatId)])
      })
  }

  // ===== Avatar =====

  async function pickRoleAvatarImage() {
    const state = getState()
    if (state.loading) return
    if (typeof pickImageFiles !== 'function') return showToast?.('未授权：files.pickImages', { kind: 'error' })

    try {
      const items = await pickImageFiles(1)
      const list = Array.isArray(items) ? items : []
      const it = list.length ? list[0] : null
      const u0 = String(it?.dataUrl || '')
      if (!looksLikeImageDataUrl(u0)) return showToast?.('未选择图片', { kind: 'error' })

      const shrunk = await shrinkImageDataUrl(u0, 1024)
      const u = shrunk || u0
      if (!looksLikeImageDataUrl(u)) return showToast?.('头像图片无效', { kind: 'error' })

      state.draft.roleAvatarImageCropSrc = u
    notifyScopes([refreshScopes.uiShell()])
    } catch (e: any) {
      showToast?.(String(e?.message || e || '选择头像失败'), { kind: 'error' })
    }
  }

  function clearRoleAvatarImage() {
    const state = getState()
    state.draft.roleAvatarImage = ''
    state.draft.roleAvatarImageCropSrc = ''
    notifyScopes([refreshScopes.uiShell()])
  }

  async function pickGroupAvatarImage() {
    const state = getState()
    if (state.loading) return
    if (typeof pickImageFiles !== 'function') return showToast?.('未授权：files.pickImages', { kind: 'error' })

    try {
      const items = await pickImageFiles(1)
      const list = Array.isArray(items) ? items : []
      const it = list.length ? list[0] : null
      const u0 = String(it?.dataUrl || '')
      if (!looksLikeImageDataUrl(u0)) return showToast?.('未选择图片', { kind: 'error' })

      const shrunk = await shrinkImageDataUrl(u0, 1024)
      const u = shrunk || u0
      if (!looksLikeImageDataUrl(u)) return showToast?.('头像图片无效', { kind: 'error' })

      ;(state.draft as any).groupAvatarImageCropSrc = u
    notifyScopes([refreshScopes.uiShell()])
    } catch (e: any) {
      showToast?.(String(e?.message || e || '选择头像失败'), { kind: 'error' })
    }
  }

  function clearGroupAvatarImage() {
    const state = getState()
    ;(state.draft as any).groupAvatarImage = ''
    ;(state.draft as any).groupAvatarImageCropSrc = ''
    notifyScopes([refreshScopes.uiShell()])
  }

  // ===== Role CRUD =====

  function populateNewRoleDraft() {
    const state = getState()
    if (!state.data) return false
    const fallbackPid = String(state.data.settings.providers?.[0]?.id || '')

    state.draft.editRoleId = NEW_ROLE_ID
    state.draft.roleName = '新角色'
    state.draft.roleAvatarImage = ''
    state.draft.roleAvatarImageCropSrc = ''
    state.draft.roleSystemPrompt = ''
    state.draft.roleTemperature = '1'
    state.draft.roleTemperatureEnabled = false
    ;(state.draft as any).roleHookPromptPresetId = ''
    state.draft.roleModelCandidates = []
    state.draft.roleDefaultModelCandidateId = ''
    state.draft.roleModelSource = 'provider'
    state.draft.roleProviderId = fallbackPid
    state.draft.roleModelGroupId = ''
    state.draft.roleModelGroupModelId = ''
    state.draft.roleToolPolicy = emptyRoleToolPolicy()
    state.draft.roleToolAddOpen = false
    state.draft.roleToolSearch = ''
    state.draft.roleToolAddSelected = []

    const p = sa.getProvider(fallbackPid)
    const cachedItems = Array.isArray(p?.registeredModels) ? p.registeredModels.map((model: any) => String(model?.id || '')).filter(Boolean) : []
    state.models = { loading: false, error: '', items: cachedItems.slice(0, 300) }
    state.draft.roleModelId = ''
    return true
  }

  function openNewRoleEditor() {
    if (!populateNewRoleDraft()) return
    ;(getState().draft as any).roleEditorInPlace = false
    getState().modal = 'role'
    notifyScopes([refreshScopes.uiShell()])
  }

  function createRole() {
    openNewRoleEditor()
  }

  function openNewRoleEditorInPlace() {
    if (!populateNewRoleDraft()) return
    ;(getState().draft as any).roleEditorInPlace = true
    notifyScopes([refreshScopes.uiShell()])
  }

  function openRoleEditor(roleId: any) {
    if (!populateRoleDraft(roleId)) return
    ;(getState().draft as any).roleEditorInPlace = false
    getState().modal = 'role'
    notifyScopes([refreshScopes.uiShell()])
  }

  function openRoleEditorInPlace(roleId: any) {
    if (!populateRoleDraft(roleId)) return
    ;(getState().draft as any).roleEditorInPlace = true
    notifyScopes([refreshScopes.uiShell()])
  }

  function populateRoleDraft(roleId: any) {
    const state = getState()
    if (!state.data) return false
    const rid = String(roleId || '')
    const role = state.data.roles.find((r: any) => String(r?.id) === rid)
    if (!role) return false
    sa.ensureRoleDefaults(role)

    state.draft.editRoleId = rid
    state.draft.roleName = String(role.name || '')
    state.draft.roleAvatarImage = looksLikeImageDataUrl(role.avatarImage) ? String(role.avatarImage || '') : ''
    state.draft.roleAvatarImageCropSrc = ''
    state.draft.roleSystemPrompt = String(role.systemPrompt || '')
    state.draft.roleTemperature = String(role.temperature ?? 1)
    state.draft.roleTemperatureEnabled = role.temperatureEnabled === true
    ;(state.draft as any).roleHookPromptPresetId = String(role.hookPromptPresetId || '')
    const candidates = normalizeRoleModelCandidates(role.modelCandidates)
    const defaultId = normalizeDefaultCandidateId(role.defaultModelCandidateId, candidates)
    state.draft.roleModelCandidates = candidates
    state.draft.roleDefaultModelCandidateId = defaultId
    const defaultRef = candidates.find((candidate) => modelCandidateKey(candidate) === defaultId) || null
    const modelKind = defaultRef?.kind === 'model_group' ? 'model_group' : 'provider'
    state.draft.roleModelSource = modelKind
    state.draft.roleProviderId = defaultRef?.providerId || ''
    state.draft.roleModelGroupId = defaultRef?.groupId || ''
    state.draft.roleToolPolicy = normalizeRoleToolPolicy(role.toolPolicy)
    state.draft.roleToolAddOpen = false
    state.draft.roleToolSearch = ''
    state.draft.roleToolAddSelected = []
    const curModelId = defaultRef?.modelId || ''

    const p = sa.getProvider(state.draft.roleProviderId)
    const cachedItems = Array.isArray(p?.registeredModels) ? p.registeredModels.map((model: any) => String(model?.id || '')).filter(Boolean) : []
    state.models = { loading: false, error: '', items: cachedItems.slice(0, 300) }

    state.draft.roleModelId = modelKind === 'provider' ? curModelId : ''
    state.draft.roleModelGroupModelId = modelKind === 'model_group' ? curModelId : ''
    return true
  }

  async function saveRoleEditor() {
    const state = getState()
    if (!state.data) return
    const rid = String(state.draft.editRoleId || '')

    const name = String(state.draft.roleName || '').trim() || '未命名角色'
    const avatarImage = looksLikeImageDataUrl(state.draft.roleAvatarImage) ? String(state.draft.roleAvatarImage || '') : ''
    const sys = String(state.draft.roleSystemPrompt || '').trim()
    const temperature = clampTemp(state.draft.roleTemperature)
    const temperatureEnabled = state.draft.roleTemperatureEnabled === true
    const hookPromptPresetId = String((state.draft as any).roleHookPromptPresetId || '').trim()
    const candidates = normalizeRoleModelCandidates(state.draft.roleModelCandidates)
    const defaultCandidateId = normalizeDefaultCandidateId(state.draft.roleDefaultModelCandidateId, candidates)

    if (!sys) return showToast?.('请填写角色系统提示词', { kind: 'error' })
    if (!candidates.length) return showToast?.('请至少添加一个候选模型', { kind: 'error' })
    if (!defaultCandidateId) return showToast?.('请选择一个默认模型', { kind: 'error' })
    const toolPolicy = normalizeRoleToolPolicy(state.draft.roleToolPolicy)

    if (rid === NEW_ROLE_ID) {
      const newRid = uid('r')
      const role = {
        id: newRid,
        name,
        avatarImage,
        systemPrompt: sys,
        temperature,
        temperatureEnabled,
        hookPromptPresetId,
        modelCandidates: candidates,
        defaultModelCandidateId: defaultCandidateId,
        toolPolicy,
        createdAt: now(),
        updatedAt: now(),
      }
      try {
        if (typeof saveRoleEntity !== 'function') throw new Error('角色保存通道不可用')
        await saveRoleEntity(role)
        state.data.roles.unshift(role)
        if (!state.data.chatsByRole || typeof state.data.chatsByRole !== 'object') state.data.chatsByRole = {}
        state.data.chatsByRole[newRid] = { activeChatId: '', chatMetas: [], chats: [] }
        state.draft.activeRoleId = newRid
        showToast?.('角色已保存', { kind: 'success' })
        notifyScopes([refreshScopes.entities('roles')])
        closeModal()
      } catch (e: any) {
        showToast?.(String(e?.message || e || '角色保存失败'), { kind: 'error' })
    notifyScopes([refreshScopes.entities('roles'), refreshScopes.uiShell()])
      }
      return
    }

    const role = state.data.roles.find((r: any) => String(r?.id) === rid)
    if (!role) return
    const previous = {
      ...role,
      modelCandidates: Array.isArray(role.modelCandidates) ? role.modelCandidates.slice() : role.modelCandidates,
      toolPolicy: normalizeRoleToolPolicy(role.toolPolicy),
    }

    role.name = name
    role.avatarImage = avatarImage
    role.systemPrompt = sys
    role.temperature = temperature
    role.temperatureEnabled = temperatureEnabled
    role.hookPromptPresetId = hookPromptPresetId
    role.modelCandidates = candidates
    role.defaultModelCandidateId = defaultCandidateId
    role.toolPolicy = toolPolicy
    role.updatedAt = now()

    try {
      await saveRoleEntity?.(role)
      showToast?.('角色已保存', { kind: 'success' })
      closeModal()
    } catch (e: any) {
      Object.assign(role, previous)
      showToast?.(String(e?.message || e || '角色保存失败'), { kind: 'error' })
    notifyScopes([refreshScopes.entities('roles'), refreshScopes.uiShell()])
    }
  }

  async function deleteRole(roleId: any) {
    const state = getState()
    if (!state.data) return false
    const rid = String(roleId || '')
    if (!rid) return false
    // 删除动作一开始就换代：服务端删除尚未返回时，在途读写已经在写旧事实。
    onTargetDeleted?.('role', rid)
    const previousRoles = Array.isArray(state.data.roles) ? state.data.roles.slice() : []
    const previousChatsByRole = state.data.chatsByRole && typeof state.data.chatsByRole === 'object' ? { ...state.data.chatsByRole } : {}
    const previousActiveRoleId = String(state.draft.activeRoleId || '')
    const previousActiveTargetKind = String((state.draft as any).activeTargetKind || '')
    const previousActiveGroupId = String((state.draft as any).activeGroupId || '')
    state.data.roles = state.data.roles.filter((r: any) => String(r?.id) !== rid)
    if (state.data.chatsByRole && typeof state.data.chatsByRole === 'object') delete state.data.chatsByRole[rid]
    cleanupFavoriteRefsForTarget('role', rid)

    state.draft.activeRoleId = String(state.data.roles[0]?.id || '')
    if (!Array.isArray((state.data as any).groups) || !(state.data as any).groups.length) {
      ;(state.draft as any).activeTargetKind = 'role'
      ;(state.draft as any).activeGroupId = ''
    }
    try {
      await removeRoleEntity?.(rid)
      showToast?.('角色已删除', { kind: 'success' })
      activateComposerDraftForCurrentSession(state)
      notifyScopes([refreshScopes.entities('roles'), refreshScopes.navigation(), refreshScopes.uiShell()])
      return true
    } catch (e: any) {
      state.data.roles = previousRoles
      state.data.chatsByRole = previousChatsByRole
      state.draft.activeRoleId = previousActiveRoleId
      ;(state.draft as any).activeTargetKind = previousActiveTargetKind
      ;(state.draft as any).activeGroupId = previousActiveGroupId
      showToast?.(String(e?.message || e || '角色删除失败'), { kind: 'error' })
      activateComposerDraftForCurrentSession(state)
      notifyScopes([refreshScopes.entities('roles'), refreshScopes.navigation(), refreshScopes.uiShell()])
      return false
    }
  }

  // ===== Group CRUD =====

  function populateNewGroupDraft() {
    const state = getState()
    if (!state.data) return false
    ;(state.draft as any).editGroupId = NEW_GROUP_ID
    ;(state.draft as any).groupName = '新群组'
    ;(state.draft as any).groupAvatarImage = ''
    ;(state.draft as any).groupAvatarImageCropSrc = ''
    ;(state.draft as any).groupPrompt = ''
    ;(state.draft as any).groupMode = 'roundRobin'
    const roleIds = Array.isArray(state.data.roles) ? state.data.roles.map((role: any) => String(role?.id || '').trim()).filter(Boolean).slice(0, 3) : []
    ;(state.draft as any).groupMemberRoleIds = roleIds
    ;(state.draft as any).groupRoundRobinOrder = roleIds.slice()
    ;(state.draft as any).groupRandomWeights = Object.fromEntries(roleIds.map((roleId: string) => [roleId, 1]))
    ;(state.draft as any).groupRandomMinCount = 1
    ;(state.draft as any).groupRandomMaxCount = Math.max(1, Math.min(2, roleIds.length || 1))
    return true
  }

  function openNewGroupEditor() {
    if (!populateNewGroupDraft()) return
    ;(getState().draft as any).groupEditorInPlace = false
    getState().modal = 'group'
    notifyScopes([refreshScopes.uiShell()])
  }

  function createGroup() {
    openNewGroupEditor()
  }

  function openNewGroupEditorInPlace() {
    if (!populateNewGroupDraft()) return
    ;(getState().draft as any).groupEditorInPlace = true
    notifyScopes([refreshScopes.uiShell()])
  }

  function openGroupEditor(groupId: any) {
    if (!populateGroupDraft(groupId)) return
    ;(getState().draft as any).groupEditorInPlace = false
    getState().modal = 'group'
    notifyScopes([refreshScopes.uiShell()])
  }

  function openGroupEditorInPlace(groupId: any) {
    if (!populateGroupDraft(groupId)) return
    ;(getState().draft as any).groupEditorInPlace = true
    notifyScopes([refreshScopes.uiShell()])
  }

  function populateGroupDraft(groupId: any) {
    const state = getState()
    if (!state.data) return false
    const gid = String(groupId || '').trim()
    if (!gid) return false
    const group = (state.data as any).groups?.find((item: any) => String(item?.id || '') === gid) || null
    if (!group) return false
    const random = group.random && typeof group.random === 'object' ? group.random : {}
    ;(state.draft as any).editGroupId = gid
    ;(state.draft as any).groupName = String(group.name || '')
    ;(state.draft as any).groupAvatarImage = looksLikeImageDataUrl(group.avatarImage) ? String(group.avatarImage || '') : ''
    ;(state.draft as any).groupAvatarImageCropSrc = ''
    ;(state.draft as any).groupPrompt = String(group.prompt || '')
    ;(state.draft as any).groupMode = String(group.mode || '') === 'random' ? 'random' : 'roundRobin'
    const memberRoleIds = Array.isArray(group.memberRoleIds) ? group.memberRoleIds.map((id: any) => String(id || '').trim()).filter(Boolean) : []
    ;(state.draft as any).groupMemberRoleIds = memberRoleIds
    ;(state.draft as any).groupRoundRobinOrder = Array.isArray(group.roundRobinOrder) ? group.roundRobinOrder.map((id: any) => String(id || '').trim()).filter((id: string) => memberRoleIds.includes(id)) : memberRoleIds.slice()
    ;(state.draft as any).groupRandomWeights = random.weightsByRoleId && typeof random.weightsByRoleId === 'object' ? { ...random.weightsByRoleId } : {}
    ;(state.draft as any).groupRandomMinCount = Math.max(1, Math.round(Number(random.minCount || 1)))
    ;(state.draft as any).groupRandomMaxCount = Math.max(1, Math.round(Number(random.maxCount || Math.min(2, memberRoleIds.length || 1))))
    return true
  }

  async function saveGroupEditor() {
    const state = getState()
    if (!state.data) return
    const gid = String((state.draft as any).editGroupId || '').trim()
    const isNew = gid === NEW_GROUP_ID
    const name = String((state.draft as any).groupName || '').replace(/\s+/g, ' ').trim() || '未命名群组'
    const avatarImage = looksLikeImageDataUrl((state.draft as any).groupAvatarImage) ? String((state.draft as any).groupAvatarImage || '') : ''
    const prompt = String((state.draft as any).groupPrompt || '').trim()
    const mode = String((state.draft as any).groupMode || '') === 'random' ? 'random' : 'roundRobin'
    const roleIdSet = new Set((Array.isArray(state.data.roles) ? state.data.roles : []).map((role: any) => String(role?.id || '').trim()).filter(Boolean))
    const memberRoleIds = Array.isArray((state.draft as any).groupMemberRoleIds) ? (state.draft as any).groupMemberRoleIds.map((id: any) => String(id || '').trim()).filter((id: string) => id && roleIdSet.has(id)) : []
    if (!memberRoleIds.length) return showToast?.('请至少选择一个成员角色', { kind: 'error' })
    const order = Array.isArray((state.draft as any).groupRoundRobinOrder) ? (state.draft as any).groupRoundRobinOrder.map((id: any) => String(id || '').trim()).filter((id: string) => memberRoleIds.includes(id)) : []
    const seen = new Set(order)
    for (const roleId of memberRoleIds) if (!seen.has(roleId)) order.push(roleId)
    const weightsSource = (state.draft as any).groupRandomWeights && typeof (state.draft as any).groupRandomWeights === 'object' ? (state.draft as any).groupRandomWeights : {}
    const weightsByRoleId: Record<string, number> = {}
    for (const roleId of memberRoleIds) weightsByRoleId[roleId] = Math.max(0, Math.round(Number(weightsSource[roleId] ?? 1)))
    let minCount = clamp(Math.round(Number((state.draft as any).groupRandomMinCount || 1)), 1, 20)
    let maxCount = clamp(Math.round(Number((state.draft as any).groupRandomMaxCount || Math.min(2, memberRoleIds.length || 1))), 1, 20)
    minCount = Math.min(minCount, memberRoleIds.length)
    maxCount = Math.min(Math.max(maxCount, minCount), memberRoleIds.length)

    if (isNew) {
      const groupId = uid('g')
      const group = { id: groupId, name, avatarImage, prompt, mode, memberRoleIds, roundRobinOrder: order, random: { weightsByRoleId, minCount, maxCount }, createdAt: now(), updatedAt: now() }
      try {
        if (typeof saveGroupEntity !== 'function') throw new Error('群组保存通道不可用')
        await saveGroupEntity(group)
        if (!Array.isArray((state.data as any).groups)) (state.data as any).groups = []
        ;(state.data as any).groups.unshift(group)
        if (!(state.data as any).chatsByGroup || typeof (state.data as any).chatsByGroup !== 'object') (state.data as any).chatsByGroup = {}
        ;(state.data as any).chatsByGroup[groupId] = { activeChatId: '', chatMetas: [], chats: [] }
        ;(state.draft as any).activeTargetKind = 'group'
        ;(state.draft as any).activeGroupId = groupId
        showToast?.('群组已保存', { kind: 'success' })
        closeModal()
      } catch (e: any) {
        showToast?.(String(e?.message || e || '群组保存失败'), { kind: 'error' })
    notifyScopes([refreshScopes.entities('groups'), refreshScopes.uiShell()])
      }
      return
    }

    const group = (state.data as any).groups?.find((item: any) => String(item?.id || '') === gid) || null
    if (!group) return
    const previous = { ...group, memberRoleIds: Array.isArray(group.memberRoleIds) ? group.memberRoleIds.slice() : [], roundRobinOrder: Array.isArray(group.roundRobinOrder) ? group.roundRobinOrder.slice() : [], random: group.random && typeof group.random === 'object' ? { ...group.random, weightsByRoleId: { ...(group.random.weightsByRoleId || {}) } } : group.random }
    Object.assign(group, { name, avatarImage, prompt, mode, memberRoleIds, roundRobinOrder: order, random: { weightsByRoleId, minCount, maxCount }, updatedAt: now() })
    try {
      await saveGroupEntity?.(group)
      showToast?.('群组已保存', { kind: 'success' })
      closeModal()
    } catch (e: any) {
      Object.assign(group, previous)
      showToast?.(String(e?.message || e || '群组保存失败'), { kind: 'error' })
    notifyScopes([refreshScopes.entities('groups'), refreshScopes.uiShell()])
    }
  }

  async function deleteGroup(groupId: any) {
    const state = getState()
    if (!state.data) return false
    const gid = String(groupId || '').trim()
    if (!gid) return false
    const previousGroups = Array.isArray((state.data as any).groups) ? (state.data as any).groups.slice() : []
    const previousChatsByGroup = (state.data as any).chatsByGroup && typeof (state.data as any).chatsByGroup === 'object' ? { ...(state.data as any).chatsByGroup } : {}
    const previousActiveGroupId = String((state.draft as any).activeGroupId || '')
    const previousActiveTargetKind = String((state.draft as any).activeTargetKind || '')
    if (groupHasActiveRun(state, gid)) {
      showToast?.('该群组有真实运行中的任务，不能删除', { kind: 'error' })
      return false
    }
    onTargetDeleted?.('group', gid)
    ;(state.data as any).groups = previousGroups.filter((group: any) => String(group?.id || '') !== gid)
    if ((state.data as any).chatsByGroup && typeof (state.data as any).chatsByGroup === 'object') delete (state.data as any).chatsByGroup[gid]
    if (String((state.draft as any).activeGroupId || '') === gid) {
      ;(state.draft as any).activeGroupId = String((state.data as any).groups?.[0]?.id || '')
      if (!(state.draft as any).activeGroupId) {
        ;(state.draft as any).activeTargetKind = 'role'
      }
    }
    try {
      await removeGroupEntity?.(gid)
      cleanupFavoriteRefsForTarget('group', gid)
      showToast?.('群组已删除', { kind: 'success' })
      activateComposerDraftForCurrentSession(state)
      notifyScopes([refreshScopes.entities('groups'), refreshScopes.navigation(), refreshScopes.uiShell()])
      return true
    } catch (e: any) {
      ;(state.data as any).groups = previousGroups
      ;(state.data as any).chatsByGroup = previousChatsByGroup
      ;(state.draft as any).activeGroupId = previousActiveGroupId
      ;(state.draft as any).activeTargetKind = previousActiveTargetKind
      showToast?.(String(e?.message || e || '群组删除失败'), { kind: 'error' })
      activateComposerDraftForCurrentSession(state)
      notifyScopes([refreshScopes.entities('groups'), refreshScopes.navigation(), refreshScopes.uiShell()])
      return false
    }
  }

  // ===== Provider CRUD =====

  function openProvidersEditor() {
    const state = getState()
    state.draft.editProviderId = ''
    state.modal = 'providers'
    notifyScopes([refreshScopes.uiShell()])
  }

  function populateProviderDraft(providerId: any) {
    const state = getState()
    const p = sa.getProvider(providerId)
    if (!p) return false
    state.draft.editProviderId = String(p.id)
    state.draft.providerName = String(p.name || '')
    state.draft.providerBaseUrl = String(p.baseUrl || '')
    state.draft.providerApiKey = String(p.apiKey || '')
    state.draft.providerProtocol = String(p.protocol || '')
    state.draft.providerApiKeyStrategy = String(p.apiKeyStrategy || '') === 'weighted_random' ? 'weighted_random' : 'sequential'
    state.draft.providerApiKeys = Array.isArray(p.apiKeys) ? p.apiKeys.map((key: any) => ({ ...key })) : []
    if (!state.draft.providerApiKeys.length && String(p.apiKey || '').trim()) state.draft.providerApiKeys = [{ id: 'legacy', name: '默认 Key', key: String(p.apiKey || ''), enabled: true, weight: 1 }]
    state.draft.providerRegisteredModels = Array.isArray(p.registeredModels) ? p.registeredModels.map((model: any) => ({ ...model })) : []
    return true
  }

  function openProviderInlineEditor(providerId: any) {
    if (!populateProviderDraft(providerId)) return
    notifyScopes([refreshScopes.uiShell()])
  }

  const NEW_PROVIDER_DEFAULT_NAME = '新供应商（OpenAI 兼容）'

  function nextProviderName(state: any, desiredRaw: any, currentName?: any) {
    const desiredName = String(desiredRaw || '').replace(/\s+/g, ' ').trim() || '未命名供应商'
    const used = new Set(
      (state.data?.settings?.providers || [])
        .filter((provider: any) => provider && typeof provider === 'object')
        .map((provider: any) => String(provider.name || ''))
        .filter(Boolean),
    )
    const current = String(currentName || '')
    if (current) used.delete(current)
    let name = desiredName
    if (used.has(name)) {
      let index = 2
      while (used.has(`${desiredName}（${index}）`)) index++
      name = `${desiredName}（${index}）`
    }
    return name
  }

  function readProviderDraft(state: any) {
    return {
      name: String(state.draft.providerName || ''),
      baseUrl: String(state.draft.providerBaseUrl || '').trim() || 'http://',
      protocol: normalizeProviderProtocol(state.draft.providerProtocol),
      apiKeyStrategy: String(state.draft.providerApiKeyStrategy || '') === 'weighted_random' ? 'weighted_random' : 'sequential',
      apiKeys: normalizeProviderApiKeys(state.draft.providerApiKeys),
      registeredModels: normalizeProviderRegisteredModels(state.draft.providerRegisteredModels),
    }
  }

  function writeProviderDraft(state: any, values: any) {
    state.draft.providerName = values.name
    state.draft.providerBaseUrl = values.baseUrl
    state.draft.providerApiKey = ''
    state.draft.providerProtocol = values.protocol
    state.draft.providerApiKeyStrategy = values.apiKeyStrategy
    state.draft.providerApiKeys = values.apiKeys.map((key: any) => ({ ...key }))
    state.draft.providerRegisteredModels = values.registeredModels.map((model: any) => ({ ...model }))
  }

  async function saveProviderInlineEditor() {
    const state = getState()
    if (!state.data) return
    const pid = String(state.draft.editProviderId || '')
    const isNew = pid === NEW_PROVIDER_ID
    const p = isNew ? null : sa.getProvider(pid)
    if (!isNew && !p) return

    const values = readProviderDraft(state)
    const nextName = nextProviderName(state, values.name, p?.name)

    if (!values.protocol) {
      showToast?.('请选择供应商协议', { kind: 'error' })
      notifyScopes([refreshScopes.uiShell()])
      return
    }
    if (!values.apiKeys.length) {
      showToast?.('请至少填写一个供应商 Key', { kind: 'error' })
      notifyScopes([refreshScopes.uiShell()])
      return
    }

    if (isNew) {
      const provider = {
        id: uid('p'),
        name: nextName,
        baseUrl: values.baseUrl,
        apiKey: '',
        protocol: values.protocol,
        apiKeyStrategy: values.apiKeyStrategy,
        apiKeys: values.apiKeys,
        registeredModels: values.registeredModels,
        modelsCache: { items: [], fetchedAt: 0 },
      }
      try {
        if (typeof saveProviderEntity !== 'function') throw new Error('供应商保存通道不可用')
        await saveProviderEntity(provider)
        if (!Array.isArray(state.data.settings.providers)) state.data.settings.providers = []
        state.data.settings.providers.unshift(provider)
        state.draft.editProviderId = provider.id
        writeProviderDraft(state, { ...values, name: nextName })
        showToast?.('供应商已保存', { kind: 'success' })
        notifyScopes([refreshScopes.entities('providers'), refreshScopes.uiShell()])
      } catch (e: any) {
        showToast?.(String(e?.message || e || '供应商保存失败'), { kind: 'error' })
        notifyScopes([refreshScopes.uiShell()])
      }
      return
    }

    const provider = p as any
    const previous = { ...provider, modelsCache: provider.modelsCache && typeof provider.modelsCache === 'object' ? { ...provider.modelsCache } : provider.modelsCache }

    try {
      provider.name = nextName
      provider.baseUrl = values.baseUrl
      provider.apiKey = ''
      provider.protocol = values.protocol
      provider.apiKeyStrategy = values.apiKeyStrategy
      provider.apiKeys = values.apiKeys
      provider.registeredModels = values.registeredModels
      if (String(previous.baseUrl || '').trim() !== values.baseUrl) provider.modelsCache = { items: [], fetchedAt: 0 }
      await saveProviderEntity?.(provider)
      // 保留选中与编辑器：用归一化后的结果回写草稿，避免显示值与已保存值分叉。
      writeProviderDraft(state, { ...values, name: nextName })
      showToast?.('供应商已保存', { kind: 'success' })
      notifyScopes([refreshScopes.entities('providers'), refreshScopes.uiShell()])
    } catch (e: any) {
      Object.assign(provider, previous)
      showToast?.(String(e?.message || e || '供应商保存失败'), { kind: 'error' })
      notifyScopes([refreshScopes.entities('providers'), refreshScopes.uiShell()])
    }
  }

  function createProvider() {
    const state = getState()
    if (!state.data) return
    state.draft.editProviderId = NEW_PROVIDER_ID
    state.draft.providerName = nextProviderName(state, NEW_PROVIDER_DEFAULT_NAME)
    state.draft.providerBaseUrl = 'http://'
    state.draft.providerApiKey = ''
    state.draft.providerProtocol = ''
    state.draft.providerApiKeyStrategy = 'sequential'
    state.draft.providerApiKeys = []
    state.draft.providerRegisteredModels = []
    notifyScopes([refreshScopes.uiShell()])
  }

  function normalizeProviderProtocol(value: any) {
    const protocol = String(value || '').trim()
    return protocol === 'openai' || protocol === 'anthropic' ? protocol : ''
  }

  function normalizeProviderApiKeys(value: any) {
    const list = Array.isArray(value) ? value : []
    return list
      .filter((key: any) => key && typeof key === 'object')
      .map((key: any, index: number) => ({
        id: String(key.id || uid('key')).trim(),
        name: String(key.name || `Key ${index + 1}`).trim(),
        key: String(key.key || '').trim(),
        enabled: typeof key.enabled === 'boolean' ? key.enabled : true,
        weight: Math.max(1, Math.round(Number(key.weight || 1))),
      }))
      .filter((key: any) => key.id && key.name && key.key)
  }

  function normalizeProviderRegisteredModels(value: any) {
    const list = Array.isArray(value) ? value : []
    return list
      .filter((model: any) => model && typeof model === 'object')
      .map((model: any) => normalizeReasoningFields({
        id: String(model.id || '').trim(),
        name: String(model.name || model.id || '').trim(),
        sourceModelId: String(model.sourceModelId || '').trim(),
        supportsReasoning: !!model.supportsReasoning,
        defaultReasoningEffort: normalizeReasoningEffort(model.defaultReasoningEffort),
      }))
      .filter((model: any) => model.id && model.sourceModelId)
  }

  async function deleteProvider(providerId: any) {
    const state = getState()
    if (!state.data) return false
    const pid = String(providerId || '')
    if (!pid) return false
    if (pid === NEW_PROVIDER_ID) {
      state.draft.editProviderId = ''
      notifyScopes([refreshScopes.uiShell()])
      return true
    }
    if (state.data.settings.providers.length <= 1) {
      showToast?.('至少保留一个供应商', { kind: 'error' })
      return false
    }

    const previousProviders = Array.isArray(state.data.settings.providers) ? state.data.settings.providers.slice() : []
    state.data.settings.providers = state.data.settings.providers.filter((p: any) => String(p?.id) !== pid)

    try {
      await removeProviderEntity?.(pid)
      showToast?.('供应商已删除', { kind: 'success' })
    notifyScopes([refreshScopes.entities('providers'), refreshScopes.uiShell()])
      return true
    } catch (e: any) {
      state.data.settings.providers = previousProviders
      showToast?.(String(e?.message || e || '供应商删除失败'), { kind: 'error' })
    notifyScopes([refreshScopes.entities('providers'), refreshScopes.uiShell()])
      return false
    }
  }

  // ===== Create chat for active =====

  function createChatForActiveRole() {
    const state = getState()
    const role = sa.activeRole()
    if (!role) return showToast?.('请先选择角色', { kind: 'error' })
    const rid = String(role.id || '')
    const pending = createPendingChatEntry('role', rid, '新聊天')
    if (!pending) return
    saveActiveComposerDraftMirror(state)
    state.pendingChat = pending
    state.pendingGroupChat = null
    state.branchDraft = null
    state.sideTab = 'chats'
    activateComposerDraftForCurrentSession(state)
    notifyScopes([refreshScopes.navigation(), refreshScopes.composer(), refreshScopes.chatList('role', rid)])
    scrollToBottomSoon()
  }

  function createChatForActiveGroup() {
    const state = getState()
    const group = sa.activeGroup()
    if (!group) return showToast?.('请先选择群组', { kind: 'error' })
    const pending = createPendingChatEntry('group', String((group as any).id || ''), '群聊')
    if (!pending) return
    saveActiveComposerDraftMirror(state)
    state.pendingChat = null
    state.pendingGroupChat = pending
    state.branchDraft = null
    state.sideTab = 'chats'
    activateComposerDraftForCurrentSession(state)
    notifyScopes([refreshScopes.navigation(), refreshScopes.composer(), refreshScopes.chatList('group', String((group as any).id || ''))])
    scrollToBottomSoon()
  }

  async function createChatForActiveTarget() {
    if (sa.activeTargetKind() === 'group') return createChatForActiveGroup()
    return createChatForActiveRole()
  }

  // ===== Pick chat for active =====

  async function pickChatForActiveRole(chatId: any) {
    const state = getState()
    const role = sa.activeRole()
    if (!role || !state.data) return
    const targetId = String(role.id || '')
    saveActiveComposerDraftMirror(state)
    clearPendingChatForTarget(state, 'role', role.id)
    const box = sa.ensureChatsBoxBare(targetId)
    if (!box) return
    const cid = String(chatId || '')
    if (!boxHasChatRef(box, cid)) return
    writeActiveChatSelection(box, cid)
    activateComposerDraftForCurrentSession(state)
    ;(setRoleActiveChatSelection?.(targetId, cid) || save()).catch(() => {})
    notifyChatSelected('role', targetId, cid)
    scrollToBottomSoon()
    loadPickedChatInBackground('role', targetId, cid, ensureChatLoaded)
  }

  async function pickChatForActiveGroup(chatId: any) {
    const state = getState()
    const group = sa.activeGroup()
    if (!group || !state.data) return
    const targetId = String((group as any).id || '')
    saveActiveComposerDraftMirror(state)
    clearPendingChatForTarget(state, 'group', targetId)
    const box = sa.ensureGroupChatsBoxBare(targetId)
    if (!box) return
    const cid = String(chatId || '')
    if (!boxHasChatRef(box, cid)) return
    writeActiveChatSelection(box, cid)
    activateComposerDraftForCurrentSession(state)
    ;(setGroupActiveChatSelection?.(targetId, cid) || save()).catch(() => {})
    notifyChatSelected('group', targetId, cid)
    scrollToBottomSoon()
    loadPickedChatInBackground('group', targetId, cid, ensureGroupChatLoaded)
  }

  function pickChatForActiveTarget(chatId: any) {
    if (sa.activeTargetKind() === 'group') return pickChatForActiveGroup(chatId)
    return pickChatForActiveRole(chatId)
  }

  // ===== Rename =====

  async function renameChatTitle(roleId: any, chatId: any, title: any) {
    const state = getState()
    if (!state.data) return false
    const rid = String(roleId || '')
    const cid = String(chatId || '')
    if (!rid || !cid) return false

    const box = sa.ensureChatsBoxBare(rid)
    if (!box) return false
    let t = String(title ?? '').replace(/\s+/g, ' ').trim()
    if (t.length > 80) t = t.slice(0, 80).trim()
    t = t || '新聊天'
    const writeToken = sessionWrites?.capture('role', rid, cid) || null

    try {
      if (typeof renameRoleChatInStore !== 'function') throw new Error('会话标题保存通道不可用')
      await renameRoleChatInStore(rid, cid, t)
      if (sessionWrites && !sessionWrites.isCurrent(writeToken)) return false
    } catch (e: any) {
      showToast?.(String(e?.message || e || '会话标题保存失败'), { kind: 'error' })
    notifyScopes([refreshScopes.chatList('role', rid)])
      return false
    }

    const chats = Array.isArray(box.chats) ? box.chats : []
    const chat = chats.find((c: any) => String(c?.id) === cid) || null
    if (chat) {
      chat.title = t
      chat.updatedAt = now()
      writeChatListProjection(box, { kind: 'upsertMeta', meta: chatMetaFromChat(chat, '新聊天'), fallbackTitle: '新聊天' })
    } else {
      const old = Array.isArray(box.chatMetas) ? box.chatMetas.find((m: any) => String(m?.id || '') === cid) : null
      writeChatListProjection(box, {
        kind: 'upsertMeta',
        fallbackTitle: '新聊天',
        meta: {
          id: cid,
          title: t,
          createdAt: Number(old?.createdAt || now()),
          updatedAt: now(),
          lastMessagePreview: String(old?.lastMessagePreview || ''),
          messageCount: Number(old?.messageCount || 0),
          hasPending: !!old?.hasPending,
        },
      })
    }

    notifyScopes([refreshScopes.chatList('role', rid)])
    return true
  }

  async function renameGroupChatTitle(groupId: any, chatId: any, title: any) {
    const state = getState()
    if (!state.data) return false
    const gid = String(groupId || '').trim()
    const cid = String(chatId || '').trim()
    if (!gid || !cid) return false

    const box = sa.ensureGroupChatsBoxBare(gid)
    if (!box) return false
    let t = String(title ?? '').replace(/\s+/g, ' ').trim()
    if (t.length > 80) t = t.slice(0, 80).trim()
    t = t || '群聊'
    const writeToken = sessionWrites?.capture('group', gid, cid) || null

    try {
      if (typeof renameGroupChatInStore !== 'function') throw new Error('群聊标题保存通道不可用')
      await renameGroupChatInStore(gid, cid, t)
      if (sessionWrites && !sessionWrites.isCurrent(writeToken)) return false
    } catch (e: any) {
      showToast?.(String(e?.message || e || '群聊标题保存失败'), { kind: 'error' })
    notifyScopes([refreshScopes.chatList('group', gid)])
      return false
    }

    const chats = Array.isArray(box.chats) ? box.chats : []
    const chat = chats.find((item: any) => String(item?.id || '') === cid) || null
    if (chat) {
      chat.title = t
      chat.updatedAt = now()
      writeChatListProjection(box, { kind: 'upsertMeta', meta: chatMetaFromChat(chat, '群聊'), fallbackTitle: '群聊' })
    } else {
      const old = Array.isArray(box.chatMetas) ? box.chatMetas.find((item: any) => String(item?.id || '') === cid) : null
      writeChatListProjection(box, {
        kind: 'upsertMeta',
        fallbackTitle: '群聊',
        meta: { id: cid, title: t, createdAt: Number(old?.createdAt || now()), updatedAt: now(), lastMessagePreview: String(old?.lastMessagePreview || ''), messageCount: Number(old?.messageCount || 0), hasPending: !!old?.hasPending },
      })
    }
    notifyScopes([refreshScopes.chatList('group', gid)])
    return true
  }

  // ===== Image path collection =====

  function collectChatImagePathSet(chat: any): Set<string> {
    const out = new Set<string>()
    const msgs = Array.isArray(chat?.messages) ? chat.messages : []
    for (const m of msgs) {
      const paths = normImagePaths(m?.images).concat(normImagePaths(m?.toolImages))
      for (const p of paths) {
        const s = String(p || '').trim()
        if (s) out.add(s)
      }
    }
    return out
  }

  function collectOtherChatsImagePathSet(excludeRoleId: string, excludeChatId: string): Set<string> {
    const state = getState()
    const out = new Set<string>()
    if (!state.data) return out
    const byRole: Record<string, any> = state.data.chatsByRole && typeof state.data.chatsByRole === 'object' ? (state.data.chatsByRole as any) : {}
    for (const [rid, box] of Object.entries(byRole)) {
      const chats = Array.isArray((box as any)?.chats) ? (box as any).chats : []
      for (const c of chats) {
        const cid = String((c as any)?.id || '')
        if (String(rid) === String(excludeRoleId || '') && cid === String(excludeChatId || '')) continue
        const paths = collectChatImagePathSet(c)
        for (const p of paths) {
          out.add(p)
          const base = imageBasename(p)
          if (base && base !== p) out.add(base)
        }
      }
    }
    return out
  }

  function collectOtherChatsImagePathSetForGroup(excludeGroupId: string, excludeChatId: string): Set<string> {
    const state = getState()
    const out = new Set<string>()
    if (!state.data) return out

    const byRole: Record<string, any> = state.data.chatsByRole && typeof state.data.chatsByRole === 'object' ? (state.data.chatsByRole as any) : {}
    for (const box of Object.values(byRole)) {
      const chats = Array.isArray((box as any)?.chats) ? (box as any).chats : []
      for (const c of chats) {
        const paths = collectChatImagePathSet(c)
        for (const p of paths) {
          out.add(p)
          const base = imageBasename(p)
          if (base && base !== p) out.add(base)
        }
      }
    }

    const byGroup = (state.data as any).chatsByGroup && typeof (state.data as any).chatsByGroup === 'object' ? (state.data as any).chatsByGroup : {}
    for (const [gid, box] of Object.entries(byGroup)) {
      const chats = Array.isArray((box as any)?.chats) ? (box as any).chats : []
      for (const c of chats) {
        const cid = String((c as any)?.id || '')
        if (String(gid) === String(excludeGroupId || '') && cid === String(excludeChatId || '')) continue
        const paths = collectChatImagePathSet(c)
        for (const p of paths) {
          out.add(p)
          const base = imageBasename(p)
          if (base && base !== p) out.add(base)
        }
      }
    }

    return out
  }

  // ===== Delete chat & images =====

  async function deleteChatImages(paths: string[]): Promise<void> {
    const list = Array.isArray(paths) ? paths : []
    if (!list.length) return
    if (typeof filesImages?.delete !== 'function') return
    for (const p of list) {
      const path = String(p || '').trim()
      if (!path) continue
      await filesImages.delete({ scope: 'data', path }).catch(() => {})
    }
  }

  function deleteChatForRole(roleId: any, chatId: any) {
    const state = getState()
    if (!state.data) return
    const rid = String(roleId || '')
    const cid = String(chatId || '')
    if (!rid || !cid) return

    const box = sa.ensureChatsBoxBare(rid)
    if (!box) return
    if (roleSessionHasActiveRun(state, rid, cid)) return showToast?.('该会话有真实运行中的任务，不能删除', { kind: 'error' })

    // 先换代再删本地：在途正文 / 窗口 / 索引读取落地时都会被判成旧代。
    onChatDeleted?.('role', rid, cid)
    writeChatListProjection(box, { kind: 'remove', chatId: cid, fallbackTitle: '新聊天' })
    cleanupFavoriteRefsForChat('role', rid, '', cid)
    if (readActiveChatSelection(box) === cid) writeActiveChatSelection(box, firstChatIdInBox(box))

    removeLoadedChat?.('role', rid, cid)
    void removeChatInStore?.('role', rid, cid).catch(() => {})
    void (setRoleActiveChatSelection?.(rid, readActiveChatSelection(box)) || save()).catch(() => {})
    activateComposerDraftForCurrentSession(state)
    notifyScopes([refreshScopes.navigation(), refreshScopes.chatList('role', rid)])
  }

  function deleteChatForGroup(groupId: any, chatId: any) {
    const state = getState()
    if (!state.data) return
    const gid = String(groupId || '').trim()
    const cid = String(chatId || '').trim()
    if (!gid || !cid) return

    const box = sa.ensureGroupChatsBoxBare(gid)
    if (!box) return
    if (groupSessionHasActiveRun(state, gid, cid)) return showToast?.('该群聊有真实运行中的任务，不能删除', { kind: 'error' })

    // 先换代再删本地：在途正文 / 窗口 / 索引读取落地时都会被判成旧代。
    onChatDeleted?.('group', gid, cid)
    writeChatListProjection(box, { kind: 'remove', chatId: cid, fallbackTitle: '群聊' })
    cleanupFavoriteRefsForChat('group', gid, '', cid)
    if (readActiveChatSelection(box) === cid) writeActiveChatSelection(box, firstChatIdInBox(box))

    removeLoadedChat?.('group', gid, cid)
    void removeChatInStore?.('group', gid, cid).catch(() => {})
    void (setGroupActiveChatSelection?.(gid, readActiveChatSelection(box)) || save()).catch(() => {})
    activateComposerDraftForCurrentSession(state)
    notifyScopes([refreshScopes.navigation(), refreshScopes.chatList('group', gid)])
  }

  return {
    pickRoleAvatarImage,
    clearRoleAvatarImage,
    pickGroupAvatarImage,
    clearGroupAvatarImage,
    openNewRoleEditor,
    openNewRoleEditorInPlace,
    createRole,
    openRoleEditor,
    openRoleEditorInPlace,
    saveRoleEditor,
    deleteRole,
    openNewGroupEditor,
    openNewGroupEditorInPlace,
    createGroup,
    openGroupEditor,
    openGroupEditorInPlace,
    saveGroupEditor,
    deleteGroup,
    openProvidersEditor,
    openProviderInlineEditor,
    saveProviderInlineEditor,
    createProvider,
    deleteProvider,
    createChatForActiveRole,
    createChatForActiveGroup,
    createChatForActiveTarget,
    pickChatForActiveRole,
    pickChatForActiveGroup,
    pickChatForActiveTarget,
    renameChatTitle,
    renameGroupChatTitle,
    collectChatImagePathSet,
    collectOtherChatsImagePathSet,
    collectOtherChatsImagePathSetForGroup,
    deleteChatImages,
    deleteChatForRole,
    deleteChatForGroup,
  }
}
