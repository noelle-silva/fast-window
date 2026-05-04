// ai-chat (iframe sandbox) — V2 controller: DI assembled from extracted modules
import { now, uid, esc, trimSlash, isHttpBaseUrl, clampTemp, normImagePaths, clamp } from '../core/utils'
import { extractOpenAiDelta } from '../core/sse'
import { createDefaultAssistantRenderEngine } from '../render/assistantEngineDefault'
import {
  BUILTIN_TOOL_REQUEST_PRESETS,
  findBuiltinToolRequestPreset,
  normalizeToolRequestRenderPresets,
  resolveToolRequestRenderPreset,
  stringifyToolRequestRenderPreset,
  validateToolRequestRenderPreset,
} from '../core/toolRequestPresets'
import {
  createToolRequestStreamTruncator,
  executeToolCallsOnServer,
  formatToolResponseBlock,
  mapParsedCallsToServerCalls,
  parseToolRequestCalls,
} from '@noelle-silva/eucli-aitoolcall-sdk'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import mammoth from 'mammoth/mammoth.browser'
import { extractPptMarkdown } from '../core/ppt'
import { createAiChatInternalGateway } from '../gateway/createAiChatInternalGateway'
import type { AiChatInternalGateway } from '../gateway/types'
import type { AiChatCapabilities } from '../gateway/capabilities'
import { UI_CHAT_UPDATED_NOTICE_KEY } from '../runtime/runtimeKeys'
import { IMAGE_VIEWER_ZOOM_MAX, MERMAID_VIEWER_ZOOM_MAX, VIEWER_ZOOM_MIN } from '../core/viewerZoom'
import type { AiChatController } from './types'

// ---- domain ----
import {
  CHAT_ATTACHMENT_KINDS,
  CHAT_MSG_GROUP_ROLES,
  CHAT_BRANCHING_SCHEMA_VERSION,
  CHAT_DEFAULT_BRANCH_ID,
  CHAT_DEFAULT_BRANCH_NAME,
  VERSION,
  SPLIT_SCHEMA_VERSION,
  SPLIT_META_KEY,
  MAX_DRAFT_IMAGES,
  MAX_DRAFT_FILES,
  MAX_DRAFT_FILE_BYTES,
  DEFAULT_ATTACH_MAX_FILE_MB,
  MAX_ATTACH_MAX_FILE_MB,
  DEFAULT_ATTACH_SEND_LIMIT_CHARS,
  DEFAULT_TOOL_CALL_SERVER_BASE_URL,
  REF_IMG_PLACEHOLDER,
  NEW_ROLE_ID,
  NEW_GROUP_ID,
  DEFAULT_MERMAID_FIX_SYSTEM_PROMPT,
  DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT,
  DEFAULT_STICKER_NAMING_SYSTEM_PROMPT,
} from '../domain/constants'
import { splitRoleKey, splitChatKey, splitGroupKey, splitGroupChatKey } from '../domain/storageKeys'
import {
  normalizeBranchId,
  normalizeBranchName,
  createDefaultChatBranching,
  normalizeChatBranching,
  rebuildLinearBranchingMessages,
  fillMissingBranchIdsOnly,
  touchActiveBranchHead,
  repairChatLinearBranching,
  ensureChatBranching,
  ensureChatBranch,
  setChatActiveBranchId,
  setChatBranchHeadMid,
  genUniqueBranchId,
  findChatMessageById,
  findPrevAssistantMidForAssistant,
  findAssistantSiblingsByUserMid,
  findChatBranch,
} from '../domain/branching'
import { normalizeMessageAttachments, normalizeMessageGroup } from '../domain/message'
import { validateFavoriteFolderName } from '../domain/favoriteValidator'
import { normalizeChatModelOverride, normalizeMessageModelRef, buildMessageModelRef } from '../domain/modelRefUtils'
import { detectDraftFileKind, addDraftFilePlaceholder, removeDraftFile, removeDraftImage as removeDraftImageFromList, fileExtLower } from '../domain/draftFileUtils'
import type { DraftFileKind, DraftFileItem, DraftImageItem } from '../domain/draftFileUtils'
import { validateStickerCategoryName, validateStickerName, imageExtFromDataUrl } from '../domain/stickerValidator'
import { favoriteChatRefKey, normalizeFavorites, collectFavoriteFolderSubtreeIds } from '../domain/favorites'
import {
  limitHistory,
  looksLikeImageDataUrl,
  escapeFence,
  buildUserTextForOpenAi,
  extractMermaidCodeFromAiReply,
  tokenizeFencesForReplace,
  replaceMermaidFenceOnce,
  normalizeAiGeneratedChatTitle,
  normalizeAiGeneratedStickerName,
  buildChatTranscriptForTitle,
} from '../domain/textProcessing'
import {
  normalizeSplitMeta,
  defaultData,
  normalizeData,
  normalizeRenderSafetyPolicy,
  normalizeMaxFileSizeMb,
} from '../domain/dataNormalizers'

// ---- storage ----
import { createChatWriteLock } from '../storage/chatWriteLock'
import { createStickerStorage } from '../storage/stickerStorage'
import { createSplitStorage } from '../storage/splitStorage'
import { createGroupChatSync } from '../storage/groupChatSync'

// ---- state ----
import { createStateAccessors } from '../state/stateAccessors'

// ---- ui ----
import { createUiCore } from '../ui/uiCore'
import { createImageUtils } from '../ui/imageUtils'
import { createUiPolling } from '../ui/uiPolling'
import { createEventHandlers } from '../ui/eventHandlers'
import { createMermaidUi } from '../ui/mermaidUi'

// ---- services ----
import { createAiServices } from '../services/aiServices'

// ---- controller modules ----
import { createModelRefresh } from './modelRefresh'
import { createFavoritesOperations } from './favoritesOperations'
import { createEntityEditors } from './entityEditors'
import { createChatOperations } from './chatOperations'
import { createPatchOperations } from './patchOperations'
import { createBuildOpenAiReq } from './buildOpenAiReq'

