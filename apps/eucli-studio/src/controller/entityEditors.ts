import { now, uid, clamp, clampTemp, normImagePaths } from '../core/utils'
import { createStateAccessors } from '../state/stateAccessors'
import { activeEbRoleRunCards, activeEbRoleRunCardsForSession, activeEbRunCardsForTarget } from '../domain/activeRunCards'
import { chatMetaFromChat, removeChatMeta, upsertChatMeta } from '../domain/chatMeta'
import { NEW_GROUP_ID, NEW_ROLE_ID } from '../domain/constants'
import { emptyRoleToolPolicy, normalizeRoleToolPolicy } from '../domain/toolPolicy'
import { clearPendingChatForTarget, createPendingChatEntry } from '../domain/pendingChat'
import { activateComposerDraftForCurrentSession, saveActiveComposerDraftMirror } from '../domain/sessionComposerDrafts'
import type { AiChatShowToast } from '../gateway/capabilities'
import { normalizeReasoningEffort, normalizeReasoningFields } from '../domain/reasoning'

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
  render: () => void
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
  cleanupFavoriteRefsForTarget: (kind: string, targetId: string) => void
  cleanupFavoriteRefsForChat: (targetKind: string, targetId: string, chatId: string) => void
}) {
  const { getState, save, saveRoleEntity, removeRoleEntity, saveGroupEntity, removeGroupEntity, saveProviderEntity, removeProviderEntity, render, closeModal, showToast, pickImageFiles, filesImages, ensureChatLoaded, ensureGroupChatLoaded, renameRoleChatInStore, renameGroupChatInStore, removeChatInStore, setRoleActiveChatSelection, setGroupActiveChatSelection, removeLoadedChat, cleanupFavoriteRefsForTarget, cleanupFavoriteRefsForChat } = deps
  const sa = createStateAccessors({ getState })

  function scrollToBottomSoon() {
    // UI 负责滚动逻辑（React）
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
        if (stillActive) render()
        if (stillActive && chat) scrollToBottomSoon()
      })
      .catch((error: any) => {
        const state = getState()
        const box = kind === 'group' ? (state.data as any)?.chatsByGroup?.[targetId] : state.data?.chatsByRole?.[targetId]
        if (String(box?.activeChatId || '') !== chatId) return
        showToast?.(String(error?.message || error || '会话加载失败'), { kind: 'error' })
        render()
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
      render()
    } catch (e: any) {
      showToast?.(String(e?.message || e || '选择头像失败'), { kind: 'error' })
    }
  }

  function clearRoleAvatarImage() {
    const state = getState()
    state.draft.roleAvatarImage = ''
    state.draft.roleAvatarImageCropSrc = ''
    render()
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
      render()
    } catch (e: any) {
      showToast?.(String(e?.message || e || '选择头像失败'), { kind: 'error' })
    }
  }

  function clearGroupAvatarImage() {
    const state = getState()
    ;(state.draft as any).groupAvatarImage = ''
    ;(state.draft as any).groupAvatarImageCropSrc = ''
    render()
  }

  // ===== Role CRUD =====

  function openNewRoleEditor() {
    const state = getState()
    if (!state.data) return
    const fallbackPid = String(state.data.settings.providers?.[0]?.id || '')

    state.draft.editRoleId = NEW_ROLE_ID
    state.draft.roleName = '新角色'
    state.draft.roleAvatar = '🙂'
    state.draft.roleAvatarImage = ''
    state.draft.roleAvatarImageCropSrc = ''
    state.draft.roleSystemPrompt = ''
    state.draft.roleTemperature = '0.7'
    ;(state.draft as any).roleHookPromptPresetId = ''
    state.draft.roleModelSource = 'provider'
    state.draft.roleProviderId = fallbackPid
    state.draft.roleModelGroupId = ''
    state.draft.roleToolPolicy = emptyRoleToolPolicy()
    state.draft.roleToolWhitelistOpen = false
    state.draft.roleToolAddOpen = false
    state.draft.roleToolSearch = ''
    state.draft.roleToolAddSelected = []
    state.draft.roleToolMenuName = ''
    state.draft.roleToolPermissionName = ''
    state.draft.roleNativeToolAddOpen = false

    const p = sa.getProvider(fallbackPid)
    const cachedItems = Array.isArray(p?.registeredModels) ? p.registeredModels.map((model: any) => String(model?.id || '')).filter(Boolean) : []
    state.models = { loading: false, error: '', items: cachedItems.slice(0, 300) }
    state.draft.roleModelId = ''
    state.draft.roleCustomModelId = ''

    state.modal = 'role'
    render()
  }

  function createRole() {
    openNewRoleEditor()
  }

  function openRoleEditor(roleId: any) {
    const state = getState()
    if (!state.data) return
    const rid = String(roleId || '')
    const role = state.data.roles.find((r: any) => String(r?.id) === rid)
    if (!role) return
    sa.ensureRoleDefaults(role)

    state.draft.editRoleId = rid
    state.draft.roleName = String(role.name || '')
    state.draft.roleAvatar = String(role.avatar || '')
    state.draft.roleAvatarImage = looksLikeImageDataUrl(role.avatarImage) ? String(role.avatarImage || '') : ''
    state.draft.roleAvatarImageCropSrc = ''
    state.draft.roleSystemPrompt = String(role.systemPrompt || '')
    state.draft.roleTemperature = String(role.temperature ?? 0.7)
    ;(state.draft as any).roleHookPromptPresetId = String(role.hookPromptPresetId || '')
    const modelKind = String(role.modelRef?.kind || '').trim() === 'model_group' || String(role.modelRef?.groupId || '').trim() ? 'model_group' : 'provider'
    state.draft.roleModelSource = modelKind
    state.draft.roleProviderId = modelKind === 'provider' ? String(role.modelRef?.providerId || '') : ''
    state.draft.roleModelGroupId = modelKind === 'model_group' ? String(role.modelRef?.groupId || '') : ''
    state.draft.roleToolPolicy = normalizeRoleToolPolicy(role.toolPolicy)
    state.draft.roleToolWhitelistOpen = false
    state.draft.roleToolAddOpen = false
    state.draft.roleToolSearch = ''
    state.draft.roleToolAddSelected = []
    state.draft.roleToolMenuName = ''
    state.draft.roleToolPermissionName = ''
    state.draft.roleNativeToolAddOpen = false
    const curModelId = String(role.modelRef?.modelId || '').trim()

    const p = sa.getProvider(state.draft.roleProviderId)
    const cachedItems = Array.isArray(p?.registeredModels) ? p.registeredModels.map((model: any) => String(model?.id || '')).filter(Boolean) : []
    state.models = { loading: false, error: '', items: cachedItems.slice(0, 300) }

    state.draft.roleModelId = curModelId
    state.draft.roleCustomModelId = ''

    state.modal = 'role'
    render()
  }

  async function saveRoleEditor() {
    const state = getState()
    if (!state.data) return
    const rid = String(state.draft.editRoleId || '')

    const name = String(state.draft.roleName || '').trim() || '未命名角色'
    const avatar = String(state.draft.roleAvatar || '').trim() || '🙂'
    const avatarImage = looksLikeImageDataUrl(state.draft.roleAvatarImage) ? String(state.draft.roleAvatarImage || '') : ''
    const sys = String(state.draft.roleSystemPrompt || '').trim()
    const temperature = clampTemp(state.draft.roleTemperature)
    const hookPromptPresetId = String((state.draft as any).roleHookPromptPresetId || '').trim()
    const modelSource = String(state.draft.roleModelSource || '').trim() === 'model_group' ? 'model_group' : 'provider'
    const providerId = modelSource === 'provider' ? String(state.draft.roleProviderId || '').trim() : ''
    const groupId = modelSource === 'model_group' ? String(state.draft.roleModelGroupId || '').trim() : ''
    let modelId = String(state.draft.roleModelId || '').trim()

    if (!sys) return showToast?.('请填写角色系统提示词', { kind: 'error' })
    if (modelSource === 'provider' && !providerId) return showToast?.('请选择角色供应商', { kind: 'error' })
    if (modelSource === 'model_group' && !groupId) return showToast?.('请选择模型组', { kind: 'error' })
    if (!modelId) return showToast?.('请选择角色模型', { kind: 'error' })
    const toolPolicy = normalizeRoleToolPolicy(state.draft.roleToolPolicy)
    const modelRef = modelSource === 'model_group'
      ? { kind: 'model_group', groupId, providerId: '', modelId }
      : { kind: 'provider', providerId, modelId }

    if (rid === NEW_ROLE_ID) {
      const newRid = uid('r')
      const role = {
        id: newRid,
        name,
        avatar,
        avatarImage,
        systemPrompt: sys,
        temperature,
        hookPromptPresetId,
        modelRef,
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
        closeModal()
      } catch (e: any) {
        showToast?.(String(e?.message || e || '角色保存失败'), { kind: 'error' })
        render()
      }
      return
    }

    const role = state.data.roles.find((r: any) => String(r?.id) === rid)
    if (!role) return
    const previous = { ...role, modelRef: role.modelRef && typeof role.modelRef === 'object' ? { ...role.modelRef } : role.modelRef }

    role.name = name
    role.avatar = avatar
    role.avatarImage = avatarImage
    role.systemPrompt = sys
    role.temperature = temperature
    role.hookPromptPresetId = hookPromptPresetId
    role.modelRef = modelRef
    role.toolPolicy = toolPolicy
    role.updatedAt = now()

    try {
      await saveRoleEntity?.(role)
      showToast?.('角色已保存', { kind: 'success' })
      closeModal()
    } catch (e: any) {
      Object.assign(role, previous)
      showToast?.(String(e?.message || e || '角色保存失败'), { kind: 'error' })
      render()
    }
  }

  async function deleteRole(roleId: any) {
    const state = getState()
    if (!state.data) return false
    const rid = String(roleId || '')
    if (!rid) return false
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
      render()
      return true
    } catch (e: any) {
      state.data.roles = previousRoles
      state.data.chatsByRole = previousChatsByRole
      state.draft.activeRoleId = previousActiveRoleId
      ;(state.draft as any).activeTargetKind = previousActiveTargetKind
      ;(state.draft as any).activeGroupId = previousActiveGroupId
      showToast?.(String(e?.message || e || '角色删除失败'), { kind: 'error' })
      render()
      return false
    }
  }

  // ===== Group CRUD =====

  function openNewGroupEditor() {
    const state = getState()
    if (!state.data) return
    ;(state.draft as any).editGroupId = NEW_GROUP_ID
    ;(state.draft as any).groupName = '新群组'
    ;(state.draft as any).groupAvatar = '👥'
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
    state.modal = 'group'
    render()
  }

  function createGroup() {
    openNewGroupEditor()
  }

  function openGroupEditor(groupId: any) {
    const state = getState()
    if (!state.data) return
    const gid = String(groupId || '').trim()
    if (!gid) return
    const group = (state.data as any).groups?.find((item: any) => String(item?.id || '') === gid) || null
    if (!group) return
    const random = group.random && typeof group.random === 'object' ? group.random : {}
    ;(state.draft as any).editGroupId = gid
    ;(state.draft as any).groupName = String(group.name || '')
    ;(state.draft as any).groupAvatar = String(group.avatar || '')
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
    state.modal = 'group'
    render()
  }

  async function saveGroupEditor() {
    const state = getState()
    if (!state.data) return
    const gid = String((state.draft as any).editGroupId || '').trim()
    const isNew = gid === NEW_GROUP_ID
    const name = String((state.draft as any).groupName || '').replace(/\s+/g, ' ').trim() || '未命名群组'
    const avatar = String((state.draft as any).groupAvatar || '').trim() || '👥'
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
      const group = { id: groupId, name, avatar, avatarImage, prompt, mode, memberRoleIds, roundRobinOrder: order, random: { weightsByRoleId, minCount, maxCount }, createdAt: now(), updatedAt: now() }
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
        render()
      }
      return
    }

    const group = (state.data as any).groups?.find((item: any) => String(item?.id || '') === gid) || null
    if (!group) return
    const previous = { ...group, memberRoleIds: Array.isArray(group.memberRoleIds) ? group.memberRoleIds.slice() : [], roundRobinOrder: Array.isArray(group.roundRobinOrder) ? group.roundRobinOrder.slice() : [], random: group.random && typeof group.random === 'object' ? { ...group.random, weightsByRoleId: { ...(group.random.weightsByRoleId || {}) } } : group.random }
    Object.assign(group, { name, avatar, avatarImage, prompt, mode, memberRoleIds, roundRobinOrder: order, random: { weightsByRoleId, minCount, maxCount }, updatedAt: now() })
    try {
      await saveGroupEntity?.(group)
      showToast?.('群组已保存', { kind: 'success' })
      closeModal()
    } catch (e: any) {
      Object.assign(group, previous)
      showToast?.(String(e?.message || e || '群组保存失败'), { kind: 'error' })
      render()
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
      render()
      return true
    } catch (e: any) {
      ;(state.data as any).groups = previousGroups
      ;(state.data as any).chatsByGroup = previousChatsByGroup
      ;(state.draft as any).activeGroupId = previousActiveGroupId
      ;(state.draft as any).activeTargetKind = previousActiveTargetKind
      showToast?.(String(e?.message || e || '群组删除失败'), { kind: 'error' })
      render()
      return false
    }
  }

  // ===== Provider CRUD =====

  function openProvidersEditor() {
    const state = getState()
    state.draft.editProviderId = ''
    state.modal = 'providers'
    render()
  }

  function openProviderInlineEditor(providerId: any) {
    const state = getState()
    const p = sa.getProvider(providerId)
    if (!p) return
    state.draft.editProviderId = String(p.id)
    state.draft.providerName = String(p.name || '')
    state.draft.providerBaseUrl = String(p.baseUrl || '')
    state.draft.providerApiKey = String(p.apiKey || '')
    state.draft.providerProtocol = String(p.protocol || '')
    state.draft.providerApiKeyStrategy = String(p.apiKeyStrategy || '') === 'weighted_random' ? 'weighted_random' : 'sequential'
    state.draft.providerApiKeys = Array.isArray(p.apiKeys) ? p.apiKeys.map((key: any) => ({ ...key })) : []
    if (!state.draft.providerApiKeys.length && String(p.apiKey || '').trim()) state.draft.providerApiKeys = [{ id: 'legacy', name: '默认 Key', key: String(p.apiKey || ''), enabled: true, weight: 1 }]
    state.draft.providerRegisteredModels = Array.isArray(p.registeredModels) ? p.registeredModels.map((model: any) => ({ ...model })) : []
    render()
  }

  async function saveProviderInlineEditor() {
    const state = getState()
    const pid = String(state.draft.editProviderId || '')
    const p = sa.getProvider(pid)
    if (!p) return

    const desiredName = String(state.draft.providerName || '').replace(/\s+/g, ' ').trim() || '未命名供应商'
    const used = new Set((state.data?.settings?.providers || []).filter((x: any) => x && typeof x === 'object').map((x: any) => String(x.name || '')).filter(Boolean))
    used.delete(String(p.name || ''))
    let nextName = desiredName
    if (used.has(nextName)) {
      let i = 2
      while (used.has(`${desiredName}（${i}）`)) i++
      nextName = `${desiredName}（${i}）`
    }

    const oldBaseUrl = String(p.baseUrl || '').trim()
    const nextBaseUrl = String(state.draft.providerBaseUrl || '').trim() || 'http://'
    const nextApiKeyStrategy = String(state.draft.providerApiKeyStrategy || '') === 'weighted_random' ? 'weighted_random' : 'sequential'
    const nextApiKeys = normalizeProviderApiKeys(state.draft.providerApiKeys)
    const nextRegisteredModels = normalizeProviderRegisteredModels(state.draft.providerRegisteredModels)
    const nextProtocol = normalizeProviderProtocol(state.draft.providerProtocol)
    const previous = { ...p, modelsCache: p.modelsCache && typeof p.modelsCache === 'object' ? { ...p.modelsCache } : p.modelsCache }

    if (!nextProtocol) {
      showToast?.('请选择供应商协议', { kind: 'error' })
      render()
      return
    }
    if (!nextApiKeys.length) {
      showToast?.('请至少填写一个供应商 Key', { kind: 'error' })
      render()
      return
    }

    try {
      p.name = nextName
      p.baseUrl = nextBaseUrl
      p.apiKey = ''
      p.protocol = nextProtocol
      p.apiKeyStrategy = nextApiKeyStrategy
      p.apiKeys = nextApiKeys
      p.registeredModels = nextRegisteredModels
      if (oldBaseUrl !== nextBaseUrl) p.modelsCache = { items: [], fetchedAt: 0 }
      await saveProviderEntity?.(p)
      state.draft.editProviderId = ''
      showToast?.('供应商已保存', { kind: 'success' })
      render()
    } catch (e: any) {
      Object.assign(p, previous)
      showToast?.(String(e?.message || e || '供应商保存失败'), { kind: 'error' })
      render()
    }
  }

  function createProvider() {
    const state = getState()
    if (!state.data) return
    const desiredName = '新供应商（OpenAI 兼容）'
    const used = new Set(state.data.settings.providers.map((p: any) => String(p?.name || '')).filter(Boolean))
    let name = desiredName
    if (used.has(name)) {
      let i = 2
      while (used.has(`${desiredName}（${i}）`)) i++
      name = `${desiredName}（${i}）`
    }
    const pid = uid('p')
    state.data.settings.providers.unshift({
      id: pid,
      name,
      baseUrl: 'http://',
      apiKey: '',
      protocol: '',
      apiKeyStrategy: 'sequential',
      apiKeys: [],
      registeredModels: [],
      modelsCache: { items: [], fetchedAt: 0 },
    })
    openProviderInlineEditor(pid)
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
    if (state.data.settings.providers.length <= 1) {
      showToast?.('至少保留一个供应商', { kind: 'error' })
      return false
    }

    const previousProviders = Array.isArray(state.data.settings.providers) ? state.data.settings.providers.slice() : []
    state.data.settings.providers = state.data.settings.providers.filter((p: any) => String(p?.id) !== pid)

    try {
      await removeProviderEntity?.(pid)
      showToast?.('供应商已删除', { kind: 'success' })
      render()
      return true
    } catch (e: any) {
      state.data.settings.providers = previousProviders
      showToast?.(String(e?.message || e || '供应商删除失败'), { kind: 'error' })
      render()
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
    render()
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
    render()
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
    saveActiveComposerDraftMirror(state)
    clearPendingChatForTarget(state, 'role', role.id)
    const box = sa.ensureChatsBoxBare(String(role.id))
    if (!box) return
    const cid = String(chatId || '')
    if (!boxHasChatRef(box, cid)) return
    box.activeChatId = cid
    activateComposerDraftForCurrentSession(state)
    ;(setRoleActiveChatSelection?.(String(role.id || ''), cid) || save()).catch(() => {})
    render()
    scrollToBottomSoon()
    loadPickedChatInBackground('role', String(role.id || ''), cid, ensureChatLoaded)
  }

  async function pickChatForActiveGroup(chatId: any) {
    const state = getState()
    const group = sa.activeGroup()
    if (!group || !state.data) return
    saveActiveComposerDraftMirror(state)
    clearPendingChatForTarget(state, 'group', (group as any).id)
    const box = sa.ensureGroupChatsBoxBare(String((group as any).id || ''))
    if (!box) return
    const cid = String(chatId || '')
    if (!boxHasChatRef(box, cid)) return
    box.activeChatId = cid
    activateComposerDraftForCurrentSession(state)
    ;(setGroupActiveChatSelection?.(String((group as any).id || ''), cid) || save()).catch(() => {})
    render()
    scrollToBottomSoon()
    loadPickedChatInBackground('group', String((group as any).id || ''), cid, ensureGroupChatLoaded)
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

    try {
      if (typeof renameRoleChatInStore !== 'function') throw new Error('会话标题保存通道不可用')
      await renameRoleChatInStore(rid, cid, t)
    } catch (e: any) {
      showToast?.(String(e?.message || e || '会话标题保存失败'), { kind: 'error' })
      render()
      return false
    }

    const chats = Array.isArray(box.chats) ? box.chats : []
    const chat = chats.find((c: any) => String(c?.id) === cid) || null
    if (chat) {
      chat.title = t
      chat.updatedAt = now()
      box.chatMetas = upsertChatMeta(box.chatMetas, chatMetaFromChat(chat, '新聊天'), '新聊天')
    } else {
      const old = Array.isArray(box.chatMetas) ? box.chatMetas.find((m: any) => String(m?.id || '') === cid) : null
      box.chatMetas = upsertChatMeta(box.chatMetas, {
        id: cid,
        title: t,
        createdAt: Number(old?.createdAt || now()),
        updatedAt: now(),
        lastMessagePreview: String(old?.lastMessagePreview || ''),
        messageCount: Number(old?.messageCount || 0),
        hasPending: !!old?.hasPending,
      }, '新聊天')
    }

    render()
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

    try {
      if (typeof renameGroupChatInStore !== 'function') throw new Error('群聊标题保存通道不可用')
      await renameGroupChatInStore(gid, cid, t)
    } catch (e: any) {
      showToast?.(String(e?.message || e || '群聊标题保存失败'), { kind: 'error' })
      render()
      return false
    }

    const chats = Array.isArray(box.chats) ? box.chats : []
    const chat = chats.find((item: any) => String(item?.id || '') === cid) || null
    if (chat) {
      chat.title = t
      chat.updatedAt = now()
      box.chatMetas = upsertChatMeta(box.chatMetas, chatMetaFromChat(chat, '群聊'), '群聊')
    } else {
      const old = Array.isArray(box.chatMetas) ? box.chatMetas.find((item: any) => String(item?.id || '') === cid) : null
      box.chatMetas = upsertChatMeta(box.chatMetas, { id: cid, title: t, createdAt: Number(old?.createdAt || now()), updatedAt: now(), lastMessagePreview: String(old?.lastMessagePreview || ''), messageCount: Number(old?.messageCount || 0), hasPending: !!old?.hasPending }, '群聊')
    }
    render()
    return true
  }

  // ===== Image path collection =====

  function collectChatImagePathSet(chat: any): Set<string> {
    const out = new Set<string>()
    const msgs = Array.isArray(chat?.messages) ? chat.messages : []
    for (const m of msgs) {
      const paths = normImagePaths(m?.images)
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
    const before = Array.isArray(box.chats) ? box.chats : []
    if (roleSessionHasActiveRun(state, rid, cid)) return showToast?.('该会话有真实运行中的任务，不能删除', { kind: 'error' })

    box.chats = before.filter((c: any) => String(c?.id) !== cid)
    box.chatMetas = removeChatMeta(box.chatMetas, cid, '新聊天')
    cleanupFavoriteRefsForChat('role', rid, cid)
    if (String(box.activeChatId || '') === cid) box.activeChatId = String(box.chatMetas[0]?.id || box.chats[0]?.id || '')

    removeLoadedChat?.('role', rid, cid)
    void removeChatInStore?.('role', rid, cid).catch(() => {})
    void (setRoleActiveChatSelection?.(rid, String(box.activeChatId || '')) || save()).catch(() => {})
    render()
  }

  function deleteChatForGroup(groupId: any, chatId: any) {
    const state = getState()
    if (!state.data) return
    const gid = String(groupId || '').trim()
    const cid = String(chatId || '').trim()
    if (!gid || !cid) return

    const box = sa.ensureGroupChatsBoxBare(gid)
    if (!box) return
    const before = Array.isArray(box.chats) ? box.chats : []
    if (groupSessionHasActiveRun(state, gid, cid)) return showToast?.('该群聊有真实运行中的任务，不能删除', { kind: 'error' })

    box.chats = before.filter((c: any) => String(c?.id) !== cid)
    box.chatMetas = removeChatMeta(box.chatMetas, cid, '群聊')
    cleanupFavoriteRefsForChat('group', gid, cid)
    if (String(box.activeChatId || '') === cid) box.activeChatId = String(box.chatMetas[0]?.id || box.chats[0]?.id || '')

    removeLoadedChat?.('group', gid, cid)
    void removeChatInStore?.('group', gid, cid).catch(() => {})
    void (setGroupActiveChatSelection?.(gid, String(box.activeChatId || '')) || save()).catch(() => {})
    render()
  }

  return {
    pickRoleAvatarImage,
    clearRoleAvatarImage,
    pickGroupAvatarImage,
    clearGroupAvatarImage,
    openNewRoleEditor,
    createRole,
    openRoleEditor,
    saveRoleEditor,
    deleteRole,
    openNewGroupEditor,
    createGroup,
    openGroupEditor,
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
