import { now, uid, clamp, clampTemp, normImagePaths } from '../core/utils'
import { createStateAccessors } from '../state/stateAccessors'
import { createDefaultChatBranching } from '../domain/branching'
import { NEW_ROLE_ID, NEW_GROUP_ID, VERSION, DEFAULT_ATTACH_SEND_LIMIT_CHARS, DEFAULT_ATTACH_MAX_FILE_MB, DEFAULT_MERMAID_FIX_SYSTEM_PROMPT, DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT, DEFAULT_STICKER_NAMING_SYSTEM_PROMPT, DEFAULT_TOOL_CALL_SERVER_BASE_URL } from '../domain/constants'

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

function chatHasPendingAssistant(chat: any): boolean {
  const msgs = Array.isArray(chat?.messages) ? chat.messages : []
  for (const m of msgs) {
    if (!m || typeof m !== 'object') continue
    if (m.role === 'assistant' && m.pending) return true
  }
  return false
}

function imageBasename(p: string): string {
  const s = String(p || '')
  const a = s.lastIndexOf('/')
  const b = s.lastIndexOf('\\')
  const i = Math.max(a, b)
  return i >= 0 ? s.slice(i + 1) : s
}

export function createEntityEditors(deps: {
  getState: () => any
  save: () => Promise<void>
  render: () => void
  closeModal: () => void
  showToast?: (msg: string) => void
  pickImages?: (maxCount?: number) => Promise<any[]>
  filesImages: { delete?: (req: any) => Promise<any> }
  cleanupFavoriteRefsForTarget: (kind: string, targetId: string) => void
  cleanupFavoriteRefsForChat: (targetKind: string, targetId: string, chatId: string) => void
}) {
  const { getState, save, render, closeModal, showToast, pickImages, filesImages, cleanupFavoriteRefsForTarget, cleanupFavoriteRefsForChat } = deps
  const sa = createStateAccessors({ getState })

  function scrollToBottomSoon() {
    // UI 负责滚动逻辑（React）
  }

  function defaultData() {
    const providerName = '默认供应商（OpenAI 兼容）'
    const pid = providerName
    const rid = uid('r')
    const cid = uid('c')
    const t = now()
    return {
      version: VERSION,
      settings: {
        streamEnabled: true,
        transparentChatBg: false,
        chatBgOpacity: 0,
        chatBgBlur: 0,
        topbarOpacity: 100,
        topbarBlur: 0,
        composerOpacity: 86,
        composerBlur: 10,
        branchTree: { dir: 'lr', view: 'float', followSelected: true, modalHotkey: '' },
        toolRequestRenderPreset: 'classic',
        toolRequestRenderPresets: [],
        renderSafetyPolicy: 'original',
        userMessageCollapseEnabled: false,
        userMessageCollapseLines: 8,
        attachments: {
          sendLimitChars: DEFAULT_ATTACH_SEND_LIMIT_CHARS,
          maxFileSizeMbByKind: {
            txt: DEFAULT_ATTACH_MAX_FILE_MB,
            md: DEFAULT_ATTACH_MAX_FILE_MB,
            pdf: DEFAULT_ATTACH_MAX_FILE_MB,
            docx: DEFAULT_ATTACH_MAX_FILE_MB,
            ppt: DEFAULT_ATTACH_MAX_FILE_MB,
          },
        },
        stickers: { enabled: false, categories: [], map: {} },
        aiServices: {
          mermaidFix: {
            enabled: false,
            providerId: pid,
            modelId: '',
            customModelId: '',
            systemPrompt: DEFAULT_MERMAID_FIX_SYSTEM_PROMPT,
          },
          chatTitleNaming: {
            enabled: false,
            providerId: pid,
            modelId: '',
            customModelId: '',
            systemPrompt: DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT,
          },
          stickerNaming: {
            enabled: false,
            providerId: pid,
            modelId: '',
            customModelId: '',
            systemPrompt: DEFAULT_STICKER_NAMING_SYSTEM_PROMPT,
          },
        },
        toolCallServer: {
          baseUrl: DEFAULT_TOOL_CALL_SERVER_BASE_URL,
          token: '',
        },
        providers: [{
          id: pid,
          name: providerName,
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          modelsCache: { items: [], fetchedAt: 0 },
        }],
      },
      favorites: { folders: [], chatRefsByFolderId: {} },
      roles: [{
        id: rid,
        name: '默认角色',
        avatar: '🤖',
        systemPrompt: '你是一个严谨、简洁的助手。',
        temperature: 0.7,
        modelRef: { providerId: pid, modelId: '' },
        createdAt: now(),
        updatedAt: now(),
      }],
      chatsByRole: {
        [rid]: {
          activeChatId: cid,
          chats: [{ id: cid, title: '新聊天', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [] }],
        },
      },
      groups: [],
      chatsByGroup: {},
      ui: { activeTargetKind: 'role', activeRoleId: rid, activeGroupId: '' },
    }
  }

  // ===== Avatar =====

  async function pickRoleAvatarImage() {
    const state = getState()
    if (state.loading) return
    if (typeof pickImages !== 'function') return showToast?.('未授权：files.pickImages')

    try {
      const items = await pickImages(1)
      const list = Array.isArray(items) ? items : []
      const it = list.length ? list[0] : null
      const u0 = String(it?.dataUrl || '')
      if (!looksLikeImageDataUrl(u0)) return showToast?.('未选择图片')

      const shrunk = await shrinkImageDataUrl(u0, 1024)
      const u = shrunk || u0
      if (!looksLikeImageDataUrl(u)) return showToast?.('头像图片无效')

      state.draft.roleAvatarImageCropSrc = u
      render()
    } catch (e: any) {
      showToast?.(String(e?.message || e || '选择头像失败'))
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
    if (typeof pickImages !== 'function') return showToast?.('未授权：files.pickImages')

    try {
      const items = await pickImages(1)
      const list = Array.isArray(items) ? items : []
      const it = list.length ? list[0] : null
      const u0 = String(it?.dataUrl || '')
      if (!looksLikeImageDataUrl(u0)) return showToast?.('未选择图片')

      const shrunk = await shrinkImageDataUrl(u0, 1024)
      const u = shrunk || u0
      if (!looksLikeImageDataUrl(u)) return showToast?.('头像图片无效')

      ;(state.draft as any).groupAvatarImageCropSrc = u
      render()
    } catch (e: any) {
      showToast?.(String(e?.message || e || '选择头像失败'))
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
    state.draft.roleProviderId = fallbackPid

    const p = sa.getProvider(fallbackPid)
    const cachedItems = Array.isArray(p?.modelsCache?.items) ? p.modelsCache.items : []
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
    state.draft.roleProviderId = String(role.modelRef?.providerId || '')
    const curModelId = String(role.modelRef?.modelId || '').trim()

    const p = sa.getProvider(state.draft.roleProviderId)
    const cachedItems = Array.isArray(p?.modelsCache?.items) ? p.modelsCache.items : []
    state.models = { loading: false, error: '', items: cachedItems.slice(0, 300) }

    const inCache = !!curModelId && cachedItems.some((x: any) => String(x) === curModelId)
    state.draft.roleModelId = inCache ? curModelId : curModelId ? '__custom__' : ''
    state.draft.roleCustomModelId = inCache ? '' : curModelId

    state.modal = 'role'
    render()
  }

  function saveRoleEditor() {
    const state = getState()
    if (!state.data) return
    const rid = String(state.draft.editRoleId || '')

    const name = String(state.draft.roleName || '').trim() || '未命名角色'
    const avatar = String(state.draft.roleAvatar || '').trim() || '🙂'
    const avatarImage = looksLikeImageDataUrl(state.draft.roleAvatarImage) ? String(state.draft.roleAvatarImage || '') : ''
    const sys = String(state.draft.roleSystemPrompt || '').trim()
    const temperature = clampTemp(state.draft.roleTemperature)
    const providerId = String(state.draft.roleProviderId || '').trim()
    let modelId = String(state.draft.roleModelId || '').trim()
    if (modelId === '__custom__') modelId = String(state.draft.roleCustomModelId || '').trim()

    if (rid === NEW_ROLE_ID) {
      const newRid = uid('r')
      const cid = uid('c')
      const t = now()
      const role = {
        id: newRid,
        name,
        avatar,
        avatarImage,
        systemPrompt: sys,
        temperature,
        modelRef: { providerId, modelId },
        createdAt: now(),
        updatedAt: now(),
      }
      sa.ensureRoleDefaults(role)
      state.data.roles.unshift(role)
      if (!state.data.chatsByRole || typeof state.data.chatsByRole !== 'object') state.data.chatsByRole = {}
      state.data.chatsByRole[newRid] = {
        activeChatId: cid,
        chats: [{ id: cid, title: '新聊天', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [] }],
      }
      state.draft.activeRoleId = newRid
      save().catch(() => {})
      closeModal()
      return
    }

    const role = state.data.roles.find((r: any) => String(r?.id) === rid)
    if (!role) return

    role.name = name
    role.avatar = avatar
    role.avatarImage = avatarImage
    role.systemPrompt = sys
    role.temperature = temperature
    role.modelRef = { providerId, modelId }
    role.updatedAt = now()

    save().catch(() => {})
    closeModal()
  }

  function deleteRole(roleId: any) {
    const state = getState()
    if (!state.data) return
    const rid = String(roleId || '')
    state.data.roles = state.data.roles.filter((r: any) => String(r?.id) !== rid)
    if (state.data.chatsByRole && typeof state.data.chatsByRole === 'object') delete state.data.chatsByRole[rid]
    cleanupFavoriteRefsForTarget('role', rid)

    if (!state.data.roles.length) {
      const d = defaultData()
      state.data.settings.providers = state.data.settings.providers.length ? state.data.settings.providers : d.settings.providers
      state.data.roles = d.roles
      state.data.chatsByRole = d.chatsByRole
      ;(state.data as any).groups = (d as any).groups
      ;(state.data as any).chatsByGroup = (d as any).chatsByGroup
      state.data.ui = d.ui
    }

    state.draft.activeRoleId = String(state.data.roles[0]?.id || '')
    if (!Array.isArray((state.data as any).groups) || !(state.data as any).groups.length) {
      ;(state.draft as any).activeTargetKind = 'role'
      ;(state.draft as any).activeGroupId = ''
    }
    save().catch(() => {})
  }

  // ===== Group CRUD =====

  function openNewGroupEditor() {
    const state = getState()
    if (!state.data) return
    sa.ensureGroupsList()

    ;(state.draft as any).editGroupId = NEW_GROUP_ID
    ;(state.draft as any).groupName = '新群组'
    ;(state.draft as any).groupAvatar = '👥'
    ;(state.draft as any).groupAvatarImage = ''
    ;(state.draft as any).groupAvatarImageCropSrc = ''
    ;(state.draft as any).groupPrompt = ''
    ;(state.draft as any).groupMode = 'roundRobin'
    ;(state.draft as any).groupMemberRoleIds = []
    ;(state.draft as any).groupRoundRobinOrder = []
    ;(state.draft as any).groupRandomWeights = {}
    ;(state.draft as any).groupRandomMinCount = 1
    ;(state.draft as any).groupRandomMaxCount = 2

    state.modal = 'group'
    render()
  }

  function createGroup() {
    openNewGroupEditor()
  }

  function openGroupEditor(groupId: any) {
    const state = getState()
    if (!state.data) return
    sa.ensureGroupsList()

    const gid = String(groupId || '').trim()
    if (!gid) return
    const group = ((state.data as any).groups as any[]).find((g: any) => String(g?.id || '') === gid) || null
    if (!group) return

    ;(state.draft as any).editGroupId = gid
    ;(state.draft as any).groupName = String(group?.name || '')
    ;(state.draft as any).groupAvatar = String(group?.avatar || '')
    ;(state.draft as any).groupAvatarImage = looksLikeImageDataUrl(group?.avatarImage) ? String(group?.avatarImage || '') : ''
    ;(state.draft as any).groupAvatarImageCropSrc = ''
    ;(state.draft as any).groupPrompt = String(group?.prompt || '')
    ;(state.draft as any).groupMode = String(group?.mode || 'roundRobin') === 'random' ? 'random' : 'roundRobin'
    ;(state.draft as any).groupMemberRoleIds = Array.isArray(group?.memberRoleIds) ? group.memberRoleIds.slice(0, 50) : []
    ;(state.draft as any).groupRoundRobinOrder = Array.isArray(group?.roundRobinOrder) ? group.roundRobinOrder.slice(0, 80) : []

    const randomCfg = group?.random && typeof group.random === 'object' ? group.random : {}
    ;(state.draft as any).groupRandomWeights = randomCfg.weightsByRoleId && typeof randomCfg.weightsByRoleId === 'object' ? { ...randomCfg.weightsByRoleId } : {}
    ;(state.draft as any).groupRandomMinCount = clamp(Math.round(Number(randomCfg.minCount ?? 1)), 1, 20)
    ;(state.draft as any).groupRandomMaxCount = clamp(Math.round(Number(randomCfg.maxCount ?? 2)), 1, 20)

    state.modal = 'group'
    render()
  }

  function saveGroupEditor() {
    const state = getState()
    if (!state.data) return
    sa.ensureGroupsList()

    const gid = String((state.draft as any).editGroupId || '').trim()
    const name = String((state.draft as any).groupName || '').replace(/\s+/g, ' ').trim() || '未命名群组'
    const avatar = String((state.draft as any).groupAvatar || '').trim() || '👥'
    const avatarImage = looksLikeImageDataUrl((state.draft as any).groupAvatarImage) ? String((state.draft as any).groupAvatarImage || '') : ''
    const prompt = String((state.draft as any).groupPrompt || '').trim()
    const mode = String((state.draft as any).groupMode || '').trim() === 'random' ? 'random' : 'roundRobin'

    const roles = Array.isArray(state.data.roles) ? state.data.roles : []
    const roleIdSet = new Set(roles.map((r: any) => String(r?.id || '')).filter(Boolean))
    const members0 = Array.isArray((state.draft as any).groupMemberRoleIds) ? (state.draft as any).groupMemberRoleIds : []
    const memberRoleIds: string[] = (Array.from(new Set(members0.map((x: any) => String(x || '').trim()).filter((x: any) => !!x && roleIdSet.has(x)))) as string[]).slice(0, 50)
    if (!memberRoleIds.length) return showToast?.('请至少选择 1 个群组成员角色')

    const order0 = Array.isArray((state.draft as any).groupRoundRobinOrder) ? (state.draft as any).groupRoundRobinOrder : []
    const order = order0.map((x: any) => String(x || '').trim()).filter((x: any) => !!x && memberRoleIds.includes(x))
    const roundRobinOrder = order.length ? order : memberRoleIds.slice()

    const weights0 = (state.draft as any).groupRandomWeights && typeof (state.draft as any).groupRandomWeights === 'object' ? (state.draft as any).groupRandomWeights : {}
    const weightsByRoleId: any = {}
    for (const rid of memberRoleIds) {
      const w = Number((weights0 as any)[rid] ?? 1)
      weightsByRoleId[rid] = isFinite(w) && w >= 0 ? w : 1
    }
    let minCount = Number((state.draft as any).groupRandomMinCount ?? 1)
    let maxCount = Number((state.draft as any).groupRandomMaxCount ?? 2)
    if (!isFinite(minCount)) minCount = 1
    if (!isFinite(maxCount)) maxCount = 2
    minCount = clamp(Math.round(minCount), 1, 20)
    maxCount = clamp(Math.round(maxCount), 1, 20)
    if (maxCount < minCount) maxCount = minCount

    const nowT = now()
    const groups = (state.data as any).groups as any[]

    if (gid === NEW_GROUP_ID) {
      const newGid = uid('g')
      const chatId = uid('gc')
      const group = {
        id: newGid,
        name,
        avatar,
        avatarImage,
        prompt,
        mode,
        memberRoleIds,
        roundRobinOrder,
        random: { weightsByRoleId, minCount, maxCount },
        createdAt: nowT,
        updatedAt: nowT,
      }
      groups.unshift(group)
      ;(state.data as any).chatsByGroup[newGid] = {
        activeChatId: chatId,
        chats: [{ id: chatId, title: '群聊', createdAt: nowT, updatedAt: nowT, branching: createDefaultChatBranching('', nowT, nowT), messages: [] }],
      }
      ;(state.draft as any).activeTargetKind = 'group'
      ;(state.draft as any).activeGroupId = newGid
      save().catch(() => {})
      closeModal()
      return
    }

    const group = groups.find((g: any) => String(g?.id || '') === gid) || null
    if (!group) return

    group.name = name
    group.avatar = avatar
    group.avatarImage = avatarImage
    group.prompt = prompt
    group.mode = mode
    group.memberRoleIds = memberRoleIds
    group.roundRobinOrder = roundRobinOrder
    group.random = { weightsByRoleId, minCount, maxCount }
    group.updatedAt = nowT

    save().catch(() => {})
    closeModal()
  }

  function deleteGroup(groupId: any) {
    const state = getState()
    if (!state.data) return
    sa.ensureGroupsList()
    const gid = String(groupId || '').trim()
    if (!gid) return

    ;(state.data as any).groups = ((state.data as any).groups as any[]).filter((g: any) => String(g?.id || '') !== gid)
    if ((state.data as any).chatsByGroup && typeof (state.data as any).chatsByGroup === 'object') delete (state.data as any).chatsByGroup[gid]
    cleanupFavoriteRefsForTarget('group', gid)

    const curKind = sa.activeTargetKind()
    const curGid = String((state.draft as any).activeGroupId || '')
    if (curKind === 'group' && curGid === gid) {
      const next = Array.isArray((state.data as any).groups) ? (state.data as any).groups[0] : null
      if (next) {
        ;(state.draft as any).activeGroupId = String(next?.id || '')
      } else {
        ;(state.draft as any).activeTargetKind = 'role'
        ;(state.draft as any).activeGroupId = ''
      }
    }

    save().catch(() => {})
    render()
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
    render()
  }

  function saveProviderInlineEditor() {
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

    const oldId = String(p.id || '')
    p.name = nextName
    p.id = nextName
    p.baseUrl = String(state.draft.providerBaseUrl || '').trim() || 'http://'
    p.apiKey = String(state.draft.providerApiKey || '').trim()
    p.modelsCache = { items: [], fetchedAt: 0 }

    if (state.data) {
      for (const r of state.data.roles) {
        if (!r?.modelRef) continue
        if (String(r.modelRef.providerId || '') === oldId) r.modelRef.providerId = String(p.id || '')
      }
    }
    if (String(state.draft.roleProviderId || '') === oldId) state.draft.roleProviderId = String(p.id || '')
    state.draft.editProviderId = ''
    save().catch(() => {})
    render()
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
    const pid = name
    state.data.settings.providers.unshift({
      id: pid,
      name,
      baseUrl: 'http://',
      apiKey: '',
      modelsCache: { items: [], fetchedAt: 0 },
    })
    save().catch(() => {})
    openProviderInlineEditor(pid)
  }

  function deleteProvider(providerId: any) {
    const state = getState()
    if (!state.data) return
    const pid = String(providerId || '')
    if (state.data.settings.providers.length <= 1) return showToast?.('至少保留一个供应商')

    state.data.settings.providers = state.data.settings.providers.filter((p: any) => String(p?.id) !== pid)

    const fallback = String(state.data.settings.providers[0]?.id || '')
    for (const r of state.data.roles) {
      if (!r?.modelRef) continue
      if (String(r.modelRef.providerId) === pid) r.modelRef.providerId = fallback
    }

    save().catch(() => {})
  }

  // ===== Create chat for active =====

  function createChatForActiveRole() {
    const state = getState()
    const role = sa.activeRole()
    if (!role) return showToast?.('请先选择角色')
    const rid = String(role.id || '')
    const t = now()
    state.pendingChat = {
      roleId: rid,
      chat: { id: uid('pc'), title: '新聊天', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [], pendingLocal: true },
    }
    state.sideTab = 'chats'
    state.draft.input = ''
    state.draft.images = []
    render()
    scrollToBottomSoon()
  }

  function createChatForActiveGroup() {
    const state = getState()
    const group = sa.activeGroup()
    if (!group) return showToast?.('请先选择群组')
    const gid = String((group as any).id || '').trim()
    if (!gid) return showToast?.('群组无效')
    const t = now()
    ;(state as any).pendingGroupChat = {
      groupId: gid,
      chat: { id: uid('pgc'), title: '群聊', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [], pendingLocal: true },
    }
    state.sideTab = 'chats'
    state.draft.input = ''
    state.draft.images = []
    ;(state.draft as any).files = []
    render()
    scrollToBottomSoon()
  }

  function createChatForActiveTarget() {
    if (sa.activeTargetKind() === 'group') return createChatForActiveGroup()
    return createChatForActiveRole()
  }

  // ===== Pick chat for active =====

  function pickChatForActiveRole(chatId: any) {
    const state = getState()
    const role = sa.activeRole()
    if (!role || !state.data) return
    sa.clearPendingChat()
    const box = sa.ensureChatsBox(String(role.id))
    if (!box) return
    const cid = String(chatId || '')
    if (!cid || !box.chats.some((c: any) => String(c?.id) === cid)) return
    box.activeChatId = cid
    save().catch(() => {})
    render()
    scrollToBottomSoon()
  }

  function pickChatForActiveGroup(chatId: any) {
    const state = getState()
    const group = sa.activeGroup()
    if (!group || !state.data) return
    sa.clearPendingGroupChat()
    const box = sa.ensureGroupChatsBox(String((group as any).id || ''))
    if (!box) return
    const cid = String(chatId || '')
    if (!cid || !box.chats.some((c: any) => String(c?.id) === cid)) return
    box.activeChatId = cid
    save().catch(() => {})
    render()
    scrollToBottomSoon()
  }

  function pickChatForActiveTarget(chatId: any) {
    if (sa.activeTargetKind() === 'group') return pickChatForActiveGroup(chatId)
    return pickChatForActiveRole(chatId)
  }

  // ===== Rename =====

  function renameChatTitle(roleId: any, chatId: any, title: any) {
    const state = getState()
    if (!state.data) return
    const rid = String(roleId || '')
    const cid = String(chatId || '')
    if (!rid || !cid) return

    const box = sa.ensureChatsBoxBare(rid)
    if (!box) return
    const chats = Array.isArray(box.chats) ? box.chats : []
    const chat = chats.find((c: any) => String(c?.id) === cid) || null
    if (!chat) return

    let t = String(title ?? '').replace(/\s+/g, ' ').trim()
    if (t.length > 80) t = t.slice(0, 80).trim()
    chat.title = t || '新聊天'

    save().catch(() => {})
    render()
  }

  function renameGroupChatTitle(groupId: any, chatId: any, title: any) {
    const state = getState()
    if (!state.data) return
    const gid = String(groupId || '').trim()
    const cid = String(chatId || '').trim()
    if (!gid || !cid) return

    const box = sa.ensureGroupChatsBoxBare(gid)
    if (!box) return
    const chats = Array.isArray(box.chats) ? box.chats : []
    const chat = chats.find((c: any) => String(c?.id) === cid) || null
    if (!chat) return

    let t = String(title ?? '').replace(/\s+/g, ' ').trim()
    if (t.length > 80) t = t.slice(0, 80).trim()
    chat.title = t || '群聊'

    save().catch(() => {})
    render()
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
    const target = before.find((c: any) => String(c?.id) === cid) || null
    if (!target) return
    if (chatHasPendingAssistant(target)) {
      showToast?.('正在生成中，不能删除该会话')
      return
    }

    const targetImagePaths = collectChatImagePathSet(target)
    const otherImagePaths = targetImagePaths.size ? collectOtherChatsImagePathSet(rid, cid) : new Set<string>()
    const toDeleteImages: string[] = []
    for (const p of targetImagePaths) {
      const base = imageBasename(p)
      if (!otherImagePaths.has(p) && (!base || !otherImagePaths.has(base))) toDeleteImages.push(p)
    }

    box.chats = before.filter((c: any) => String(c?.id) !== cid)
    cleanupFavoriteRefsForChat('role', rid, cid)
    if (String(box.activeChatId || '') === cid) box.activeChatId = String(box.chats[0]?.id || '')

    if (!box.chats.length) {
      const nid = uid('c')
      const t = now()
      box.chats = [{ id: nid, title: '新聊天', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [] }]
      box.activeChatId = nid
    }

    void save().then(() => deleteChatImages(toDeleteImages)).catch(() => {})
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
    const target = before.find((c: any) => String(c?.id) === cid) || null
    if (!target) return
    if (chatHasPendingAssistant(target)) {
      showToast?.('正在生成中，不能删除该会话')
      return
    }

    const targetImagePaths = collectChatImagePathSet(target)
    const otherImagePaths = targetImagePaths.size ? collectOtherChatsImagePathSetForGroup(gid, cid) : new Set<string>()
    const toDeleteImages: string[] = []
    for (const p of targetImagePaths) {
      const base = imageBasename(p)
      if (!otherImagePaths.has(p) && (!base || !otherImagePaths.has(base))) toDeleteImages.push(p)
    }

    box.chats = before.filter((c: any) => String(c?.id) !== cid)
    cleanupFavoriteRefsForChat('group', gid, cid)
    if (String(box.activeChatId || '') === cid) box.activeChatId = String(box.chats[0]?.id || '')

    if (!box.chats.length) {
      const nid = uid('gc')
      const t = now()
      box.chats = [{ id: nid, title: '群聊', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [] }]
      box.activeChatId = nid
    }

    void save().then(() => deleteChatImages(toDeleteImages)).catch(() => {})
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