export function createAiChatControllerV2(deps: { capabilities: AiChatCapabilities; aiGateway?: AiChatInternalGateway }): {
  controller: AiChatController
  init: () => Promise<void>
} {
  const capabilities = deps.capabilities
  const api = capabilities
  const runtime = capabilities.meta.runtime
  const runtimeStorage = capabilities.runtimeStorage
  const storage = capabilities.storage

  // ============================================================
  // 1. STATE
  // ============================================================
  const state = {
    loading: true,
    sending: false,
    sendingJobId: '',
    sendingCtx: null as any,
    modal: '',
    mermaid: { items: [] as any[], index: 0, scale: 1 },
    imageViewer: { items: [] as any[], index: 0, scale: 1 },
    sideTab: 'roles' as string,
    models: { loading: false, error: '', items: [] as any[] },
    pendingChat: null as any,
    pendingGroupChat: null as any,
    branchDraft: null as any,
    draft: {
      input: '',
      images: [] as DraftImageItem[],
      files: [] as DraftFileItem[],
      activeTargetKind: 'role' as string,
      activeRoleId: '',
      activeGroupId: '',

      editRoleId: '',
      roleName: '',
      roleAvatar: '',
      roleAvatarImage: '',
      roleAvatarImageCropSrc: '',
      roleSystemPrompt: '',
      roleProviderId: '',
      roleModelId: '',
      roleCustomModelId: '',
      roleTemperature: '0.7',

      editGroupId: '',
      groupName: '',
      groupAvatar: '',
      groupAvatarImage: '',
      groupAvatarImageCropSrc: '',
      groupPrompt: '',
      groupMode: 'roundRobin' as string,
      groupMemberRoleIds: [] as string[],
      groupRoundRobinOrder: [] as string[],
      groupRandomWeights: {} as Record<string, number>,
      groupRandomMinCount: 1,
      groupRandomMaxCount: 2,

      editProviderId: '',
      providerName: '',
      providerBaseUrl: '',
      providerApiKey: '',

      deleteRoleId: '',
      deleteGroupId: '',
      deleteProviderId: '',
      renderSafetyPolicyTarget: '',
    } as any,
    data: null as any,
  }

  // ============================================================
  // 2. UI CORE
  // ============================================================
  const { emit, subscribe, getVer } = createUiCore()
  const ver = getVer

  // ============================================================
  // 3. SPLIT META CACHE (shared across modules)
  // ============================================================
  let splitMetaCache: any = null

  // ============================================================
  // 4. ASSISTANT RENDERER
  // ============================================================
  const assistantRenderer = createDefaultAssistantRenderEngine(capabilities)
  const { ensureRenderer, renderAssistantInto: renderAssistantIntoRaw, sanitizeHtml, sanitizeSvg } = assistantRenderer

  // ============================================================
  // 5. INLINE HELPERS
  // ============================================================
  function fmtTime(ts: any) {
    try {
      const t = Number(ts || 0)
      if (!isFinite(t) || t <= 0) return ''
      const d = new Date(t)
      const nowD = new Date()
      const pad2 = (n: number) => String(n).padStart(2, '0')
      const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
      const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
      const diffDays = Math.floor((startOfDay(nowD) - startOfDay(d)) / 86400000)
      if (diffDays === 0) return hm
      if (diffDays === 1) return `昨天 ${hm}`
      if (diffDays === 2) return `前天 ${hm}`
      return `${d.getFullYear()}年${pad2(d.getMonth() + 1)}月${pad2(d.getDate())}日 ${hm}`
    } catch (_) {
      return ''
    }
  }

  function render() { emit() }
  function renderComposer() { emit() }

  function scrollToBottomSoon() {
    // UI 负责滚动逻辑
  }

  function currentRenderSafetyPolicy() {
    const v = String((state.data?.settings as any)?.renderSafetyPolicy || '').trim()
    return v === 'unsafe' ? 'unsafe' : v === 'baseline' ? 'baseline' : 'original'
  }

  function closeModal() {
    // cancelMermaidDrag handled by eventHandlers module
    state.modal = ''
    state.draft.deleteRoleId = ''
    ;(state.draft as any).deleteGroupId = ''
    state.draft.deleteProviderId = ''
    ;(state.draft as any).renderSafetyPolicyTarget = ''
    state.draft.roleAvatarImageCropSrc = ''
    ;(state.draft as any).groupAvatarImageCropSrc = ''
    if (String(state.draft.editRoleId || '') === NEW_ROLE_ID) {
      state.draft.editRoleId = ''
      state.draft.roleName = ''
      state.draft.roleAvatar = ''
      state.draft.roleAvatarImage = ''
      state.draft.roleAvatarImageCropSrc = ''
      state.draft.roleSystemPrompt = ''
      state.draft.roleProviderId = ''
      state.draft.roleModelId = ''
      state.draft.roleCustomModelId = ''
      state.draft.roleTemperature = '0.7'
    }
    if (String((state.draft as any).editGroupId || '') === NEW_GROUP_ID) {
      ;(state.draft as any).editGroupId = ''
      ;(state.draft as any).groupName = ''
      ;(state.draft as any).groupAvatar = ''
      ;(state.draft as any).groupAvatarImage = ''
      ;(state.draft as any).groupAvatarImageCropSrc = ''
      ;(state.draft as any).groupPrompt = ''
      ;(state.draft as any).groupMode = 'roundRobin'
      ;(state.draft as any).groupMemberRoleIds = []
      ;(state.draft as any).groupRoundRobinOrder = []
      ;(state.draft as any).groupRandomWeights = {}
      ;(state.draft as any).groupRandomMinCount = 1
      ;(state.draft as any).groupRandomMaxCount = 2
    }
    render()
  }

  function chatHasPendingAssistant(chat: any) {
    const msgs = Array.isArray(chat?.messages) ? chat.messages : []
    for (const m of msgs) {
      if (!m || typeof m !== 'object') continue
      if (m.role === 'assistant' && m.pending) return true
    }
    return false
  }

  function chatHasPendingAssistantInBranch(chat: any, branchId: any, excludeMid?: any) {
    const bid = normalizeBranchId(branchId || CHAT_DEFAULT_BRANCH_ID)
    const ex = String(excludeMid || '').trim()
    const msgs = Array.isArray(chat?.messages) ? chat.messages : []
    for (const m of msgs) {
      if (!m || typeof m !== 'object') continue
      if (m.role !== 'assistant' || !m.pending) continue
      const mid = String((m as any)?.id || '').trim()
      if (ex && mid === ex) continue
      const mb = normalizeBranchId((m as any)?.branchId || CHAT_DEFAULT_BRANCH_ID)
      if (mb === bid) return true
    }
    return false
  }

  async function extractPdfText(file: File): Promise<string> {
    const buf = await file.arrayBuffer()
    const doc = await (pdfjsLib as any)
      .getDocument({ data: new Uint8Array(buf), disableWorker: true })
      .promise
    const pages = clamp(Number(doc?.numPages || 0), 1, 200)
    const maxPages = Math.min(pages, 50)
    let out = ''
    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i)
      const tc = await page.getTextContent()
      const items = Array.isArray(tc?.items) ? tc.items : []
      const parts = items
        .map((x: any) => (x && typeof x.str === 'string' ? String(x.str) : ''))
        .filter((x: string) => !!x)
      if (parts.length) out += parts.join(' ') + '\n'
    }
    try { doc?.cleanup?.() } catch (_) {}
    return String(out || '').trim()
  }

  async function extractDocxText(file: File): Promise<string> {
    const buf = await file.arrayBuffer()
    const r = await (mammoth as any).extractRawText({ arrayBuffer: buf })
    return String(r?.value || '').trim()
  }

  async function extractTextFromFile(file: File, kind: DraftFileKind): Promise<string> {
    if (!(file instanceof File)) throw new Error('file 无效')
    const size = Number(file?.size || 0)
    if (!isFinite(size) || size <= 0) throw new Error('文件为空')
    const mb0 = (() => {
      try {
        const at = state.data?.settings?.attachments
        const map = at && typeof at === 'object' ? (at as any).maxFileSizeMbByKind : null
        return map && typeof map === 'object' ? map[kind] : undefined
      } catch (_) { return undefined }
    })()
    const maxMb = (() => {
      const n = Number(mb0)
      if (!isFinite(n)) return DEFAULT_ATTACH_MAX_FILE_MB
      return clamp(Math.round(n), 0, MAX_ATTACH_MAX_FILE_MB)
    })()
    const maxBytes = maxMb <= 0 ? 0 : maxMb * 1024 * 1024
    if (maxBytes > 0 && size > maxBytes) {
      const curMb = Math.round((size / 1024 / 1024) * 10) / 10
      api.ui?.showToast?.(`提示：${String(file?.name || '文件')} 大小 ${curMb}MB 超过设置阈值 ${maxMb}MB，仍会尝试解析`)
    }
    if (kind === 'txt' || kind === 'md') {
      const t = await file.text()
      return String(t || '').trim()
    }
    if (kind === 'pdf') return await extractPdfText(file)
    if (kind === 'docx') {
      const t = await extractDocxText(file)
      return String(t || '').trim()
    }
    if (kind === 'ppt') {
      const t = await extractPptMarkdown(file)
      return String(t || '').trim()
    }
    throw new Error('不支持的文件类型')
  }

  function getStickerRelPath(category: any, name: any) {
    const cat = typeof category === 'string' ? category.trim() : ''
    const nm = typeof name === 'string' ? name.trim() : ''
    if (!cat || !nm) return ''
    const st = state.data?.settings?.stickers
    const box = st && typeof st === 'object' ? st.map?.[cat] : null
    const it = box && typeof box === 'object' ? box[nm] : null
    const relPath = it && typeof it === 'object' ? String(it.relPath || '').trim() : ''
    return relPath
  }

  // ============================================================
  // 5.1. RENDER ASSISTANT (bridge from assistant renderer to state)
  // ============================================================
  function renderAssistantInto(el: unknown, text: unknown, options?: any) {
    const enabled = !!state.data?.settings?.stickers?.enabled
    const activeId = String(state.data?.settings?.toolRequestRenderPreset || 'classic')
    const userPresets = (state.data?.settings as any)?.toolRequestRenderPresets
    const resolved = resolveToolRequestRenderPreset(activeId, userPresets)
    const renderSafetyPolicy = currentRenderSafetyPolicy()
    renderAssistantIntoRaw(el, text, {
      ...(options || {}),
      stickersEnabled: enabled,
      getStickerPath: getStickerRelPath,
      toolRequestPreset: resolved,
      renderSafetyPolicy,
    })
  }

  // ============================================================
  // 6. STORAGE MODULES
  // ============================================================
  const { chatWriteLockKey, withChatWriteLock, writeChatUpdatedNotice } = createChatWriteLock({
    rtStorage: runtimeStorage,
  })

  const stickerStore = createStickerStorage({
    filesImages: api.files?.images as any,
    getState: () => state,
  })
  const { addStickerInternal, syncRoleAvatarFile, syncGroupAvatarFile } = stickerStore

  const buildReq = createBuildOpenAiReq({
    storage,
    filesImagesRead: api.files?.images?.read as any || ((() => Promise.resolve('')) as any),
  })
  const { buildOpenAiChatReqFromStorage, buildOpenAiGroupChatReqFromStorage, loadToolCallServerConfigFromStorage } = buildReq

  const splitStore = createSplitStorage({
    storage,
    rtStorage: runtimeStorage,
    withChatWriteLock,
    writeChatUpdatedNotice,
    syncRoleAvatarFile,
    syncGroupAvatarFile,
    getState: () => state,
    setState: (data: any) => { state.data = data },
    onError: (msg: string) => { api.ui?.showToast?.(msg) },
  })
  const { loadSplitMeta, withSplitMetaWrite, touchChatUpdatedAt, loadSplitData, ensureSplitStoreReady, saveSplitData, saveMetaOnly } = splitStore

  // Update splitMetaCache on loadSplitMeta (wrapper)
  const loadSplitMetaCached = async () => {
    const meta = await loadSplitMeta()
    if (meta) splitMetaCache = meta
    return meta
  }

  function getSplitMetaCache(): any {
    return splitMetaCache
  }

  // ============================================================
  // 7. STATE ACCESSORS
  // ============================================================
  const stateAccessors = createStateAccessors({ getState: () => state })
  const {
    getProvider,
    getRoleById,
    getGroupById,
    activeTargetKind,
    activeRole,
    activeGroup,
    activeChatFromData,
    activeChat,
    clearPendingChat,
    clearPendingGroupChat,
    ensureRoleDefaults,
    ensureGroupsList,
    ensureGroupChatsBoxBare,
    ensureGroupChatsBox,
    ensureChatsBox,
    ensureChatsBoxBare,
    createChatForRole,
    createChatForGroup,
    findChatByIds,
    findGroupChatByIds,
    pickChatModelRef,
  } = stateAccessors

  // ============================================================
  // 8. GROUP CHAT SYNC
  // ============================================================
  const groupChatSync = createGroupChatSync({
    storage,
    getState: () => state,
    setState: (data: any) => { state.data = data },
    loadSplitMeta: loadSplitMetaCached,
    getSplitMetaCache,
    withSplitMetaWrite,
  })
  const { touchGroupChatUpdatedAt, syncActiveGroupChatsFromStorage } = groupChatSync

  // ============================================================
  // 8.1. SAVE & LOAD (bridge to splitStorage)
  // ============================================================
  async function load() {
    try {
      await ensureSplitStoreReady()
      const split = await loadSplitData()
      if (!split) throw new Error('存储未初始化')
      state.data = split
      state.draft.activeRoleId = String(split?.ui?.activeRoleId || '')
      state.draft.activeGroupId = String((split?.ui as any)?.activeGroupId || '')
      state.draft.activeTargetKind = String((split?.ui as any)?.activeTargetKind || 'role') === 'group' ? 'group' : 'role'
    } catch (e: any) {
      state.data = null
      state.draft.activeRoleId = ''
      state.draft.activeGroupId = ''
      state.draft.activeTargetKind = 'role'
      api.ui?.showToast?.(String(e?.message || e || '加载失败'))
    } finally {
      state.loading = false
    }
  }

  async function save() {
    if (!state.data) return
    state.data.ui.activeRoleId = String(state.draft?.activeRoleId || '')
    ;(state.data.ui as any).activeGroupId = String(state.draft?.activeGroupId || '')
    ;(state.data.ui as any).activeTargetKind = String(state.draft?.activeTargetKind || '') === 'group' ? 'group' : 'role'
    await saveSplitData(state.data)
  }

  // ============================================================
  // 9. UI CACHES
  // ============================================================
  const uiStreamCache = new Map<string, string>()
  const uiRefImgCache = new Map<string, string>()
  const uiRefImgPending = new Set<string>()

  // ============================================================
  // 10. IMAGE UTILS
  // ============================================================
  const imageUtils = createImageUtils({
    filesImagesRead: (api.files?.images?.read as any) || ((() => Promise.resolve('')) as any),
    uiRefImgCache,
    uiRefImgPending,
  })
  const { shrinkImageDataUrl, readFileAsDataUrl, hydrateRefImages } = imageUtils

  // ============================================================
  // 11. MODEL REFRESH
  // ============================================================
  const modelRefresh = createModelRefresh({
    getState: () => state,
    getProvider,
    netRequest: capabilities.net?.request || ((() => Promise.resolve({})) as any),
    save,
    emit,
    showToast: api.ui?.showToast,
  })
  const { refreshModels, resolveAiModelId } = modelRefresh

  // ============================================================
  // 12. FAVORITES OPERATIONS
  // ============================================================
  const favOps = createFavoritesOperations({
    getState: () => state,
    save,
    emit,
    showToast: api.ui?.showToast,
    activeTargetKind,
    activeRole,
    activeGroup,
  })

  // ============================================================
  // 13. MERMAID UI
  // ============================================================
  function locateMessageInActiveChat(messageId: any) {
    const mid = String(messageId || '').trim()
    if (!mid) return null
    const role = activeRole()
    if (!role) return null
    const rid = String(role.id || '')
    const pendingChat = state.pendingChat && String(state.pendingChat.roleId || '') === rid ? state.pendingChat.chat : null
    const chat = pendingChat || activeChatFromData()
    if (!chat) return null
    const msgs = Array.isArray(chat.messages) ? chat.messages : []
    const target = msgs.find((m: any) => String(m?.id || '') === mid) || null
    if (!target) return null
    return { chat, pendingChat, target }
  }

  // placeholder for aiGenerateChatTitle, filled after aiServices is created
  let aiGenerateChatTitleFn: ((rid: string, cid: string) => Promise<any>) | undefined

  const mermaidUi = createMermaidUi({
    getState: () => state,
    assistantRenderer,
    save,
    emit,
    loadSplitMeta: loadSplitMetaCached,
    storage,
    aiGenerateChatTitle: undefined, // filled later
    locateMessageInActiveChat,
    chatHasPendingAssistant,
    activeRole,
    getStickerRelPath,
    resolveToolRequestRenderPreset,
    uiStreamCache,
  })
  const {
    renderAssistantInto: _mermaidRenderAssistantInto,
    mermaidItemsFromDom,
    applyMermaidScaleDom,
    renderMermaidModalDom,
    openMermaidViewer: mermaidOpenViewer,
    cancelMermaidDrag: mermaidCancelDrag,
    onMouseMoveMermaid: mermaidMouseMove,
    onMouseUpMermaid: mermaidMouseUp,
    enqueueMermaidFixWrite,
    patchMessageContentSilent,
  } = mermaidUi

  // ============================================================
  // 14. AI SERVICES (first pass with placeholders)
  // ============================================================
  // Placeholder functions that will be filled after entityEditors is created
  let renameChatTitleFn: (rid: string, cid: string, title: string) => void = () => {}
  let renameGroupChatTitleFn: (gid: string, cid: string, title: string) => void = () => {}

  const aiServices = createAiServices({
    getState: () => state,
    netRequest: capabilities.net?.request || ((() => Promise.resolve({})) as any),
    filesImagesRead: (api.files?.images?.read as any) || ((() => Promise.resolve('')) as any),
    aiGateway: deps.aiGateway || createAiChatInternalGateway(capabilities),
    save,
    emit,
    getProvider,
    getGroupById,
    resolveAiModelId,
    locateMessageInActiveChat,
    patchMessageContentSilent,
    enqueueMermaidFixWrite,
    ensureChatsBoxBare,
    ensureGroupChatsBoxBare,
    chatHasPendingAssistant,
    renameChatTitle: (rid: string, cid: string, title: string) => renameChatTitleFn(rid, cid, title),
    renameGroupChatTitle: (gid: string, cid: string, title: string) => renameGroupChatTitleFn(gid, cid, title),
  })
  const { requestOpenAiChatOnce, aiFixMermaidInMessage, aiGenerateChatTitle, aiGenerateGroupChatTitle, aiGenerateStickerName } = aiServices

  // Fill the placeholder
  aiGenerateChatTitleFn = aiGenerateChatTitle

  // ============================================================
  // 15. ENTITY EDITORS
  // ============================================================
  // placeholder for pickImages, filled after chatOperations is created
  let pickImagesFn: (maxCount?: number) => Promise<any[]> = async () => []

  const entityEditors = createEntityEditors({
    getState: () => state,
    save,
    render,
    closeModal,
    showToast: api.ui?.showToast,
    pickImages: async (maxCount?: number) => pickImagesFn(maxCount),
    filesImages: api.files?.images as any,
    cleanupFavoriteRefsForTarget: favOps.cleanupFavoriteRefsForTarget,
    cleanupFavoriteRefsForChat: favOps.cleanupFavoriteRefsForChat,
  })
  const {
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
  } = entityEditors

  // Fill placeholder
  renameChatTitleFn = renameChatTitle
  renameGroupChatTitleFn = renameGroupChatTitle

  // ============================================================
  // 16. CHAT OPERATIONS
  // ============================================================
  const chatOps = createChatOperations({
    getState: () => state,
    aiGateway: deps.aiGateway || createAiChatInternalGateway(capabilities),
    filesImages: api.files?.images as any,
    filesPickImages: api.files?.pickImages as any || (async () => []),
    showToast: api.ui?.showToast,
    save,
    emit,
    render,
    renderComposer,
    scrollToBottomSoon,
    extractTextFromFile,
    uiStreamCache,
  })
  const {
    addDraftImage,
    pickImages,
    addDraftFilesFromFiles,
    sendChat,
    sendGroupChat,
    stopSending,
    regenerateAssistantMessage,
    regenerateGroupAssistantMessage,
    replyFromUserMessage,
    replyFromUserMessageInGroup,
    createParallelBranchFromAssistantMessage,
    switchBranchByAssistantSibling,
    setActiveBranch,
    deleteMessage,
    deleteMessageSubtree,
    editMessage,
  } = chatOps

  // Fill placeholder
  pickImagesFn = pickImages

  // ============================================================
  // 17. PATCH OPERATIONS
  // ============================================================
  const patchOps = createPatchOperations({
    getState: () => state,
    storage,
    aiGateway: deps.aiGateway || createAiChatInternalGateway(capabilities),
    loadSplitMeta: loadSplitMetaCached,
    loadToolCallServerConfig: loadToolCallServerConfigFromStorage,
    netRequest: capabilities.net?.request || ((() => Promise.resolve({})) as any),
    withChatWriteLock,
    touchChatUpdatedAt,
    touchGroupChatUpdatedAt,
    writeChatUpdatedNotice,
    chatHasPendingAssistantInBranch,
    repairChatLinearBranching,
    emit,
    save,
    sendChat: (opts?: any) => sendChat(opts),
  })
  const { patchAssistantMessage, insertMessagesAfterMessageId, onAssistantRunFinal, submitChatCompletion } = patchOps

  // ============================================================
  // 18. UI POLLING
  // ============================================================
  const uiPolling = createUiPolling({
    getState: () => state,
    storage,
    rtStorage: runtimeStorage,
    aiGateway: deps.aiGateway || createAiChatInternalGateway(capabilities),
    loadSplitMeta: loadSplitMetaCached,
    getSplitMetaCache,
    emit,
    activeTargetKind,
    activeChatFromData,
    syncActiveGroupChatsFromStorage,
    save,
  })
  const { startUiPollers, uiPollTick, syncActiveRoleChatsFromStorage, syncActiveTargetChatsFromStorage, syncChatByIdFromStorage, syncGroupChatByIdFromStorage, applyChatUpdatedNoticeOnce, reapplyUiStreamCache } = uiPolling

  // ============================================================
  // 19. EVENT HANDLERS
  // ============================================================
  // Build placeholder actions object for eventHandlers (circular dep)
  const actionsPlaceholder: Record<string, any> = {
    emit,
    save: () => save(),
    render,
    renderTop: render,
    renderComposer,
    renderChat: render,
    renderModal: render,
    scrollToBottomSoon,
    closeModal,
    applyMermaidScaleDom,
    openMermaidViewer: mermaidOpenViewer,
    cancelMermaidDrag,
    onMouseMoveMermaid: mermaidMouseMove,
    onMouseUpMermaid: mermaidMouseUp,
    enqueueMermaidFixWrite,
    patchMessageContentSilent,
    activeRole,
    activeChat,
    activeGroup,
    activeTargetKind,
    getProvider,
    getRoleById,
    getGroupById,
    ensureChatsBox,
    ensureGroupChatsBox,
    clearPendingChat,
    clearPendingGroupChat,
    // These will be filled by the full actions object
    openProvidersEditor: () => openProvidersEditor(),
    createRole: () => createRole(),
    createChatForActiveTarget: () => createChatForActiveTarget(),
    openRoleEditor: (id: string) => openRoleEditor(id),
    pickChatForActiveTarget: (id: string) => pickChatForActiveTarget(id),
    removeDraftImage: (id: string) => { state.draft.images = removeDraftImageFromList(state.draft.images, String(id || '')); emit(); },
    removeDraftFile: (id: string) => { state.draft.files = removeDraftFile(state.draft.files, String(id || '')); emit(); },
    sendChat: () => sendChat(),
    pickImages: () => pickImages(),
    addDraftImagesFromFiles: async () => {},
    addDraftFilesFromFiles: (files: any) => addDraftFilesFromFiles(files),
    stop: () => stopSending().catch(() => {}),
    clearChatModelOverride: () => {},
    setChatModelOverride: () => {},
    refreshModels: (pid: string, force: boolean) => refreshModels(pid, force),
    setSideTab: (tab: string) => {},
    setActiveRole: (rid: string) => {},
    setActiveGroup: (gid: string) => {},
    setActiveChat: (cid: string) => {},
    hydrateRefImages,
  }

  const eventHandlers = createEventHandlers({
    getState: () => state,
    actions: actionsPlaceholder,
    emit,
    render,
    showToast: api.ui?.showToast,
    clipboard: api.clipboard,
    pickImages: api.files?.pickImages as any,
  })
  const { onClick, onWheel, onMouseDown, onInput, onChange, onKeyDown, onPaste, cancelMermaidDrag: evCancelMermaidDrag } = eventHandlers

  // ============================================================
  // 20. ACTIONS — complete controller.actions object
  // ============================================================
  const actions: Record<string, any> = {
    emit,
    setSideTab: (tab: any) => {
      state.sideTab = tab === 'chats' ? 'chats' : 'roles'
      emit()
    },
    setActiveRole: (roleId: any) => {
      clearPendingChat()
      clearPendingGroupChat()
      state.branchDraft = null
      ;(state.draft as any).activeTargetKind = 'role'
      state.draft.activeRoleId = String(roleId || '')
      ensureChatsBox(state.draft.activeRoleId)
      save().catch(() => {})
      emit()
    },
    setActiveGroup: (groupId: any) => {
      clearPendingChat()
      clearPendingGroupChat()
      state.branchDraft = null
      ;(state.draft as any).activeTargetKind = 'group'
      ;(state.draft as any).activeGroupId = String(groupId || '')
      ensureGroupChatsBox((state.draft as any).activeGroupId)
      save().catch(() => {})
      emit()
    },
    setActiveChat: (chatId: any) => {
      state.branchDraft = null
      pickChatForActiveTarget(String(chatId || ''))
    },
    toggleStream: () => {
      if (!state.data) return
      state.data.settings.streamEnabled = !state.data.settings.streamEnabled
      save().catch(() => {})
      emit()
    },
    toggleTransparentChatBg: () => {
      if (!state.data) return
      state.data.settings.transparentChatBg = !state.data.settings.transparentChatBg
      save().catch(() => {})
      emit()
    },
    setChatBgOpacity: (opacity: any, commit: any) => {
      if (!state.data) return
      state.data.settings.chatBgOpacity = clamp(Math.round(Number(opacity || 0)), 0, 100)
      if (commit) save().catch(() => {})
      emit()
    },
    setChatBgBlur: (blur: any, commit: any) => {
      if (!state.data) return
      state.data.settings.chatBgBlur = clamp(Math.round(Number(blur || 0)), 0, 24)
      if (commit) save().catch(() => {})
      emit()
    },
    setTopbarOpacity: (opacity: any, commit: any) => {
      if (!state.data) return
      state.data.settings.topbarOpacity = clamp(Math.round(Number(opacity || 0)), 0, 100)
      if (commit) save().catch(() => {})
      emit()
    },
    setTopbarBlur: (blur: any, commit: any) => {
      if (!state.data) return
      state.data.settings.topbarBlur = clamp(Math.round(Number(blur || 0)), 0, 24)
      if (commit) save().catch(() => {})
      emit()
    },
    setComposerOpacity: (opacity: any, commit: any) => {
      if (!state.data) return
      state.data.settings.composerOpacity = clamp(Math.round(Number(opacity || 0)), 40, 100)
      if (commit) save().catch(() => {})
      emit()
    },
    setComposerBlur: (blur: any, commit: any) => {
      if (!state.data) return
      state.data.settings.composerBlur = clamp(Math.round(Number(blur || 0)), 0, 24)
      if (commit) save().catch(() => {})
      emit()
    },
    setToolRequestRenderPreset: (preset: any) => {
      if (!state.data) return
      const v = String(preset || '').trim().slice(0, 60)
      state.data.settings.toolRequestRenderPreset = v || 'classic'
      save().catch(() => {})
      emit()
    },
    requestSetRenderSafetyPolicy: (policy: any) => {
      if (!state.data) return
      const raw = String(policy || '').trim()
      const next = raw === 'unsafe' ? 'unsafe' : raw === 'baseline' ? 'baseline' : 'original'
      const cur = currentRenderSafetyPolicy()
      if (next === cur) return
      if (next === 'unsafe') {
        ;(state.draft as any).renderSafetyPolicyTarget = next
        state.modal = 'confirm'
        emit()
        return
      }
      ;(state.data.settings as any).renderSafetyPolicy = next
      save().catch(() => {})
      emit()
    },
    setBranchTreeDir: (dir: any) => {
      if (!state.data) return
      if (!state.data.settings || typeof state.data.settings !== 'object') state.data.settings = {} as any
      if (!(state.data.settings as any).branchTree || typeof (state.data.settings as any).branchTree !== 'object')
        (state.data.settings as any).branchTree = { dir: 'lr', view: 'right', followSelected: true, modalHotkey: '' }
      const v = String(dir || '').trim()
      const ok = v === 'lr' || v === 'tb' || v === 'bt' || v === 'rl'
      ;(state.data.settings as any).branchTree.dir = ok ? v : 'lr'
      save().catch(() => {})
      emit()
    },
    setBranchTreeView: (view: any) => {
      if (!state.data) return
      if (!state.data.settings || typeof state.data.settings !== 'object') state.data.settings = {} as any
      if (!(state.data.settings as any).branchTree || typeof (state.data.settings as any).branchTree !== 'object')
        (state.data.settings as any).branchTree = { dir: 'lr', view: 'right', followSelected: true, modalHotkey: '' }
      const v = String(view || '').trim()
      const ok = v === 'right' || v === 'float'
      ;(state.data.settings as any).branchTree.view = ok ? v : 'right'
      save().catch(() => {})
      emit()
    },
    setBranchTreeFollowSelected: (enabled: any) => {
      if (!state.data) return
      if (!state.data.settings || typeof state.data.settings !== 'object') state.data.settings = {} as any
      if (!(state.data.settings as any).branchTree || typeof (state.data.settings as any).branchTree !== 'object')
        (state.data.settings as any).branchTree = { dir: 'lr', view: 'right', followSelected: true, modalHotkey: '' }
      ;(state.data.settings as any).branchTree.followSelected = !!enabled
      save().catch(() => {})
      emit()
    },
    setBranchTreeModalHotkey: (hotkey: any) => {
      if (!state.data) return
      if (!state.data.settings || typeof state.data.settings !== 'object') state.data.settings = {} as any
      if (!(state.data.settings as any).branchTree || typeof (state.data.settings as any).branchTree !== 'object')
        (state.data.settings as any).branchTree = { dir: 'lr', view: 'right', followSelected: true, modalHotkey: '' }
      const v = String(hotkey || '').trim().slice(0, 80)
      ;(state.data.settings as any).branchTree.modalHotkey = v
      save().catch(() => {})
      emit()
    },
    cloneToolRequestRenderPreset: (sourceId: any) => {
      if (!state.data) return
      const sid = String(sourceId || '').trim()
      if (!sid) return

      const userPresets = (state.data.settings as any).toolRequestRenderPresets
      const list = Array.isArray(userPresets) ? userPresets : []

      const builtin = findBuiltinToolRequestPreset(sid)
      const fromUser = list.find((x: any) => x && typeof x === 'object' && String(x?.id || '').trim() === sid) || null
      const src = builtin || fromUser
      if (!src) return api.ui?.showToast?.('未找到预设')

      const base = stringifyToolRequestRenderPreset(src)
      let obj: any = null
      try { obj = JSON.parse(base || '{}') } catch (_) {}
      if (!obj || typeof obj !== 'object') return api.ui?.showToast?.('复制失败（预设异常）')

      const genId = () => {
        const id = uid('tp').slice(0, 60)
        return id.replace(/[^a-zA-Z0-9._-]/g, '_')
      }
      const existingIds = new Set<string>([...BUILTIN_TOOL_REQUEST_PRESETS.map((x) => x.id), ...list.map((x: any) => String(x?.id || '').trim())])
      let nextId = ''
      for (let i = 0; i < 8; i++) {
        const tryId = genId()
        if (!existingIds.has(tryId)) { nextId = tryId; break }
      }
      if (!nextId) return api.ui?.showToast?.('复制失败（id 冲突）')

      obj.id = nextId
      obj.name = `${String(obj.name || '预设').trim() || '预设'}（副本）`.slice(0, 60)

      const v = validateToolRequestRenderPreset(obj)
      if (!v.ok || !v.preset) return api.ui?.showToast?.(v.error || '复制失败（预设无效）')

      ;(state.data.settings as any).toolRequestRenderPresets = normalizeToolRequestRenderPresets(list.concat([v.preset]))
      state.data.settings.toolRequestRenderPreset = v.preset.id
      save().catch(() => {})
      emit()
      api.ui?.showToast?.('已复制预设')
    },
    deleteToolRequestRenderPreset: (presetId: any) => {
      if (!state.data) return
      const id = String(presetId || '').trim()
      if (!id) return
      const list = Array.isArray((state.data.settings as any).toolRequestRenderPresets) ? ((state.data.settings as any).toolRequestRenderPresets as any[]) : []
      const next = list.filter((x: any) => String(x?.id || '').trim() !== id)
      ;(state.data.settings as any).toolRequestRenderPresets = normalizeToolRequestRenderPresets(next)
      if (String(state.data.settings.toolRequestRenderPreset || '').trim() === id) state.data.settings.toolRequestRenderPreset = 'classic'
      save().catch(() => {})
      emit()
      api.ui?.showToast?.('已删除预设')
    },
    importToolRequestRenderPresetJson: (jsonText: any) => {
      if (!state.data) return
      const raw = String(jsonText || '').trim()
      if (!raw) return api.ui?.showToast?.('请输入 JSON')

      let parsed: any = null
      try { parsed = JSON.parse(raw) } catch (e: any) {
        return api.ui?.showToast?.(`JSON 解析失败：${String(e?.message || e || 'unknown')}`)
      }

      const items = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.presets) ? parsed.presets : [parsed]
      if (!items.length) return api.ui?.showToast?.('JSON 里没有预设')

      const list = Array.isArray((state.data.settings as any).toolRequestRenderPresets) ? ((state.data.settings as any).toolRequestRenderPresets as any[]) : []
      const map = new Map<string, any>(list.map((x: any) => [String(x?.id || '').trim(), x]))

      let ok = 0
      let bad = 0
      for (const it of items) {
        const v = validateToolRequestRenderPreset(it)
        if (!v.ok || !v.preset) { bad++; continue }
        map.set(v.preset.id, v.preset)
        ok++
        if (ok >= 60) break
      }

      ;(state.data.settings as any).toolRequestRenderPresets = normalizeToolRequestRenderPresets(Array.from(map.values()))
      save().catch(() => {})
      emit()
      api.ui?.showToast?.(bad ? `导入完成：成功 ${ok}，失败 ${bad}` : `导入完成：成功 ${ok}`)
    },
    toggleUserMessageCollapse: () => {
      if (!state.data) return
      state.data.settings.userMessageCollapseEnabled = !state.data.settings.userMessageCollapseEnabled
      save().catch(() => {})
      emit()
    },
    setUserMessageCollapseLines: (lines: any, commit: any) => {
      if (!state.data) return
      state.data.settings.userMessageCollapseLines = clamp(Math.round(Number(lines || 8)), 1, 50)
      if (commit) save().catch(() => {})
      emit()
    },
    setAttachmentsSendLimitChars: (chars: any, commit: any) => {
      if (!state.data) return
      if (!state.data.settings.attachments || typeof state.data.settings.attachments !== 'object') {
        state.data.settings.attachments = { sendLimitChars: DEFAULT_ATTACH_SEND_LIMIT_CHARS } as any
      }
      const at = state.data.settings.attachments as any
      at.sendLimitChars = clamp(Math.round(Number(chars || DEFAULT_ATTACH_SEND_LIMIT_CHARS)), 1000, 2_000_000)
      if (commit) save().catch(() => {})
      emit()
    },
    setAttachmentsMaxFileSizeMb: (kind: any, mb: any, commit: any) => {
      if (!state.data) return
      const k = String(kind || '').trim()
      if (!CHAT_ATTACHMENT_KINDS.has(k)) return
      if (!state.data.settings.attachments || typeof state.data.settings.attachments !== 'object') {
        state.data.settings.attachments = { sendLimitChars: DEFAULT_ATTACH_SEND_LIMIT_CHARS, maxFileSizeMbByKind: {} } as any
      }
      const at = state.data.settings.attachments as any
      if (!at.maxFileSizeMbByKind || typeof at.maxFileSizeMbByKind !== 'object') at.maxFileSizeMbByKind = {}
      const n = Number(mb)
      const next = !isFinite(n) ? DEFAULT_ATTACH_MAX_FILE_MB : clamp(Math.round(n), 0, MAX_ATTACH_MAX_FILE_MB)
      at.maxFileSizeMbByKind[k] = next
      if (commit) save().catch(() => {})
      emit()
    },
    toggleStickersEnabled: () => {
      if (!state.data) return
      if (!state.data.settings.stickers || typeof state.data.settings.stickers !== 'object') state.data.settings.stickers = { enabled: false, categories: [], map: {} }
      state.data.settings.stickers.enabled = !state.data.settings.stickers.enabled
      save().catch(() => {})
      emit()
    },
    createStickerCategory: (categoryName: any) => {
      if (!state.data) return
      if (!state.data.settings.stickers || typeof state.data.settings.stickers !== 'object') state.data.settings.stickers = { enabled: false, categories: [], map: {} }
      const st = state.data.settings.stickers
      const v = validateStickerCategoryName(categoryName)
      if (!v.ok) return api.ui?.showToast?.(v.error || '分类名无效')

      const name = v.name
      if (!Array.isArray(st.categories)) st.categories = []
      if (st.categories.some((x: any) => String(x || '') === name)) return api.ui?.showToast?.('分类已存在')
      st.categories = st.categories.concat([name]).slice(0, 200)
      if (!st.map || typeof st.map !== 'object') st.map = {}
      if (!st.map[name] || typeof st.map[name] !== 'object') st.map[name] = {}
      save().catch(() => {})
      emit()
    },
    createFavoriteFolder: (name: any, parentId: any) => favOps.createFavoriteFolder(name, parentId),
    renameFavoriteFolder: (folderId: any, name: any) => favOps.renameFavoriteFolder(folderId, name),
    deleteFavoriteFolderKeepContents: (folderId: any, targetFolderId: any) => favOps.deleteFavoriteFolderKeepContents(folderId, targetFolderId),
    deleteFavoriteFolderTree: (folderId: any) => favOps.deleteFavoriteFolderTree(folderId),
    clearFavoriteFolderRefs: (folderId: any) => favOps.clearFavoriteFolderRefs(folderId),
    moveFavoriteFolder: (folderId: any, nextParentId: any) => favOps.moveFavoriteFolder(folderId, nextParentId),
    setChatFavoriteFolders: (targetKind: any, targetId: any, chatId: any, folderIds: any) => favOps.setChatFavoriteFolders(targetKind, targetId, chatId, folderIds),
    getChatFavoriteFolderIds: (targetKind: any, targetId: any, chatId: any) => favOps.getFavoriteFolderIdsForChat(targetKind, targetId, chatId),
    deleteStickerCategory: async (categoryName: any) => {
      if (!state.data) return
      const st = state.data.settings?.stickers
      if (!st || typeof st !== 'object') return

      const name = String(categoryName || '').trim()
      if (!name) return

      const box = st.map && typeof st.map === 'object' ? st.map[name] : null
      if (box && typeof box === 'object' && typeof api?.files?.images?.delete === 'function') {
        for (const v of Object.values(box)) {
          try {
            const relPath = v && typeof v === 'object' ? String((v as any).relPath || '').trim() : ''
            if (relPath) await api.files.images.delete({ scope: 'data', path: relPath }).catch(() => {})
          } catch (_) {}
        }
      }

      st.categories = Array.isArray(st.categories) ? st.categories.filter((x: any) => String(x || '').trim() !== name) : []
      if (st.map && typeof st.map === 'object') {
        try { delete st.map[name] } catch (_) {}
      }
      save().catch(() => {})
      emit()
    },
    addSticker: async (categoryName: any, stickerName: any, dataUrl: any) => {
      if (!state.data) return
      if (!state.data.settings.stickers || typeof state.data.settings.stickers !== 'object') state.data.settings.stickers = { enabled: false, categories: [], map: {} }

      const vCat = validateStickerCategoryName(categoryName)
      if (!vCat.ok) return api.ui?.showToast?.(vCat.error || '分类名无效')
      const cat = vCat.name

      const vName = validateStickerName(stickerName)
      if (!vName.ok) return api.ui?.showToast?.(vName.error || '表情名无效')
      const name = vName.name

      const r = await addStickerInternal(cat, name, dataUrl).catch((e: any) => ({ ok: false, kind: 'err' as const, error: e }))
      if (!r || !r.ok) {
        if (r?.kind === 'dup') return api.ui?.showToast?.('重名：该分类下已存在同名表情')
        if (r?.kind === 'no-perm') return api.ui?.showToast?.('未授权：files.images.writeBase64')
        if (r?.kind === 'bad-image') return api.ui?.showToast?.('图片格式不支持（仅支持 png/jpg/webp）')
        return api.ui?.showToast?.(String((r as any)?.error?.message || (r as any)?.error || '保存失败'))
      }

      save().catch(() => {})
      emit()
    },
    addStickersFromPickedImages: async (categoryName: any, pickedItems: any) => {
      if (!state.data) return
      const list = Array.isArray(pickedItems) ? pickedItems : []
      if (!list.length) return

      const vCat = validateStickerCategoryName(categoryName)
      if (!vCat.ok) return api.ui?.showToast?.(vCat.error || '分类名无效')
      const cat = vCat.name

      let ok = 0
      let dup = 0
      let bad = 0

      for (const it of list) {
        const fn = String(it?.name || '').trim()
        const base = fn ? fn.replace(/\.[a-zA-Z0-9]+$/, '').trim() : ''
        const vName = validateStickerName(base || `表情_${uid('n')}`)
        const name = vName.ok ? vName.name : `表情_${uid('n')}`
        const dataUrl = String(it?.dataUrl || '')
        try {
          const r = await addStickerInternal(cat, name, dataUrl).catch(() => ({ ok: false, kind: 'bad' as const }))
          if (r && (r as any).ok) ok++
          else if ((r as any)?.kind === 'dup') dup++
          else bad++
        } catch (_) { bad++ }
      }

      if (ok) { save().catch(() => {}); emit() }
      if (dup) api.ui?.showToast?.(`跳过重名：${dup} 个`)
      if (!ok && bad) api.ui?.showToast?.('导入失败')
    },
    deleteSticker: async (categoryName: any, stickerName: any) => {
      if (!state.data) return
      const st = state.data.settings?.stickers
      if (!st || typeof st !== 'object') return

      const cat = String(categoryName || '').trim()
      const name = String(stickerName || '').trim()
      if (!cat || !name) return

      const box = st.map && typeof st.map === 'object' ? st.map[cat] : null
      const it = box && typeof box === 'object' ? box[name] : null
      const relPath = it && typeof it === 'object' ? String(it.relPath || '').trim() : ''

      if (relPath && typeof api?.files?.images?.delete === 'function') {
        await api.files.images.delete({ scope: 'data', path: relPath }).catch(() => {})
      }

      if (box && typeof box === 'object') {
        try { delete box[name] } catch (_) {}
      }

      save().catch(() => {})
      emit()
    },
    renameSticker: (categoryName: any, oldStickerName: any, newStickerName: any) => {
      if (!state.data) return
      const st = state.data.settings?.stickers
      if (!st || typeof st !== 'object') return

      const vCat = validateStickerCategoryName(categoryName)
      if (!vCat.ok) return api.ui?.showToast?.(vCat.error || '分类名无效')
      const cat = vCat.name

      const oldName = String(oldStickerName || '').trim()
      if (!oldName) return

      const vName = validateStickerName(newStickerName)
      if (!vName.ok) return api.ui?.showToast?.(vName.error || '表情名无效')
      const name = vName.name

      if (name === oldName) return api.ui?.showToast?.('名称未变化')

      const box = st.map && typeof st.map === 'object' ? st.map[cat] : null
      if (!box || typeof box !== 'object') return api.ui?.showToast?.('分类不存在')

      const it = box[oldName]
      if (!it || typeof it !== 'object') return api.ui?.showToast?.('表情不存在')

      if (box[name]) return api.ui?.showToast?.('重名：该分类下已存在同名表情')

      const relPath = String((it as any).relPath || '').trim()
      if (!relPath) return api.ui?.showToast?.('映射损坏：缺少 relPath')

      const t = now()
      const createdAt = Number((it as any).createdAt || t)
      const next = { relPath, createdAt, updatedAt: t }
      box[name] = next
      try { delete box[oldName] } catch (_) {}

      save().catch(() => {})
      emit()
    },
    setMermaidFixEnabled: (on: any) => {
      if (!state.data) return
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.mermaidFix || typeof state.data.settings.aiServices.mermaidFix !== 'object') state.data.settings.aiServices.mermaidFix = {} as any
      state.data.settings.aiServices.mermaidFix.enabled = !!on
      save().catch(() => {})
      emit()
    },
    setMermaidFixProviderId: (providerId: any) => {
      if (!state.data) return
      const pid = String(providerId || '')
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.mermaidFix || typeof state.data.settings.aiServices.mermaidFix !== 'object') state.data.settings.aiServices.mermaidFix = {} as any
      state.data.settings.aiServices.mermaidFix.providerId = pid
      save().catch(() => {})
      emit()
    },
    setMermaidFixModelId: (modelId: any) => {
      if (!state.data) return
      const mid = String(modelId || '')
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.mermaidFix || typeof state.data.settings.aiServices.mermaidFix !== 'object') state.data.settings.aiServices.mermaidFix = {} as any
      state.data.settings.aiServices.mermaidFix.modelId = mid
      save().catch(() => {})
      emit()
    },
    setMermaidFixCustomModelId: (customModelId: any) => {
      if (!state.data) return
      const mid = String(customModelId || '')
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.mermaidFix || typeof state.data.settings.aiServices.mermaidFix !== 'object') state.data.settings.aiServices.mermaidFix = {} as any
      state.data.settings.aiServices.mermaidFix.customModelId = mid
      save().catch(() => {})
      emit()
    },
    setMermaidFixSystemPrompt: (systemPrompt: any) => {
      if (!state.data) return
      const p = typeof systemPrompt === 'string' ? systemPrompt : String(systemPrompt ?? '')
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.mermaidFix || typeof state.data.settings.aiServices.mermaidFix !== 'object') state.data.settings.aiServices.mermaidFix = {} as any
      state.data.settings.aiServices.mermaidFix.systemPrompt = p
      save().catch(() => {})
      emit()
    },
    resetMermaidFixSystemPromptDefault: () => {
      if (!state.data) return
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.mermaidFix || typeof state.data.settings.aiServices.mermaidFix !== 'object') state.data.settings.aiServices.mermaidFix = {} as any
      state.data.settings.aiServices.mermaidFix.systemPrompt = DEFAULT_MERMAID_FIX_SYSTEM_PROMPT
      save().catch(() => {})
      emit()
    },
    setChatTitleNamingEnabled: (on: any) => {
      if (!state.data) return
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.chatTitleNaming || typeof state.data.settings.aiServices.chatTitleNaming !== 'object') state.data.settings.aiServices.chatTitleNaming = {} as any
      state.data.settings.aiServices.chatTitleNaming.enabled = !!on
      save().catch(() => {})
      emit()
    },
    setChatTitleNamingProviderId: (providerId: any) => {
      if (!state.data) return
      const pid = String(providerId || '')
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.chatTitleNaming || typeof state.data.settings.aiServices.chatTitleNaming !== 'object') state.data.settings.aiServices.chatTitleNaming = {} as any
      state.data.settings.aiServices.chatTitleNaming.providerId = pid
      save().catch(() => {})
      emit()
    },
    setChatTitleNamingModelId: (modelId: any) => {
      if (!state.data) return
      const mid = String(modelId || '')
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.chatTitleNaming || typeof state.data.settings.aiServices.chatTitleNaming !== 'object') state.data.settings.aiServices.chatTitleNaming = {} as any
      state.data.settings.aiServices.chatTitleNaming.modelId = mid
      save().catch(() => {})
      emit()
    },
    setChatTitleNamingCustomModelId: (customModelId: any) => {
      if (!state.data) return
      const mid = String(customModelId || '')
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.chatTitleNaming || typeof state.data.settings.aiServices.chatTitleNaming !== 'object') state.data.settings.aiServices.chatTitleNaming = {} as any
      state.data.settings.aiServices.chatTitleNaming.customModelId = mid
      save().catch(() => {})
      emit()
    },
    setChatTitleNamingSystemPrompt: (systemPrompt: any) => {
      if (!state.data) return
      const p = typeof systemPrompt === 'string' ? systemPrompt : String(systemPrompt ?? '')
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.chatTitleNaming || typeof state.data.settings.aiServices.chatTitleNaming !== 'object') state.data.settings.aiServices.chatTitleNaming = {} as any
      state.data.settings.aiServices.chatTitleNaming.systemPrompt = p
      save().catch(() => {})
      emit()
    },
    resetChatTitleNamingSystemPromptDefault: () => {
      if (!state.data) return
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.chatTitleNaming || typeof state.data.settings.aiServices.chatTitleNaming !== 'object') state.data.settings.aiServices.chatTitleNaming = {} as any
      state.data.settings.aiServices.chatTitleNaming.systemPrompt = DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT
      save().catch(() => {})
      emit()
    },
    setStickerNamingEnabled: (on: any) => {
      if (!state.data) return
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.stickerNaming || typeof state.data.settings.aiServices.stickerNaming !== 'object') state.data.settings.aiServices.stickerNaming = {} as any
      state.data.settings.aiServices.stickerNaming.enabled = !!on
      save().catch(() => {})
      emit()
    },
    setStickerNamingProviderId: (providerId: any) => {
      if (!state.data) return
      const pid = String(providerId || '')
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.stickerNaming || typeof state.data.settings.aiServices.stickerNaming !== 'object') state.data.settings.aiServices.stickerNaming = {} as any
      state.data.settings.aiServices.stickerNaming.providerId = pid
      save().catch(() => {})
      emit()
    },
    setStickerNamingModelId: (modelId: any) => {
      if (!state.data) return
      const mid = String(modelId || '')
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.stickerNaming || typeof state.data.settings.aiServices.stickerNaming !== 'object') state.data.settings.aiServices.stickerNaming = {} as any
      state.data.settings.aiServices.stickerNaming.modelId = mid
      save().catch(() => {})
      emit()
    },
    setStickerNamingCustomModelId: (customModelId: any) => {
      if (!state.data) return
      const mid = String(customModelId || '')
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.stickerNaming || typeof state.data.settings.aiServices.stickerNaming !== 'object') state.data.settings.aiServices.stickerNaming = {} as any
      state.data.settings.aiServices.stickerNaming.customModelId = mid
      save().catch(() => {})
      emit()
    },
    setStickerNamingSystemPrompt: (systemPrompt: any) => {
      if (!state.data) return
      const p = typeof systemPrompt === 'string' ? systemPrompt : String(systemPrompt ?? '')
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.stickerNaming || typeof state.data.settings.aiServices.stickerNaming !== 'object') state.data.settings.aiServices.stickerNaming = {} as any
      state.data.settings.aiServices.stickerNaming.systemPrompt = p
      save().catch(() => {})
      emit()
    },
    resetStickerNamingSystemPromptDefault: () => {
      if (!state.data) return
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.stickerNaming || typeof state.data.settings.aiServices.stickerNaming !== 'object') state.data.settings.aiServices.stickerNaming = {} as any
      state.data.settings.aiServices.stickerNaming.systemPrompt = DEFAULT_STICKER_NAMING_SYSTEM_PROMPT
      save().catch(() => {})
      emit()
    },
    setToolCallServerBaseUrl: (baseUrl: any) => {
      if (!state.data) return
      const v = String(baseUrl ?? '').trim()
      if (!state.data.settings.toolCallServer || typeof state.data.settings.toolCallServer !== 'object') state.data.settings.toolCallServer = {} as any
      state.data.settings.toolCallServer.baseUrl = v || DEFAULT_TOOL_CALL_SERVER_BASE_URL
      saveMetaOnly().catch(() => {})
      emit()
    },
    setToolCallServerToken: (token: any) => {
      if (!state.data) return
      const v = typeof token === 'string' ? token : String(token ?? '')
      if (!state.data.settings.toolCallServer || typeof state.data.settings.toolCallServer !== 'object') state.data.settings.toolCallServer = {} as any
      state.data.settings.toolCallServer.token = v
      saveMetaOnly().catch(() => {})
      emit()
    },
    closeModal: () => closeModal(),
    openProviders: () => openProvidersEditor(),
    createProvider: () => createProvider(),
    openProviderEditor: (providerId: any) => openProviderInlineEditor(String(providerId || '')),
    closeProviderEditor: () => {
      state.draft.editProviderId = ''
      emit()
    },
    saveProvider: () => saveProviderInlineEditor(),
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
    confirmDelete: () => {
      const rid = String(state.draft.deleteRoleId || '')
      const gid = String((state.draft as any).deleteGroupId || '')
      const pid = String(state.draft.deleteProviderId || '')
      const nextRenderSafetyPolicy = String((state.draft as any).renderSafetyPolicyTarget || '').trim() === 'unsafe' ? 'unsafe' : ''
      closeModal()
      if (rid) deleteRole(rid)
      if (gid) deleteGroup(gid)
      if (pid) deleteProvider(pid)
      if (nextRenderSafetyPolicy && state.data) {
        ;(state.data.settings as any).renderSafetyPolicy = nextRenderSafetyPolicy
        save().catch(() => {})
      }
      emit()
    },
    aiFixMermaid: (messageId: any, mermaidSrc: any, renderErrorMsg: any) => {
      let t0 = 0
      const cost = () => ((now() - t0) / 1000).toFixed(1)
      return Promise.resolve()
        .then(() => {
          t0 = now()
          api.ui?.showToast?.('AI 修复 Mermaid 中…')
          return aiFixMermaidInMessage(String(messageId || ''), String(mermaidSrc || ''), String(renderErrorMsg || ''))
        })
        .then((fixed: any) => {
          api.ui?.showToast?.(`Mermaid 已修复（${cost()}s）`)
          return fixed
        })
        .catch((e: any) => {
          const msg = String(e?.message || e || 'AI 修复 Mermaid 失败')
          api.ui?.showToast?.(`AI 修复 Mermaid 失败（${cost()}s）：${msg}`)
          throw e
        })
    },
    openMermaidViewer: (rootEl: any, srcEl: any) => {
      const root = rootEl instanceof Element ? rootEl : document.body
      const blocks = Array.from(root.querySelectorAll?.('.mermaid-block[data-mermaid="1"]') || [])
      const items: any[] = []
      const renderSafetyPolicy = currentRenderSafetyPolicy()
      for (const b of blocks) {
        const svg = b instanceof HTMLElement ? String(b.innerHTML || '') : ''
        if (!svg) continue
        items.push({ svg: sanitizeSvg(svg, renderSafetyPolicy) })
      }
      if (!items.length) return

      let idx = 0
      const src = srcEl instanceof Element ? srcEl : null
      if (src) {
        const i = blocks.findIndex((b) => b === src || (b instanceof HTMLElement && b.contains(src)))
        if (i >= 0) idx = i
      }
      state.mermaid.items = items
      state.mermaid.index = clamp(idx, 0, Math.max(0, items.length - 1))
      state.mermaid.scale = 1
      state.modal = 'mermaid'
      emit()
    },
    openImageViewer: (rootEl: any, srcEl: any) => {
      const root = rootEl instanceof Element ? rootEl : document.body
      const imgs = Array.from(root.querySelectorAll?.('img[data-fw-img="1"]') || [])
      const items: any[] = []
      const elToIdx = new Map()
      for (const img of imgs) {
        if (!(img instanceof HTMLImageElement)) continue
        const src = String(img.getAttribute('src') || '').trim()
        if (!src) continue
        const idx = items.length
        items.push({ src, alt: String(img.getAttribute('alt') || '图片') })
        elToIdx.set(img, idx)
      }
      if (!items.length) return

      let idx = 0
      const src = srcEl instanceof Element ? srcEl : null
      if (src) {
        const img = src instanceof HTMLImageElement ? src : (src.closest?.('img[data-fw-img="1"]') as any)
        const i = img instanceof HTMLImageElement ? elToIdx.get(img) : -1
        if (typeof i === 'number' && i >= 0) idx = i
      }

      state.imageViewer.items = items
      state.imageViewer.index = clamp(idx, 0, Math.max(0, items.length - 1))
      state.imageViewer.scale = 1
      state.modal = 'image'
      emit()
    },
    mermaidPrev: () => {
      const len = Array.isArray(state.mermaid.items) ? state.mermaid.items.length : 0
      if (!len) return
      state.mermaid.index = (Number(state.mermaid.index || 0) - 1 + len) % len
      state.mermaid.scale = 1
      emit()
    },
    mermaidNext: () => {
      const len = Array.isArray(state.mermaid.items) ? state.mermaid.items.length : 0
      if (!len) return
      state.mermaid.index = (Number(state.mermaid.index || 0) + 1) % len
      state.mermaid.scale = 1
      emit()
    },
    mermaidZoom: (dir: any) => {
      const factor = Number(dir || 0) >= 0 ? 1.12 : 1 / 1.12
      state.mermaid.scale = clamp(Number(state.mermaid.scale || 1) * factor, VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX)
      emit()
    },
    mermaidSetScale: (scale: any) => {
      state.mermaid.scale = clamp(Number(scale || 1), VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX)
      emit()
    },
    mermaidReset: () => {
      state.mermaid.scale = 1
      emit()
    },
    imagePrev: () => {
      const len = Array.isArray(state.imageViewer.items) ? state.imageViewer.items.length : 0
      if (!len) return
      state.imageViewer.index = (Number(state.imageViewer.index || 0) - 1 + len) % len
      state.imageViewer.scale = 1
      emit()
    },
    imageNext: () => {
      const len = Array.isArray(state.imageViewer.items) ? state.imageViewer.items.length : 0
      if (!len) return
      state.imageViewer.index = (Number(state.imageViewer.index || 0) + 1) % len
      state.imageViewer.scale = 1
      emit()
    },
    imageZoom: (dir: any) => {
      const factor = Number(dir || 0) >= 0 ? 1.12 : 1 / 1.12
      state.imageViewer.scale = clamp(Number(state.imageViewer.scale || 1) * factor, VIEWER_ZOOM_MIN, IMAGE_VIEWER_ZOOM_MAX)
      emit()
    },
    imageSetScale: (scale: any) => {
      state.imageViewer.scale = clamp(Number(scale || 1), VIEWER_ZOOM_MIN, IMAGE_VIEWER_ZOOM_MAX)
      emit()
    },
    imageReset: () => {
      state.imageViewer.scale = 1
      emit()
    },
    createChat: () => {
      return createChatForActiveTarget()
    },
    aiGenerateChatTitle: (roleId: any, chatId: any) => {
      let t0 = 0
      const cost = () => ((now() - t0) / 1000).toFixed(1)
      return Promise.resolve()
        .then(() => {
          t0 = now()
          api.ui?.showToast?.('AI 生成标题中…')
          return aiGenerateChatTitle(String(roleId || ''), String(chatId || ''))
        })
        .then((title: any) => {
          api.ui?.showToast?.(`已更新标题（${cost()}s）：${String(title || '').trim() || '（空）'}`)
          return title
        })
        .catch((e: any) => {
          const msg = String(e?.message || e || 'AI 生成标题失败')
          api.ui?.showToast?.(`AI 生成标题失败（${cost()}s）：${msg}`)
          throw e
        })
    },
    aiGenerateGroupChatTitle: (groupId: any, chatId: any) => {
      let t0 = 0
      const cost = () => ((now() - t0) / 1000).toFixed(1)
      return Promise.resolve()
        .then(() => {
          t0 = now()
          api.ui?.showToast?.('AI 生成标题中…')
          return aiGenerateGroupChatTitle(String(groupId || ''), String(chatId || ''))
        })
        .then((title: any) => {
          api.ui?.showToast?.(`已更新标题（${cost()}s）：${String(title || '').trim() || '（空）'}`)
          return title
        })
        .catch((e: any) => {
          const msg = String(e?.message || e || 'AI 生成标题失败')
          api.ui?.showToast?.(`AI 生成标题失败（${cost()}s）：${msg}`)
          throw e
        })
    },
    aiGenerateStickerName: (categoryName: any, stickerName: any) => {
      let t0 = 0
      const cost = () => ((now() - t0) / 1000).toFixed(1)
      return Promise.resolve()
        .then(() => {
          t0 = now()
          api.ui?.showToast?.('AI 取名中…')
          return aiGenerateStickerName(String(categoryName || ''), String(stickerName || ''))
        })
        .then((name: any) => {
          api.ui?.showToast?.(`已更新表情名（${cost()}s）：${String(name || '').trim() || '（空）'}`)
          return name
        })
        .catch((e: any) => {
          const msg = String(e?.message || e || 'AI 取名失败')
          api.ui?.showToast?.(`AI 取名失败（${cost()}s）：${msg}`)
          throw e
        })
    },
    renameChat: (roleId: any, chatId: any, title: any) => renameChatTitle(String(roleId || ''), String(chatId || ''), String(title ?? '')),
    renameGroupChat: (groupId: any, chatId: any, title: any) => renameGroupChatTitle(String(groupId || ''), String(chatId || ''), String(title ?? '')),
    deleteChat: (roleId: any, chatId: any) => deleteChatForRole(String(roleId || ''), String(chatId || '')),
    deleteGroupChat: (groupId: any, chatId: any) => deleteChatForGroup(String(groupId || ''), String(chatId || '')),
    setDraft: (key: any, value: any) => {
      const k = String(key || '')
      if (!k) return
      ;(state.draft as any)[k] = value
      emit()
    },
    roleProviderChanged: (providerId: any) => {
      state.draft.roleProviderId = String(providerId || '')
      const p = getProvider(state.draft.roleProviderId)
      const cachedItems = Array.isArray(p?.modelsCache?.items) ? p.modelsCache.items : []
      state.models = { loading: false, error: '', items: cachedItems.slice(0, 300) }
      state.draft.roleModelId = ''
      state.draft.roleCustomModelId = ''
      emit()
    },
    roleModelChanged: (modelId: any) => {
      state.draft.roleModelId = String(modelId || '')
      emit()
    },
    refreshModels: (providerId: any, force: any) => refreshModels(String(providerId || ''), !!force),
    pickRoleAvatarImage: () => pickRoleAvatarImage(),
    clearRoleAvatarImage: () => clearRoleAvatarImage(),
    pickGroupAvatarImage: () => pickGroupAvatarImage(),
    clearGroupAvatarImage: () => clearGroupAvatarImage(),
    removeDraftImage: (id: any) => {
      state.draft.images = removeDraftImageFromList(state.draft.images, String(id || ''))
      emit()
    },
    removeDraftFile: (id: any) => {
      state.draft.files = removeDraftFile(state.draft.files, String(id || ''))
      emit()
    },
    setDraftFileSendPct: (id: any, pct: any) => {
      const rid = String(id || '')
      if (!rid) return
      if (!Array.isArray(state.draft.files)) state.draft.files = []
      const it = state.draft.files.find((x: any) => String(x?.id || '') === rid)
      if (!it) return
      it.sendPct = clamp(Math.round(Number(pct ?? 100)), 0, 100)
      emit()
    },
    pickImages: () => pickImages(),
    addDraftImagesFromFiles: async (files: any) => {
      const list = Array.isArray(files) ? files : []
      const left = Math.max(0, MAX_DRAFT_IMAGES - (Array.isArray(state.draft.images) ? state.draft.images.length : 0))
      let added = 0
      for (const f of list.slice(0, left)) {
        try {
          const dataUrl = await readFileAsDataUrl(f)
          if (addDraftImage(String(f?.name || '图片'), dataUrl)) added++
        } catch (_) {}
      }
      if (!added) api.ui?.showToast?.('未识别到图片')
      emit()
    },
    addDraftFilesFromFiles: async (files: any) => {
      await addDraftFilesFromFiles(Array.isArray(files) ? files : [])
    },
    send: () => sendChat(),
    sendFromMid: (forkFromMid: any) => sendChat({ forkFromMid: String(forkFromMid || '') }),
    stop: () => {
      stopSending().catch(() => {})
    },
    regenerateAssistant: (assistantMid: any) => regenerateAssistantMessage(String(assistantMid || '')),
    replyFromUserMessage: (userMid: any) => replyFromUserMessage(String(userMid || '')),
    createBranchFromAssistant: (assistantMid: any) => createParallelBranchFromAssistantMessage(String(assistantMid || '')),
    switchBranchSibling: (assistantMid: any, delta: any) => switchBranchByAssistantSibling(String(assistantMid || ''), Number(delta || 0)),
    setActiveBranch: (branchId: any) => setActiveBranch(String(branchId || '')),
    setChatModelOverride: (providerId: any, modelId: any) => {
      if (!state.data) return
      const role = activeRole()
      const chat = activeChatFromData()
      if (!role || !chat) return

      const pid = String(providerId || '').trim()
      const mid = String(modelId || '').trim()
      if (!pid || !mid) return api.ui?.showToast?.('供应商/模型 不能为空')

      const p = getProvider(pid)
      if (!p) return api.ui?.showToast?.('未找到该供应商')

      chat.modelOverride = { providerId: pid, modelId: mid }
      chat.updatedAt = now()
      save().catch(() => {})
      emit()
      api.ui?.showToast?.('已设置当前会话临时模型')
    },
    clearChatModelOverride: () => {
      if (!state.data) return
      const chat = activeChatFromData()
      if (!chat) return
      try { delete chat.modelOverride } catch (_e) { chat.modelOverride = null }
      chat.updatedAt = now()
      save().catch(() => {})
      emit()
      api.ui?.showToast?.('已清除当前会话临时模型')
    },
    deleteMessage: (messageId: any) => deleteMessage(String(messageId || '')),
    deleteMessageSubtree: (messageId: any) => deleteMessageSubtree(String(messageId || '')),
    editMessage: (messageId: any, content: any) => editMessage(String(messageId || ''), content),
    // UI event bridge
    hydrateRefImages,
    applyMermaidScaleDom,
    renderMermaidModalDom,
    cancelMermaidDrag: evCancelMermaidDrag,
    onMouseMoveMermaid: mermaidMouseMove,
    onMouseUpMermaid: mermaidMouseUp,
    enqueueMermaidFixWrite,
    patchMessageContentSilent,
    // Internal helpers exposed as actions for eventHandlers
    save: () => save(),
    render,
    renderTop: render,
    renderChat: render,
    renderSide: render,
    renderComposer,
    renderModal: render,
    scrollToBottomSoon,
    activeRole,
    activeChat,
    activeGroup,
    getProvider,
    getRoleById,
    getGroupById,
    ensureChatsBox,
    ensureGroupChatsBox,
    clearPendingChat,
    clearPendingGroupChat,
    openProvidersEditor,
    openNewRoleEditor,
    openNewGroupEditor,
    openRoleEditorRaw: (rid: string) => openRoleEditor(rid),
    openGroupEditorRaw: (gid: string) => openGroupEditor(gid),
    createChatForActiveTargetRaw: () => createChatForActiveTarget(),
    pickChatForActiveTargetRaw: (cid: string) => pickChatForActiveTarget(cid),
    addDraftImageFn: addDraftImage,
    addDraftFilesFromFilesFn: addDraftFilesFromFiles,
    readFileAsDataUrl,
  }

  // ============================================================
  // 21. INIT
  // ============================================================
  async function init() {
    await ensureRenderer().catch(() => {})
    await load()
    startUiPollers()
    render()
  }

  // ============================================================
  // 22. CONTROLLER
  // ============================================================
  const controller: AiChatController = {
    capabilities,
    defaults: {
      mermaidFixSystemPrompt: DEFAULT_MERMAID_FIX_SYSTEM_PROMPT,
      chatTitleNamingSystemPrompt: DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT,
      stickerNamingSystemPrompt: DEFAULT_STICKER_NAMING_SYSTEM_PROMPT,
    },
    getState: () => state,
    getSnapshot: () => getVer(),
    subscribe,
    fmtTime,
    activeRole,
    activeChat,
    getProvider,
    renderAssistantInto,
    actions,
  }

  return { controller, init }
}
