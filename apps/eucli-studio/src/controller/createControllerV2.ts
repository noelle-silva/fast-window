// eucli-studio V2 controller: DI assembled from extracted modules.
import { createUnifiedAssistantRenderEngine } from '../render/unified/engine'
import { createRenderPrewarmService } from './renderPrewarm'
import type { AiChatCapabilities } from '../gateway/capabilities'
import type { AiChatController } from './types'
import type { AiChatAssistService } from '../protocol/aiChatProtocol'

// ---- domain ----
import {
  DEFAULT_MERMAID_FIX_SYSTEM_PROMPT,
  DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT,
  DEFAULT_STICKER_NAMING_SYSTEM_PROMPT,
} from '../domain/constants'
import { createDraftActions } from './actions/draftActions'
import {
  activateComposerDraftForCurrentSession,
  readActiveComposerDraft,
} from '../domain/sessionComposerDrafts'
import { pendingChatForTarget } from '../domain/pendingChat'
import { writeActiveChatSelection } from '../domain/activeChatSelection'
import { writeChatListProjection } from '../domain/chatListProjection'
import { activeBranchHeadMidOrLast } from '../domain/branching'
import { currentSwitchSpan } from '../domain/switchSpan'
import { refreshScopes } from '../domain/uiRefreshScope'

// ---- storage ----
import { createStickerStorage } from '../storage/stickerStorage'
import { createFactoryClientData, createSplitStorage } from '../storage/splitStorage'
import { createLazyChatStore } from '../storage/lazyChatStore'
import { createSessionWriteGuard } from '../storage/sessionWriteGuard'
import { normalizeStoredChat } from '../storage/normalizeStoredChat'
import { createProjectionPipeline } from './projectionPipeline'
import { loadSessionEditSnapshot } from './sessionEditSnapshot'

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
import { createModelGroupsController } from './modelGroups'
import { createFavoritesOperations } from './favoritesOperations'
import { createDeskOperations } from './deskOperations'
import { createDeskActions } from './actions/deskActions'
import { createEntityEditors } from './entityEditors'
import { createEntityAuthorityReader } from './entityAuthority'
import { createProviderAuthorityReader } from './providerAuthority'
import { createChatOperations } from './chatOperations'
import type { ChatOperationsDeps } from './chatOperationsShared'
import { createPersistence } from './persistence'
import { createWorkspaceManager } from './workspaceManager'
import { saveEntityOrder } from './entityOrderBridge'
import { createAccessSettingsController } from './accessSettingsController'
import { updateGroupSessionTitle, updateRoleSessionTitle } from './ebRoleSession'
import { createEbRunEventConsumer } from './ebRunEvents'
import { createRunProbe } from './runProbe'
import { createChatLoadFailureTracker } from './chatLoadFailure'
import { createToolCatalog } from './toolCatalog'
import { createToolWorkDirectoryController } from './toolWorkDirectory'
import { createInstallSourceClient } from './installSourceClient'
import { createModelRequestConfigController } from './modelRequestConfig'
import { createConversationImageConfigController } from './conversationImageConfig'
import { createRequestRecordsController } from './requestRecords'
import { parseWorkspaceRoleTargetId, workspaceRoleTargetId } from '../domain/workspaceRoleTarget'
import { loadWorkspaceSession } from './workspaceBridge'
import { createChatSessionTarget, chatSettingsTargetKey, type ChatSettingsTarget } from './chatSessionTarget'
import { createChatSettingsSaveQueue, type ChatSettingsAction } from './chatSettingsSaveQueue'
import { createInitialControllerState } from './controllerState'
import { createHookPromptLibraryController } from './hookPromptLibraryController'
import { createPlaceholderLibraryController } from './placeholderLibraryController'
import { createSystemPluginController } from './systemPluginController'
import { createChatSessionSettingsBridge } from './chatSessionSettingsBridge'
import { createControllerBootstrap } from './controllerBootstrap'
import { createAppearanceActions } from './actions/appearanceActions'
import { createRequestRecordViewActions } from './actions/requestRecordViewActions'
import { createAiServiceActions } from './actions/aiServiceActions'
import { createStickerActions } from './actions/stickerActions'
import { createWallpaperActions } from './actions/wallpaperActions'
import { createFavoriteActions } from './actions/favoriteActions'
import { createEntityActions } from './actions/entityActions'
import { createToolActions } from './actions/toolActions'
import { createModelActions } from './actions/modelActions'
import { createAccessActions } from './actions/accessActions'
import { createLibraryActions } from './actions/libraryActions'
import { createPromptLibraryController } from './promptLibraryController'
import { createChatNavigationActions } from './actions/chatNavigationActions'
import { createChatInteractionActions } from './actions/chatInteractionActions'
import { createViewerActions } from './actions/viewerActions'
import { fmtTime, createModalHelpers } from './controllerHelpers'

export function createAiChatControllerV2(deps: { capabilities: AiChatCapabilities }): {
  controller: AiChatController
  init: (options?: { businessAvailable?: boolean }) => Promise<void>
} {
  const capabilities = deps.capabilities
  const api = capabilities
  const storage = capabilities.storage

  // ============================================================
  // 1. STATE
  const state = createInitialControllerState()
  let disposed = false
  // 会话写回的代数守卫：删除会话 / target / 工作区时推进，
  // 所有「await 之后写回会话」的路径都必须携带令牌校验。
  const sessionWrites = createSessionWriteGuard()

  // ============================================================
  // 2. UI CORE
  // ============================================================
  const uiCore = createUiCore()
  const {
    emit: emitRaw,
    emitScope,
    subscribe,
    subscribeScope,
    getVer,
    getScopeVer,
  } = uiCore

  // 草稿镜像在「变更边界」同步，而不是在快照读取时同步。
  // 快照读取器必须纯：useSyncExternalStore 会在渲染期反复调用它，
  // 任何读时写入都会让选择器化踩坑（读到一半 state 被改）。
  function emit() {
    activateComposerDraftForCurrentSession(state)
    emitRaw()
  }

  // 域级地址通知：模块只声明自己变更的域，不再借全局通道。
  const emitSettings = () => emitScope(refreshScopes.settings())
  const emitEntity = (domain: string) => () => emitScope(refreshScopes.entities(domain))

  // ============================================================
  // 4. ASSISTANT RENDERER
  // ============================================================
  const assistantRenderer = createUnifiedAssistantRenderEngine(capabilities)
  const { ensureRenderer, renderAssistantInto: renderAssistantIntoRaw, sanitizeSvg } = assistantRenderer

  // 预计算缓存：线程池懒创建，渲染条件在每次调用时快照。
  const renderPrewarm = createRenderPrewarmService({
    sanitizeHtml: assistantRenderer.sanitizeHtml,
    getPolicy: currentRenderSafetyPolicy,
    getStickerSettings: currentStickerSettings,
  })

  // ============================================================
  // 5. INLINE HELPERS

  function getControllerState() {
    // 纯读取：快照读取器不得修改 state（草稿镜像已在 emit 边界同步）。
    return state
  }

  function scrollToBottomSoon() {
    // UI 负责滚动逻辑
  }

  function currentRenderSafetyPolicy() {
    const v = String((state.data?.settings as any)?.renderSafetyPolicy || '').trim()
    return v === 'unsafe' ? 'unsafe' : v === 'baseline' ? 'baseline' : 'original'
  }

  const { closeModal } = createModalHelpers({ state, emitScope })

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

  function currentStickerSettings() {
    return {
      enabled: !!state.data?.settings?.stickers?.enabled,
      getStickerPath: getStickerRelPath,
    }
  }

  // ============================================================
  // 5.1. RENDER ASSISTANT (bridge from assistant renderer to state)
  // ============================================================
  function renderAssistantInto(el: unknown, text: unknown, options?: any) {
    const stickers = currentStickerSettings()
    const renderSafetyPolicy = currentRenderSafetyPolicy()
    renderAssistantIntoRaw(el, text, {
      ...(options || {}),
      stickersEnabled: stickers.enabled,
      getStickerPath: stickers.getStickerPath,
      renderSafetyPolicy,
    })
  }

  // ============================================================
  // 6. STORAGE MODULES
  // ============================================================
  const stickerStore = createStickerStorage({
    filesImages: api.files?.images as any,
    storage,
    netRequest: capabilities.net?.request || ((() => Promise.resolve({})) as any),
    getState: () => state.data,
  })
  const {
    addStickerInternal,
    createStickerCategoryInternal,
    deleteStickerCategoryInternal,
    deleteStickerInternal,
    renameStickerInternal,
    reorderStickerCategoriesInternal,
    reorderStickersInternal,
    loadStickersFromSource,
    setStickersEnabled,
    syncRoleAvatarFile,
    syncGroupAvatarFile,
  } = stickerStore

  // 切换管线在 splitStore 之后装配（两者互相引用），这里先占位。
  // 用延迟引用而不是重排初始化顺序：splitStorage 需要「索引失效」与「偏好命令」
  // 两个回调，而管线需要 splitStorage 暴露的 loadSplitMeta / getSplitMetaCache。
  let projectionPipelineRef: ReturnType<typeof createProjectionPipeline> | null = null

  const splitStore = createSplitStorage({
    storage,
    syncRoleAvatarFile,
    syncGroupAvatarFile,
    getState: () => state,
    // 整包数据替换是 App 根的唯一语义：不能拆成某个实体地址。
    setState: (data: any) => {
      state.data = data
      emitScope(refreshScopes.appData())
    },
    onError: (msg: string) => { api.ui?.showToast?.(msg, { kind: 'error' }) },
    // 会话索引失效 → 投影缓存作废；缓存才是唯一读取入口。
    onSessionIndexInvalidated: (kind, targetId) => projectionPipelineRef?.invalidateSessionIndex(kind, targetId),
    // 实体集合 / folder 映射变化 → 目录缓存作废（会话索引仍然有效）。
    onCatalogInvalidated: () => projectionPipelineRef?.invalidateCatalog(),
    // activeChatId 是偏好命令：走 setActiveChat，不整包写索引。
    setActiveChatCommand: (kind, targetId, chatId) => {
      if (!projectionPipelineRef) return Promise.resolve(false)
      return projectionPipelineRef.activeSelection.select({ kind, targetId }, chatId)
    },
  })
  const {
    loadSplitMeta,
    loadClientPreferencesShell,
    getSplitMetaCache,
    ensureSplitStoreReady,
    setActiveRoleChatSelection,
    removeRoleChatEntry,
    setActiveGroupChatSelection,
    removeGroupChatEntry,
    saveMetaOnly,
    saveFavoritesOnly,
    saveDesksOnly,
    saveRoleEntity,
    removeRoleEntity,
    saveGroupEntity,
    removeGroupEntity,
    saveProviderEntity,
    removeProviderEntity,
  } = splitStore

  // 目录事实缓存由 splitStorage 独占：控制器和投影管线都只读同一份，
  // 实体写入更新它之后再发 onCatalogInvalidated，读路径不会看到旧目录。
  //
  // 切换管线：catalog + 每 target 一份 chatIndex + activeChatId 命令 + 会话正文单飞/LRU。
  // 会话索引已从 meta 剥离，读路径不再写盘，也不再拼 4 个 key 扇出。
  const projectionPipeline = createProjectionPipeline({
    storage,
    sessionSwitch: capabilities.sessionSwitch,
    loadSplitMeta,
    getSplitMetaCache,
    applyLocalSelection: (scope, chatId) => {
      const box =
        scope.kind === 'group'
          ? (state.data as any)?.chatsByGroup?.[scope.targetId]
          : state.data?.chatsByRole?.[scope.targetId]
      writeActiveChatSelection(box, chatId)
    },
    // head 端到端：首窗必须表达「用户在看哪条路径」。
    // 从本地已加载的会话读活动分支头；未加载时返回空串，
    // 由业务端按自己的默认路径切窗（等价旧行为）。
    resolveBranchHead: (scope, chatId) => {
      const box =
        scope.kind === 'group'
          ? (state.data as any)?.chatsByGroup?.[scope.targetId]
          : state.data?.chatsByRole?.[scope.targetId]
      const chats = Array.isArray(box?.chats) ? box.chats : []
      const chat = chats.find((item: any) => String(item?.id || '') === chatId) || null
      if (!chat) return ''
      return activeBranchHeadMidOrLast(chat)
    },
    // switchId 端到端：正文加载与偏好命令共享同一个值（三跳同源）。
    // 只取「当前这次切换」的句柄；没有进行中的切换时返回空串。
    resolveSwitchId: () => currentSwitchSpan()?.switchId || '',
    onError: (message) => api.ui?.showToast?.(message, { kind: 'error' }),
  })
  projectionPipelineRef = projectionPipeline

  const lazyChatStore = createLazyChatStore({
    storage,
    getState: () => state,
    loadSplitMeta,
    getSplitMetaCache,
    loadChatIndex: (scope) => projectionPipeline.loadChatIndex(scope),
    chatBodies: {
      load: (scope, chatId) => projectionPipeline.chatBodies.load(scope, chatId),
      invalidate: (scope, chatId) => projectionPipeline.invalidateChatBody(scope, chatId),
    },
    sessionWrites,
  })
  const {
    loadShell,
    loadChat: loadStoredChat,
    ensureChatLoaded: ensureStoredChatLoaded,
    ensureActiveChatLoaded: ensureStoredActiveChatLoaded,
    upsertLoadedChat,
    removeLoadedChat,
  } = lazyChatStore

  async function reloadRoleSession(roleIdRaw: any, sessionIdRaw: any) {
    const roleId = String(roleIdRaw || '').trim()
    const sessionId = String(sessionIdRaw || '').trim()
    if (!roleId || !sessionId) return null
    const token = sessionWrites.capture('role', roleId, sessionId)
    // 写路径之后必须重取正文：reloadChatBody 内部先失效再重取首窗
    // （窗口模式保留已翻出的更早窗口），随后 loadStoredChat 直接命中新正文。
    //
    // reloadChatBody 返回的是业务端原始字节（前端是唯一真解析方）；
    // 归一化统一由 upsertLoadedChat 这个「入状态唯一入口」完成，
    // 调用方不需要、也不允许各自决定会话形状。
    const fresh = await projectionPipeline.reloadChatBody({ kind: 'role', targetId: roleId }, sessionId)
    const chat = fresh && typeof fresh === 'object' ? fresh : await loadStoredChat('role', roleId, sessionId)
    if (!chat) return null
    // 读取期间会话被删除：这份正文属于上一代，不能写回。
    if (!sessionWrites.isCurrent(token)) return null
    const loaded = upsertLoadedChat('role', roleId, chat)
    ebRunEvents.flushSession(roleId, sessionId)
    return loaded
  }

  async function reloadGroupSession(groupIdRaw: any, sessionIdRaw: any) {
    const groupId = String(groupIdRaw || '').trim()
    const sessionId = String(sessionIdRaw || '').trim()
    if (!groupId || !sessionId) return null
    const token = sessionWrites.capture('group', groupId, sessionId)
    const fresh = await projectionPipeline.reloadChatBody({ kind: 'group', targetId: groupId }, sessionId)
    const chat = fresh && typeof fresh === 'object' ? fresh : await loadStoredChat('group', groupId, sessionId)
    if (!chat) return null
    if (!sessionWrites.isCurrent(token)) return null
    const loaded = upsertLoadedChat('group', groupId, chat)
    ebRunEvents.flushSession('group', groupId, sessionId)
    return loaded
  }

  async function reloadWorkspaceSession(workspaceIdRaw: any, roleIdRaw: any, sessionIdRaw: any) {
    const workspaceId = String(workspaceIdRaw || '').trim()
    const roleId = String(roleIdRaw || '').trim()
    const sessionId = String(sessionIdRaw || '').trim()
    if (!workspaceId || !roleId || !sessionId) return null
    const request = capabilities.net?.request
    if (typeof request !== 'function') return null
    const targetId = workspaceRoleTargetId(workspaceId, roleId)
    const token = sessionWrites.capture('workspace', targetId, sessionId)
    const chat = await loadWorkspaceSession(request, workspaceId, roleId, sessionId)
    if (!chat) return null
    if (!sessionWrites.isCurrent(token)) return null
    const loaded = upsertWorkspaceChat(workspaceId, chat)
    ebRunEvents.flushSession('workspace', targetId, sessionId)
    return loaded
  }

  // 写路径快照：profile=edit 才能拿到完整 parts（view 是被裁剪的渲染视图）。
  async function loadEditSnapshot(kind: 'role' | 'group', targetId: string, chatId: string) {
    // 写路径同样属于「一次切换」：带上同一个 switchId，box 侧 trace 才连续。
    return loadSessionEditSnapshot(
      { sessionSwitch: capabilities.sessionSwitch },
      { kind, targetId },
      chatId,
      { switchId: projectionPipeline.currentSwitchId() },
    )
  }

  // ============================================================
  // 6.1. UI RUNTIME CACHES
  // ============================================================
  const uiRefImgCache = new Map<string, string>()
  const uiRefImgPending = new Set<string>()

  // ============================================================
  // 7. STATE ACCESSORS
  // ============================================================
  const stateAccessors = createStateAccessors({ getState: () => state })
  const {
    getProvider,
    getRoleById,
    getGroupById,
    getWorkspaceById,
    activeTargetKind,
    activeRole,
    activeGroup,
    activeWorkspace,
    activeChatFromData,
    activeChat,
    clearPendingChat,
    clearPendingGroupChat,
    clearPendingWorkspaceChat,
    ensureGroupChatsBoxBare,
    ensureWorkspaceChatsBoxBare,
    ensureChatsBox,
    ensureChatsBoxBare,
  } = stateAccessors

  const chatSessionTarget = createChatSessionTarget({
    getState: () => state,
    activeTargetKind,
    activeChat,
    activeRole,
    activeGroup,
    activeWorkspace,
    pendingChatForTarget,
    workspaceRoleTargetId,
  })
  const { captureChatSettingsTarget, currentChatForSettingsTarget } = chatSessionTarget

  function isActiveChatSettingsTarget(target: ChatSettingsTarget) {
    const current = captureChatSettingsTarget()
    return !!current && chatSettingsTargetKey(current) === chatSettingsTargetKey(target)
  }

  const chatSettingsSaveQueue = createChatSettingsSaveQueue({
    getSavingByTarget: () => state.chatSettings.savingByTarget as Record<string, unknown>,
    resetSavingByTarget: () => { state.chatSettings.savingByTarget = {} },
    captureCurrentTarget: captureChatSettingsTarget,
    isActiveTarget: isActiveChatSettingsTarget,
    isDisposed: () => disposed,
    // 保存状态挂在具体会话上：按 target 发 session 地址，当前会话自己重渲染。
    onStateChanged: (target) => emitScope(refreshScopes.session(target.kind, target.targetId, target.sessionId)),
    onError: (message: string) => { api.ui?.showToast?.(message, { kind: 'error' }) },
  })

  // ============================================================
  // 8. PERSISTENCE
  // ============================================================
  const persistence = createPersistence({
    getState: () => state,
    saveMetaOnly,
  })
  const { savePreferences } = persistence

  // resetClientPreferences 是「用户在设置页显式恢复默认」的唯一入口。
  // 数据形状由 createFactoryClientData 统一生成：只重置客户端偏好，
  // 业务派生的 providers / stickers 与 assist 视图原样保留。
  async function resetClientPreferences() {
    if (!state.data) return
    const factory = createFactoryClientData(state.data)
    state.data.ui = factory.ui
    state.data.settings = factory.settings
    state.draft.activeRoleId = ''
    state.draft.activeGroupId = ''
    ;(state.draft as any).activeWorkspaceId = ''
    state.draft.activeTargetKind = 'role'
    ;(state.draft as any).colorThemeDraft = null
    // explicitReset 是唯一允许默认值覆盖历史偏好的显式意图。
    await savePreferences({ explicitReset: true })
    emitScope(refreshScopes.appData())
  }

  // 实体权威读取共用同一个通用工厂：路径与实体名称是唯一差异。
  const entityNetRequest = capabilities.net?.request || ((() => Promise.resolve({})) as any)
  const readProviderEntity = createProviderAuthorityReader(entityNetRequest)
  const readRoleEntity = createEntityAuthorityReader({
    netRequest: entityNetRequest,
    resourcePath: '/api/roles',
    entityLabel: '角色',
  })
  const readWorkspaceEntity = createEntityAuthorityReader({
    netRequest: entityNetRequest,
    resourcePath: '/api/workspaces',
    entityLabel: '工作区',
    // 工作区实体缺失时后端返回通用 storage.read_failed；用列表成员做仲裁。
    listFallback: { path: '/api/workspaces' },
  })

  // 取图与缩图是工作区图标、角色头像、群组头像共用的通道：
  // 装配方只建一次，谁需要谁注入，不在各模块里各写一份 canvas 缩放。
  const imageUtils = createImageUtils({
    filesImagesRead: (api.files?.images?.read as any) || ((() => Promise.resolve('')) as any),
    uiRefImgCache,
    uiRefImgPending,
  })
  const { readFileAsDataUrl, hydrateRefImages } = imageUtils
  const pickImageFiles = api.files?.pickImages as ((maxCount?: number) => Promise<any[]>) | undefined

  const workspaceManager = createWorkspaceManager({
    getState: () => state,
    netRequest: entityNetRequest,
    readWorkspaceEntity,
    emit,
    emitScope,
    closeModal,
    saveMeta: savePreferences,
    scrollToBottomSoon,
    pickImageFiles,
    shrinkImageDataUrl: imageUtils.shrinkImageDataUrl,
    showToast: api.ui?.showToast,
    activeTargetKind,
    activeRole,
    activeWorkspace,
    clearPendingWorkspaceChat,
    removeLoadedChat: (kind: 'role' | 'group' | 'workspace', targetId: string, chatId: string) => {
      if (kind === 'workspace') {
        const box = (state.data as any)?.chatsByWorkspace?.[String(targetId || '')]
        if (!box) return
        writeChatListProjection(box, { kind: 'remove', chatId, fallbackTitle: '工作区会话' })
        return
      }
      removeLoadedChat(kind as any, targetId, chatId)
    },
    sessionWrites,
    onChatDeleted: (kind, targetId, chatId) => {
      sessionWrites.invalidateSession(kind, targetId, chatId)
      // 会话从桌面上消失：删除事实只带会话标识，按标识摘除引用即可。
      deskOps.cleanupDeskRefsByChatId(chatId)
    },
    onWorkspaceDeleted: (workspaceId) => {
      sessionWrites.invalidateWorkspace(workspaceId)
      deskOps.cleanupDeskRefsForTarget('workspace', workspaceId)
    },
    cleanupFavoriteRefsForChat: (targetKind: string, targetId: string, roleId: string, chatId: string) =>
      favOps.cleanupFavoriteRefsForChat(targetKind, targetId, roleId, chatId),
    cleanupFavoriteRefsForTarget: (targetKind: string, targetId: string) => favOps.cleanupFavoriteRefsForTarget(targetKind, targetId),
  })
  const {
    refreshWorkspaces,
    ensureWorkspaceChatLoaded,
    ensureActiveWorkspaceChatLoaded,
    upsertWorkspaceChat,
    setActiveWorkspace,
    setWorkspaceRole,
    moveWorkspace,
    openNewWorkspaceEditor,
    openNewWorkspaceEditorInPlace,
    openWorkspaceEditor,
    openWorkspaceEditorInPlace,
    addWorkspaceDirectory,
    removeWorkspaceDirectory,
    setWorkspaceDirectoryField,
    setWorkspaceRoleRegistered,
    setWorkspaceIconSvg,
    pickWorkspaceIconImage,
    clearWorkspaceIcon,
    refreshWorkspacePromptPreview,
    saveWorkspaceEditor,
    deleteWorkspaceEditor,
    createChatForActiveWorkspace,
    pickChatForActiveWorkspace,
    renameWorkspaceChatTitle,
    deleteChatForWorkspace,
  } = workspaceManager

  async function ensureChatLoaded(kind: 'role' | 'group' | 'workspace', targetId: string, chatId: string) {
    if (kind === 'workspace') {
      const target = parseWorkspaceRoleTargetId(targetId)
      if (!target.workspaceId || !target.roleId) return null
      return chatLoadFailure.track(kind, targetId, chatId, () =>
        ensureWorkspaceChatLoaded(target.workspaceId, target.roleId, chatId),
      )
    }
    return chatLoadFailure.track(kind, targetId, chatId, () => ensureStoredChatLoaded(kind, targetId, chatId))
  }

  // 往上翻一窗：返回 true 表示确实加载了新消息，false 表示已经到顶。
  // UI 只依赖这个二值结果，不关心 cursor 的形状。
  async function loadOlderMessages() {
    const kind = activeTargetKind()
    if (kind !== 'role' && kind !== 'group') return false
    const target = kind === 'group' ? activeGroup() : activeRole()
    const targetId = String((target as any)?.id || '').trim()
    const chat = activeChatFromData()
    const chatId = String((chat as any)?.id || '').trim()
    if (!targetId || !chatId) return false
    const scope = { kind, targetId } as const
    const before = Array.isArray((chat as any)?.messages) ? (chat as any).messages.length : 0
    const token = sessionWrites.capture(kind, targetId, chatId)
    const merged = await projectionPipeline.loadOlderMessages(scope, chatId)
    // 翻页期间会话被删除：旧页不得并回内存。
    if (!sessionWrites.isCurrent(token)) return false
    const after = Array.isArray(merged?.messages) ? merged.messages.length : before
    if (after <= before) return false
    // 翻页结果并回内存：normalizeStoredChat 会补分支与消息字段。
    const normalized = normalizeStoredChat(merged, kind)
    if (normalized) upsertLoadedChat(kind, targetId, normalized)
    emitScope(refreshScopes.session(kind, targetId, chatId))
    return true
  }

  // 树视图的结构投影（design-4 P3）。
  //
  // 窗口模式只加载一窗（≤24 条），树视图若吃首窗消息就只画得出首屏那几条。
  // 这里取独立的 graph 投影（只有结构、没有正文），与分页窗口正交。
  // 后端没有 session.graph 时返回 null，调用方回落到本地消息（旧行为）。
  async function loadSessionGraph() {
    const kind = activeTargetKind()
    if (kind !== 'role' && kind !== 'group') return null
    const target = kind === 'group' ? activeGroup() : activeRole()
    const targetId = String((target as any)?.id || '').trim()
    const chat = activeChatFromData()
    const chatId = String((chat as any)?.id || '').trim()
    if (!targetId || !chatId) return null
    const sessionSwitch = capabilities.sessionSwitch
    if (!sessionSwitch?.hasFeature('session.graph')) return null
    try {
      // switchId 必须随正文/结构读取一起走：否则同一次切换里前端观测键
      // 与 studio→box 的 X-Eucli-Trace 不是同一个值，P0 三跳 trace 断链。
      const switchId = currentSwitchSpan()?.switchId || ''
      return await sessionSwitch.sessionGraph({ kind, targetId }, chatId, switchId ? { switchId } : undefined)
    } catch (_) {
      return null
    }
  }

  // 当前目标会话的「意图 id」：来自索引框的 activeChatId，而不是已加载正文。
  // 失败事实必须记在用户真正要打开的会话上——正文没加载出来时 activeChatFromData()
  // 必然为空，用它当键会让失败挂到一个不存在的会话上，UI 永远匹配不到。
  function activeChatSelectionId() {
    const kind = activeTargetKind()
    if (kind === 'workspace') {
      const workspaceId = String((activeWorkspace() as any)?.id || '').trim()
      const roleId = String((activeRole() as any)?.id || '').trim()
      const targetId = workspaceRoleTargetId(workspaceId, roleId)
      return String((state.data as any)?.chatsByWorkspace?.[targetId]?.activeChatId || '').trim()
    }
    const target = kind === 'group' ? activeGroup() : activeRole()
    const targetId = String((target as any)?.id || '').trim()
    const box = kind === 'group' ? state.data?.chatsByGroup?.[targetId] : state.data?.chatsByRole?.[targetId]
    return String(box?.activeChatId || '').trim()
  }

  async function ensureActiveChatLoaded() {
    const kind = activeTargetKind()
    const chatId = activeChatSelectionId()
    if (kind === 'workspace') {
      const workspace = activeWorkspace()
      const workspaceId = String((workspace as any)?.id || '').trim()
      const roleId = String((activeRole() as any)?.id || '').trim()
      // targetId 与 ensureChatLoaded 保持同一身份表达（workspaceId::roleId），
      // 否则同一会话会在两处加载路径上记成两个不同的失败格。
      return chatLoadFailure.track('workspace', workspaceRoleTargetId(workspaceId, roleId), chatId, () => ensureActiveWorkspaceChatLoaded())
    }
    const target = kind === 'group' ? activeGroup() : activeRole()
    const targetId = String((target as any)?.id || '').trim()
    return chatLoadFailure.track(kind, targetId, chatId, () => ensureStoredActiveChatLoaded())
  }

  // ============================================================
  // 8.1. SAVE & LOAD (bridge to splitStorage)
  // ============================================================
  const hookPromptLibraryController = createHookPromptLibraryController({
    getState: () => state,
    getNetRequest: () => capabilities.net?.request,
    emit: emitEntity('hookPrompts'),
    showToast: api.ui?.showToast,
  })
  const { refreshHookPromptLibrary, persistHookPromptLibrary, reorderHookPromptPresetOrder } = hookPromptLibraryController

  const placeholderLibraryController = createPlaceholderLibraryController({
    getState: () => state,
    getNetRequest: () => capabilities.net?.request,
    emit: emitEntity('placeholders'),
    showToast: api.ui?.showToast,
  })
  const { refreshPlaceholderLibrary, persistPlaceholderLibrary, reorderPlaceholders, refreshPlaceholderPreview, refreshPlaceholderDependencyTree, loadRolePlaceholderDependencyTree } = placeholderLibraryController

  const systemPluginController = createSystemPluginController({
    getState: () => state,
    getNetRequest: () => capabilities.net?.request,
    pickArchiveFile: api.files?.pickArchiveFile,
    pickArchiveFolder: api.files?.pickArchiveFolder,
    importArtifactPackage: api.artifacts?.import,
    emit: emitEntity('plugins'),
    showToast: api.ui?.showToast,
    refreshPlaceholderLibrary,
  })
  const {
    refreshSystemPlugins,
    moveSystemPlugin,
    openSystemPlugin,
    saveSystemPluginConfig,
    refreshAvailableSystemPluginPlaceholderInterfaces,
    installSystemPluginAction,
    updateSystemPluginAction,
    importSystemPluginPackage,
    importSystemPluginFolder,
    cancelSystemPluginInstall,
    syncSystemPluginInstallStates,
    setInstallTerminalListener: setSystemPluginInstallTerminalListener,
    createPlaceholderFromSystemPlugin,
    setSystemPluginEnabled,
    dispose: disposeSystemPluginController,
  } = systemPluginController

  const chatSessionSettingsBridge = createChatSessionSettingsBridge({
    getState: () => state,
    getNetRequest: () => capabilities.net?.request,
    emitScope,
    showToast: api.ui?.showToast,
    runChatSettingsSave,
    captureChatSettingsTarget,
    currentChatForSettingsTarget,
    isActiveChatSettingsTarget,
    upsertWorkspaceChat,
    upsertLoadedChat,
    sessionWrites,
  })
  const { applyChatSettingsAction, selectHookPromptForActiveChat } = chatSessionSettingsBridge

  // 正文加载失败的唯一记录点：任何一次正文加载都必须经过它，
  // 失败才会被 UI 看见并收敛成可重试的终态。
  const chatLoadFailure = createChatLoadFailureTracker({ getState: () => state, emitScope })

  // RunProbe：run 终态对账的唯一入口。
  // 事件是正常路径；探针只在「静默 / 重连 / 页面可见」时补一次权威快照。
  const runProbe = createRunProbe({
    netRequest: capabilities.net?.request || ((() => Promise.resolve({})) as any),
    subscribeDirectEvents: (capabilities.host as any)?.directEvents?.subscribe,
    onReconnected: (capabilities.host as any)?.directEvents?.onReconnected,
  })

  const controllerBootstrap = createControllerBootstrap({
    state,
    emitScope,
    showToast: api.ui?.showToast,
    getNetRequest: () => capabilities.net?.request,
    isDisposed: () => disposed,
    runProbe: runProbe,
    ensureSplitStoreReady,
    loadShell,
    refreshWorkspaces,
    ensureActiveWorkspaceChatLoaded,
    ensureStoredActiveChatLoaded,
    refreshHookPromptLibrary,
    refreshPlaceholderLibrary,
    reloadRoleSession,
    reloadGroupSession,
    reloadWorkspaceSession,
  })
  const { load, restoreActiveEbRoleRuns } = controllerBootstrap

  async function runChatSettingsSave(target: ChatSettingsTarget, action: ChatSettingsAction, value: unknown, work: (isCurrent: () => boolean) => Promise<void>, failText: string): Promise<'saved' | false> {
    return chatSettingsSaveQueue.runSave(target, action, value, work, failText)
  }

  async function waitForChatSettingsSave() {
    await chatSettingsSaveQueue.waitCurrentTargetSave()
  }

  // ============================================================
  // 11. MODEL REFRESH
  // ============================================================
  const modelRefresh = createModelRefresh({
    getState: () => state,
    getProvider,
    netRequest: capabilities.net?.request || ((() => Promise.resolve({})) as any),
    persistProvider: saveProviderEntity,
    emit: emitEntity('providers'),
    showToast: api.ui?.showToast,
  })
  const { refreshModels } = modelRefresh

  const modelGroupsController = createModelGroupsController({
    getState: () => state,
    netRequest: capabilities.net?.request || ((() => Promise.resolve({})) as any),
    emit: emitEntity('modelGroups'),
    showToast: api.ui?.showToast,
  })
  const {
    refreshModelGroups,
    saveModelGroups,
    moveModelGroup,
    createModelGroup,
    deleteModelGroup,
    setModelGroupField,
    createModelGroupModel,
    deleteModelGroupModel,
    setModelGroupModelField,
    createModelGroupMember,
    deleteModelGroupMember,
    setModelGroupMemberField,
  } = modelGroupsController

  const toolCatalog = createToolCatalog({
    getState: () => state,
    netRequest: capabilities.net?.request || ((() => Promise.resolve({})) as any),
    pickArchiveFile: api.files?.pickArchiveFile,
    pickArchiveFolder: api.files?.pickArchiveFolder,
    importArtifactPackage: api.artifacts?.import,
    emit: emitEntity('tools'),
    showToast: api.ui?.showToast,
  })
  const { refreshTools, moveTool, openToolConfig, closeToolConfig, showToolWorkDirectoryView, setToolConfigValue, removeToolConfigValue, setToolPromptDescriptionDraft, resetToolPromptDescriptionDraftToDefault, setToolCapabilityGrant, selectConfigFile, setConfigFileDraft, addConfigFile, removeConfigFile, saveSelectedToolConfig, installTool, updateTool, importToolPackage, importToolFolder, cancelToolInstall, syncToolInstallStates, setInstallTerminalListener: setToolInstallTerminalListener, dispose: disposeToolCatalog } = toolCatalog

  const installSourceClient = createInstallSourceClient({
    netRequest: capabilities.net?.request || ((() => Promise.resolve({})) as any),
  })
  const { get: getInstallSource, set: setInstallSource, listShelves: getShelves, addShelf, updateShelf, removeShelf } = installSourceClient

  // 「AI 工具默认工作目录」：配置在业务端，是否引导过由客户端持久化记忆。
  const toolWorkDirectory = createToolWorkDirectoryController({
    getState: () => state,
    netRequest: capabilities.net?.request || ((() => Promise.resolve({})) as any),
    storage,
    emit: emitEntity('toolWorkDirectory'),
    showToast: api.ui?.showToast,
  })
  const toolWorkDirectoryActions = { ...toolWorkDirectory }

  const modelRequestConfigController = createModelRequestConfigController({
    getState: () => state,
    netRequest: capabilities.net?.request || ((() => Promise.resolve({})) as any),
    emit: emitEntity('modelRequestConfig'),
    showToast: api.ui?.showToast,
  })
  const { refreshModelRequestConfig, setModelRequestConfigDraft, resetModelRequestConfigDraftToDefaults, saveModelRequestConfig } = modelRequestConfigController

  const conversationImageConfigController = createConversationImageConfigController({
    getState: () => state,
    netRequest: capabilities.net?.request || ((() => Promise.resolve({})) as any),
    emit: emitEntity('conversationImageConfig'),
    showToast: api.ui?.showToast,
  })
  const { refreshConversationImageConfig, setConversationImageConfigDraft, resetConversationImageConfigDraftToDefaults, saveConversationImageConfig } = conversationImageConfigController

  const requestRecordsController = createRequestRecordsController({
    getState: () => state,
    netRequest: capabilities.net?.request || ((() => Promise.resolve({})) as any),
    emit: emitEntity('requestRecords'),
    showToast: api.ui?.showToast,
  })
  const requestRecordActions = { ...requestRecordsController }

  const accessSettingsController = createAccessSettingsController({
    getState: () => state,
    netRequest: capabilities.net?.request || ((() => Promise.resolve({})) as any),
    emit: emitEntity('accessSettings'),
    showToast: api.ui?.showToast,
  })

  // ============================================================
  // 12. FAVORITES / DESKS OPERATIONS
  // ============================================================
  const favOps = createFavoritesOperations({
    getState: () => state,
    save: saveFavoritesOnly,
    // 收藏夹是 entities:favorites 域：树与弹层按该地址订阅。
    emitScope,
    showToast: api.ui?.showToast,
    activeTargetKind,
    activeRole,
    activeGroup,
  })

  // 工作桌面：与收藏夹同构的第二份会话去处数据，独立存储通道、独立实体域。
  const deskOps = createDeskOperations({
    getState: () => state,
    save: saveDesksOnly,
    emitScope,
    showToast: api.ui?.showToast,
  })
  const deskActions = createDeskActions({ deskOps })

  // getMessageById 读取当前活动会话中指定消息的实时对象：
  // 流式更新就地改写该对象，局部订阅者据此只重渲染那一条消息。
  function getMessageById(messageId: any) {
    const mid = String(messageId || '').trim()
    if (!mid) return null
    const chat = activeChat() || activeChatFromData()
    const msgs = Array.isArray(chat?.messages) ? chat.messages : []
    return msgs.find((m: any) => String(m?.id || '') === mid) || null
  }

  // getComposerDraft 读取当前会话的实时输入草稿（只读，不产生副作用）：
  // 输入区局部订阅者据此独立更新。
  function getComposerDraft() {
    return readActiveComposerDraft(state)
  }

  // ============================================================
  // 13. MERMAID UI
  // ============================================================
  function locateMessageInActiveChat(messageId: any) {
    const mid = String(messageId || '').trim()
    if (!mid) return null
    const kind = activeTargetKind()
    const targetEntity = kind === 'group' ? activeGroup() : kind === 'workspace' ? activeWorkspace() : activeRole()
    const targetId = String((targetEntity as any)?.id || '').trim()
    if (!targetId) return null
    const pendingChat =
      kind === 'group'
        ? state.pendingGroupChat && String(state.pendingGroupChat.groupId || '') === targetId
          ? state.pendingGroupChat.chat
          : null
        : kind === 'workspace'
          ? (state as any).pendingWorkspaceChat && String((state as any).pendingWorkspaceChat.workspaceId || '') === targetId
            ? (state as any).pendingWorkspaceChat.chat
            : null
        : state.pendingChat && String(state.pendingChat.roleId || '') === targetId
          ? state.pendingChat.chat
          : null
    const chat = pendingChat || activeChatFromData()
    if (!chat) return null
    const msgs = Array.isArray(chat.messages) ? chat.messages : []
    const targetMessage = msgs.find((m: any) => String(m?.id || '') === mid) || null
    if (!targetMessage) return null
    return { kind, targetId, chat, pendingChat, target: targetMessage }
  }

  const mermaidUi = createMermaidUi({
    getState: () => state,
    assistantRenderer,
    emitScope,
  })
  const {
    applyMermaidScaleDom,
    renderMermaidModalDom,
    openMermaidViewer: mermaidOpenViewer,
    cancelMermaidDrag: mermaidCancelDrag,
    onMouseMoveMermaid: mermaidMouseMove,
    onMouseUpMermaid: mermaidMouseUp,
  } = mermaidUi

  // ============================================================
  // 14. AI SERVICES (first pass with placeholders)
  // ============================================================
  const aiServices = createAiServices({
    netRequest: capabilities.net?.request || ((() => Promise.resolve({})) as any),
  })
  const { aiFixMermaidInMessage, aiGenerateChatTitle, aiGenerateGroupChatTitle, aiGenerateStickerName } = aiServices

  // ============================================================
  // 15. ENTITY EDITORS
  // ============================================================
  const entityEditors = createEntityEditors({
    getState: () => state,
    saveRoleEntity,
    removeRoleEntity,
    saveGroupEntity,
    removeGroupEntity,
    saveProviderEntity,
    removeProviderEntity,
    readProviderEntity,
    readRoleEntity,
    save: savePreferences,
    emitScope,
    closeModal,
    showToast: api.ui?.showToast,
    pickImageFiles,
    shrinkImageDataUrl: imageUtils.shrinkImageDataUrl,
    filesImages: api.files?.images as any,
    ensureChatLoaded: (rid: string, cid: string) => ensureChatLoaded('role', rid, cid),
    ensureGroupChatLoaded: (gid: string, cid: string) => ensureChatLoaded('group', gid, cid),
    renameRoleChatInStore: async (rid: string, cid: string, title: string) => {
      await updateRoleSessionTitle(capabilities.net?.request || ((() => Promise.resolve({})) as any), { roleId: rid, sessionId: cid, title })
      await reloadRoleSession(rid, cid)
    },
    renameGroupChatInStore: async (gid: string, cid: string, title: string) => {
      await updateGroupSessionTitle(capabilities.net?.request || ((() => Promise.resolve({})) as any), { groupId: gid, sessionId: cid, title })
      await reloadGroupSession(gid, cid)
    },
    removeChatInStore: (kind: 'role' | 'group', targetId: string, chatId: string) => kind === 'role' ? removeRoleChatEntry(targetId, chatId) : removeGroupChatEntry(targetId, chatId),
    setRoleActiveChatSelection: (roleId: string, chatId: string) => setActiveRoleChatSelection(roleId, chatId),
    setGroupActiveChatSelection: (groupId: string, chatId: string) => setActiveGroupChatSelection(groupId, chatId),
    removeLoadedChat,
    sessionWrites,
    onChatDeleted: (kind, targetId, chatId) => {
      sessionWrites.invalidateSession(kind, targetId, chatId)
      // 索引是 scope 级事实：删除一条会话必须让整个 scope 的索引换代，
      // 否则在途的索引读取会把已删除的会话重新写回列表。
      projectionPipeline.invalidateSessionIndex(kind, targetId)
      projectionPipeline.invalidateChatSession({ kind, targetId }, chatId)
      deskOps.cleanupDeskRefsByChatId(chatId)
    },
    onTargetDeleted: (kind, targetId) => {
      sessionWrites.invalidateTarget(kind, targetId)
      projectionPipeline.invalidateSessionIndex(kind, targetId)
      projectionPipeline.invalidateScopeSessions({ kind, targetId })
      deskOps.cleanupDeskRefsForTarget(kind, targetId)
    },
    cleanupFavoriteRefsForTarget: favOps.cleanupFavoriteRefsForTarget,
    cleanupFavoriteRefsForChat: favOps.cleanupFavoriteRefsForChat,
  })
  const {
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
    createChatForActiveTarget: createEntityChatForActiveTarget,
    pickChatForActiveTarget: pickEntityChatForActiveTarget,
    renameChatTitle,
    renameGroupChatTitle,
    deleteChatForRole,
    deleteChatForGroup,
  } = entityEditors

  function createChatForActiveTarget() {
    if (activeTargetKind() === 'workspace') return createChatForActiveWorkspace()
    return createEntityChatForActiveTarget()
  }

  function pickChatForActiveTarget(chatId: any) {
    if (activeTargetKind() === 'workspace') return pickChatForActiveWorkspace(chatId)
    return pickEntityChatForActiveTarget(chatId)
  }

  // ============================================================
  // 16. CHAT OPERATIONS
  // ============================================================
  const chatOperationsDeps: ChatOperationsDeps & { emitScope: (scope: string) => void } = {
    getState: () => state,
    pickImageFiles,
    netRequest: capabilities.net?.request || ((() => Promise.resolve({})) as any),
    showToast: api.ui?.showToast,
    ensureActiveChatLoaded,
    ensureChatLoaded: (kind: 'role' | 'group', targetId: string, chatId: string) => ensureChatLoaded(kind, targetId, chatId),
    ensureWorkspaceChatLoaded: (workspaceId: string, roleId: string, chatId: string) => ensureWorkspaceChatLoaded(workspaceId, roleId, chatId),
    reloadRoleSession,
    reloadGroupSession,
    reloadWorkspaceSession,
    // 写路径之后的正文失效：所有编辑 / 删除 / 运行落盘都要经过它，
    // 否则下一次读会命中写之前的正文（新消息消失、已删消息复活）。
    invalidateChatBody: (scope, chatId) => projectionPipeline.invalidateChatBody(scope, chatId),
    // pending 会话落成真实会话后：与普通点击共用同一偏好写入机制。
    persistActiveChatSelection: (kind, targetId, chatId) => {
      if (kind === 'group') return setActiveGroupChatSelection(targetId, chatId)
      return setActiveRoleChatSelection(targetId, chatId)
    },
    waitForChatSettingsSave,
    loadEditSnapshot,
    // 视图回写：把「用户在看哪条路径」变成服务端事实（design-4 决策 3）。
    // 后端没有 session.view.patch 时静默跳过，本地分支状态仍然有效。
    persistSessionView: async (kind, targetId, chatId, head, branchId) => {
      const sessionSwitch = capabilities.sessionSwitch
      if (!sessionSwitch?.hasFeature('session.view.patch')) return
      await sessionSwitch.setSessionView({ kind, targetId }, chatId, head, { branchId })
      // 视图变了，旧窗口属于旧路径：作废分页与正文，下次读按新 head 取。
      projectionPipeline.invalidateSessionWindow({ kind, targetId }, chatId)
      projectionPipeline.invalidateChatBody({ kind, targetId }, chatId)
    },
    emitScope,
    scrollToBottomSoon,
    readImageFileAsDataUrl: readFileAsDataUrl,
    runProbe,
    sessionWrites,
    // 草稿会话真实建立：把桌面上那条临时条目按原位转成正式引用。
    promoteDeskDraft: (pendingChatId: string, chatId: string) => {
      void deskOps.promoteDeskDraft(pendingChatId, chatId)
    },
  }
  const chatOps = createChatOperations(chatOperationsDeps)
  const {
    pickDraftImages,
    addDraftImagesFromFiles,
    sendChat,
    stopSending,
    regenerateAssistantMessage,
    replyFromUserMessage,
    createParallelBranchFromAssistantMessage,
    switchBranchByAssistantSibling,
    setActiveBranch,
    submitToolConfirmationDecision,
    deleteMessage,
    deleteMessageSubtree,
    editMessage,
    editMessageBlock,
    deleteMessageBlock,
    cleanMessageReasoning,
    cleanSessionReasoning,
  } = chatOps

  // ============================================================
  // 17. UI POLLING
  // ============================================================
  const ebRunEvents = createEbRunEventConsumer({
    getState: () => state,
    emitScope,
    subscribeDirectEvents: (capabilities.host as any)?.directEvents?.subscribe,
    // 视窗架构：运行事件只刷新画面，不把 UI 快照整包写回业务端。
    // 会话事实由业务端运行时持久化，终态由运行完成后的会话重读对账。
  })

  const uiPolling = createUiPolling({
    getState: () => state,
    emitScope,
    subscribeDirectEvents: (capabilities.host as any)?.directEvents?.subscribe,
    onReconnected: (capabilities.host as any)?.directEvents?.onReconnected,
    activeTargetKind,
    activeChatFromData,
    // 索引永远是权威读取：refreshChatIndex 绕过投影缓存确认服务端 revision。
    refreshChatIndex: (scope) => projectionPipeline.refreshChatIndex(scope),
    isChatIndexSnapshotCurrent: (scope, snapshot) => projectionPipeline.isChatIndexSnapshotCurrent(scope, snapshot),
    // 正文永远是权威重取：reloadChatBody 先失效再取，绝不返回缓存旧正文。
    // 事件 / 版本对账会带 authoritative，跳过本地视窗 head。
    reloadChatBody: (scope, chatId, options) => projectionPipeline.reloadChatBody(scope, chatId, options),
    // 入状态统一走 upsertLoadedChat（会话进入内存状态的唯一入口）。
    upsertLoadedChat: (kind, targetId, chat) => upsertLoadedChat(kind, targetId, chat),
    // 工作区会话与角色 / 群聊共用事件版本对账：拉取后仍走 workspace 的入状态入口。
    syncWorkspaceChatById: async (workspaceId, roleId, chatId) => {
      const loaded = await reloadWorkspaceSession(workspaceId, roleId, chatId)
      return !!loaded
    },
    // 断线恢复：工作区权威列表与摘要版本来自同一次读取，
    // 列表成员（新增 / 删除）与正文版本一起收敛。
    refreshWorkspaceChats: async (workspaceId, roleId) => {
      const facts = await workspaceManager.refreshActiveWorkspaceChats(workspaceId, roleId)
      return facts ? { chatVersions: facts.versions } : null
    },
    // 版本门必须同时看代际：服务端重建后 revision 可能相同。
    getEpoch: () => projectionPipeline.versions().epoch,
    sessionWrites,
  })
  const { startUiPollers, stopUiPollers } = uiPolling

  // ============================================================
  // 19. EVENT HANDLERS
  // ============================================================
  // Build placeholder actions object for eventHandlers (circular dep)
  const draftActionsPlaceholder = createDraftActions({ state, emitScope })
  const actionsPlaceholder: Record<string, any> = {
    save: () => savePreferences(),
    scrollToBottomSoon,
    closeModal,
    applyMermaidScaleDom,
    openMermaidViewer: mermaidOpenViewer,
    cancelMermaidDrag: mermaidCancelDrag,
    onMouseMoveMermaid: mermaidMouseMove,
    onMouseUpMermaid: mermaidMouseUp,
    activeRole,
    activeChat,
    activeGroup,
    activeTargetKind,
    getProvider,
    getRoleById,
    getGroupById,
    ensureChatsBox: ensureChatsBoxBare,
    ensureGroupChatsBox: ensureGroupChatsBoxBare,
    clearPendingChat,
    clearPendingGroupChat,
    ...draftActionsPlaceholder,
    // These will be filled by the full actions object
    openProvidersEditor: () => openProvidersEditor(),
    createRole: () => createRole(),
    createChatForActiveTarget: () => createChatForActiveTarget(),
    openRoleEditor: (id: string) => openRoleEditor(id),
    pickChatForActiveTarget: (id: string) => pickChatForActiveTarget(id),
    sendChat: () => sendChat(),
    pickDraftImages: () => pickDraftImages(),
    addDraftImagesFromFiles: (files: any) => addDraftImagesFromFiles(Array.isArray(files) ? files : []),
    stop: () => stopSending().catch(() => {}),
    clearChatModelOverride: () => {},
    setChatModelOverride: () => {},
    refreshModels: (pid: string, force: boolean) => refreshModels(pid, force),
    setSideTab: (tab: string) => {},
    setActiveRole: (rid: string) => {},
    setActiveGroup: (gid: string) => {},
    setActiveWorkspace: (wid: string) => {},
    setActiveChat: (cid: string) => {},
    hydrateRefImages,
  }

  const eventHandlers = createEventHandlers({
    getState: () => state,
    actions: actionsPlaceholder,
    showToast: api.ui?.showToast,
    clipboard: api.clipboard,
  })
  const { cancelMermaidDrag: evCancelMermaidDrag } = eventHandlers

  // ============================================================
  // 20. ACTIONS — complete controller.actions object
  // ============================================================
  const appearanceActions = createAppearanceActions({ state, emit: emitSettings, emitScope, saveMeta: savePreferences, showToast: api.ui?.showToast, currentRenderSafetyPolicy })
  const requestRecordViewActions = createRequestRecordViewActions({ state, emitScope, saveMeta: savePreferences })
  const aiServiceActionSet = createAiServiceActions({
    state,
    emit: emitSettings,
    emitScope,
    // AI 微服务配置是 e-b 的独立事实：只写目标 service，绝不触发本地 meta 保存。
    saveAssistConfig: (service: AiChatAssistService, config: Record<string, any>) => {
      const setter = api.assistConfig?.set
      if (!setter) return Promise.reject(new Error('当前宿主不支持 AI 微服务配置写入'))
      return setter(service, config)
    },
  })
  const stickerActions = createStickerActions({ state, emit: emitSettings, showToast: api.ui?.showToast, pickImageFiles, addStickerInternal, createStickerCategoryInternal, deleteStickerCategoryInternal, deleteStickerInternal, renameStickerInternal, reorderStickerCategoriesInternal, reorderStickersInternal, loadStickersFromSource, setStickersEnabled })
  const wallpaperActions = createWallpaperActions({
    state,
    emit: emitSettings,
    emitScope,
    saveMeta: savePreferences,
    showToast: api.ui?.showToast,
    pickImageFiles,
    writeImageBase64: api.files?.images?.writeBase64 as any,
    deleteImage: api.files?.images?.delete as any,
  })
  const favoriteActions = createFavoriteActions({ favOps })
  async function reorderRoles(roleIds: string[]) {
    const request = capabilities.net?.request
    if (typeof request !== 'function') throw new Error('业务请求通道不可用')
    await saveEntityOrder(request, 'roles', roleIds)
  }
  async function reorderProviders(providerIds: string[]) {
    const request = capabilities.net?.request
    if (typeof request !== 'function') throw new Error('业务请求通道不可用')
    await saveEntityOrder(request, 'providers', providerIds)
  }
  const entityActions = createEntityActions({
    state,
    emitScope,
    saveMeta: savePreferences,
    showToast: api.ui?.showToast,
    getProvider,
    closeModal,
    reorderRoles,
    reorderProviders,
    moveWorkspace,
    openProvidersEditor,
    openProviderInlineEditor,
    saveProviderInlineEditor,
    createProvider,
    deleteProvider,
    openRoleEditor,
    openRoleEditorInPlace,
    createRole,
    createRoleInPlace: openNewRoleEditorInPlace,
    saveRoleEditor,
    deleteRole,
    openGroupEditor,
    openGroupEditorInPlace,
    createGroup,
    createGroupInPlace: openNewGroupEditorInPlace,
    saveGroupEditor,
    deleteGroup,
    openWorkspaceEditor,
    openWorkspaceEditorInPlace,
    openNewWorkspaceEditor,
    createWorkspaceInPlace: openNewWorkspaceEditorInPlace,
    saveWorkspaceEditor,
    deleteWorkspaceEditor,
    addWorkspaceDirectory,
    removeWorkspaceDirectory,
    setWorkspaceDirectoryField,
    setWorkspaceRoleRegistered,
    setWorkspaceIconSvg,
    pickWorkspaceIconImage,
    clearWorkspaceIcon,
    refreshWorkspacePromptPreview,
    pickRoleAvatarImage,
    clearRoleAvatarImage,
    pickGroupAvatarImage,
    clearGroupAvatarImage,
    renameChatTitle,
    renameGroupChatTitle,
    renameWorkspaceChatTitle,
    deleteChatForRole,
    deleteChatForGroup,
    deleteChatForWorkspace,
  })
  const toolActions = createToolActions({
    state,
    emit: emitEntity('tools'),
    showToast: api.ui?.showToast,
    refreshTools,
    moveTool,
    openToolConfig,
    closeToolConfig,
    showToolWorkDirectoryView,
    setToolConfigValue,
    removeToolConfigValue,
    setToolPromptDescriptionDraft,
    resetToolPromptDescriptionDraftToDefault,
    setToolCapabilityGrant,
    selectConfigFile,
    setConfigFileDraft,
    addConfigFile,
    removeConfigFile,
    saveSelectedToolConfig,
    installTool,
    updateTool,
    importToolPackage,
    importToolFolder,
    cancelToolInstall,
    syncToolInstallStates,
    setToolInstallTerminalListener,
    getInstallSource,
    setInstallSource,
    getShelves,
    addShelf,
    updateShelf,
    removeShelf,
  })
  const modelActions = createModelActions({
    refreshModelRequestConfig,
    setModelRequestConfigDraft,
    resetModelRequestConfigDraftToDefaults,
    saveModelRequestConfig,
    refreshConversationImageConfig,
    setConversationImageConfigDraft,
    resetConversationImageConfigDraftToDefaults,
    saveConversationImageConfig,
    refreshModelGroups,
    saveModelGroups,
    moveModelGroup,
    createModelGroup,
    deleteModelGroup,
    setModelGroupField,
    createModelGroupModel,
    deleteModelGroupModel,
    setModelGroupModelField,
    createModelGroupMember,
    deleteModelGroupMember,
    setModelGroupMemberField,
    refreshModels,
  })
  const accessActions = createAccessActions({ accessSettingsController })
  const promptLibraryActions = createPromptLibraryController({
    getNetRequest: () => capabilities.net?.request,
    showToast: api.ui?.showToast,
  })
  const libraryActions = createLibraryActions({
    refreshHookPromptLibrary,
    persistHookPromptLibrary,
    reorderHookPromptPresetOrder,
    refreshPlaceholderLibrary,
    persistPlaceholderLibrary,
    reorderPlaceholders,
    refreshPlaceholderPreview,
    refreshPlaceholderDependencyTree,
    loadRolePlaceholderDependencyTree,
    refreshSystemPlugins,
    moveSystemPlugin,
    openSystemPlugin,
    saveSystemPluginConfig,
    refreshAvailableSystemPluginPlaceholderInterfaces,
    createPlaceholderFromSystemPlugin,
    setSystemPluginEnabled,
    cancelSystemPluginInstall,
    syncSystemPluginInstallStates,
    setSystemPluginInstallTerminalListener,
    installSystemPluginAction,
    updateSystemPluginAction,
    importSystemPluginPackage,
    importSystemPluginFolder,
    selectHookPromptForActiveChat,
  })
  const chatNavigationActions = createChatNavigationActions({
    state,
    emitScope,
    saveMeta: savePreferences,
    ensureActiveChatLoaded,
    ensureChatsBoxBare,
    ensureGroupChatsBoxBare,
    setActiveWorkspace,
    setWorkspaceRole,
    createChatForActiveTarget,
    pickChatForActiveTarget,
    pickDraftImages,
    addDraftImagesFromFiles,
  })
  const chatInteractionActions = createChatInteractionActions({
    state,
    emitScope,
    showToast: api.ui?.showToast,
    sendChat,
    stopSending,
    regenerateAssistantMessage,
    replyFromUserMessage,
    createParallelBranchFromAssistantMessage,
    switchBranchByAssistantSibling,
    setActiveBranch,
    submitToolConfirmationDecision,
    deleteMessage,
    deleteMessageSubtree,
    editMessage,
    editMessageBlock,
    deleteMessageBlock,
    cleanMessageReasoning,
    cleanSessionReasoning,
    captureChatSettingsTarget,
    currentChatForSettingsTarget,
    isActiveChatSettingsTarget,
    applyChatSettingsAction,
    isChatModelActionPending: (target: any) => chatSettingsSaveQueue.isTargetActionPending(target, 'model'),
    aiGenerateChatTitle,
    aiGenerateGroupChatTitle,
    aiGenerateStickerName,
    reloadRoleSession,
    reloadWorkspaceSession,
    ensureWorkspaceChatLoaded,
    loadStickersFromSource,
  })
  const viewerActions = createViewerActions({
    state,
    emitScope,
    showToast: api.ui?.showToast,
    activeChatFromData,
    sanitizeSvg,
    currentRenderSafetyPolicy,
    locateMessageInActiveChat,
    aiFixMermaidInMessage,
    reloadRoleSession,
    reloadWorkspaceSession,
  })

  const actions: Record<string, any> = {
    emit,
    ...appearanceActions,
    ...deskActions,
    ...deskActions,
    ...chatNavigationActions,
    ...aiServiceActionSet,
    ...stickerActions,
    ...wallpaperActions,
    ...favoriteActions,
    ...entityActions,
    ...toolActions,
    ...toolWorkDirectoryActions,
    ...requestRecordActions,
    ...requestRecordViewActions,
    ...modelActions,
    ...accessActions,
    ...libraryActions,
    ...promptLibraryActions,
    ...chatInteractionActions,
    ...viewerActions,
    // UI event bridge
    hydrateRefImages,
    applyMermaidScaleDom,
    renderMermaidModalDom,
    cancelMermaidDrag: evCancelMermaidDrag,
    onMouseMoveMermaid: mermaidMouseMove,
    onMouseUpMermaid: mermaidMouseUp,
    // Internal helpers exposed as actions for eventHandlers
    save: savePreferences,
    resetClientPreferences,
    loadOlderMessages,
    loadSessionGraph,
    scrollToBottomSoon,
    activeRole,
    activeChat,
    activeGroup,
    activeWorkspace,
    getProvider,
    getRoleById,
    getGroupById,
    getWorkspaceById,
    ensureChatsBox,
    ensureGroupChatsBox: ensureGroupChatsBoxBare,
    ensureWorkspaceChatsBox: ensureWorkspaceChatsBoxBare,
    clearPendingChat,
    clearPendingGroupChat,
    clearPendingWorkspaceChat,
    openProvidersEditor,
    openNewRoleEditor,
    openNewGroupEditor,
    openNewWorkspaceEditorRaw: () => openNewWorkspaceEditor(),
    openRoleEditorRaw: (rid: string) => openRoleEditor(rid),
    openGroupEditorRaw: (gid: string) => openGroupEditor(gid),
    openWorkspaceEditorRaw: (wid: string) => openWorkspaceEditor(wid),
    createChatForActiveTargetRaw: () => createChatForActiveTarget(),
    pickChatForActiveTargetRaw: (cid: string) => pickChatForActiveTarget(cid),
    // 会话首屏提交后调用：把当前窗口内尚未缓存的消息批量交给后台预计算。
    prewarmRenderCache: (request: { sessionKey?: unknown; messages?: unknown }) => renderPrewarm.prewarm(request),
  }

  // ============================================================
  // 21. INIT
  // ============================================================
  async function init(options?: { businessAvailable?: boolean }) {
    disposed = false
    await ensureRenderer().catch(() => {})
    if (options?.businessAvailable === false) {
      // 未连接业务端：controller 只承载客户端外壳，不加载业务数据、不启动轮询与事件订阅。
      // 客户端偏好走 client-state/ 本地通道，离线外壳也能恢复外观 / 字体 / 布局等设置。
      // 必须经 splitStore 的读取入口建立基线：读取失败时只形成暂行视图，
      // 后续保存会被写入熔断闸门拦下。
      state.data = await loadClientPreferencesShell()
      state.draft.activeRoleId = String(state.data?.ui?.activeRoleId || '')
      state.draft.activeGroupId = String((state.data?.ui as any)?.activeGroupId || '')
      ;(state.draft as any).activeWorkspaceId = String((state.data?.ui as any)?.activeWorkspaceId || '')
      const targetKind = String((state.data?.ui as any)?.activeTargetKind || 'role').trim()
      state.draft.activeTargetKind = targetKind === 'group' ? 'group' : targetKind === 'workspace' ? 'workspace' : 'role'
      state.loading = false
      activateComposerDraftForCurrentSession(state)
      emitScope(refreshScopes.appData())
      return
    }
    await load()
    refreshModelGroups(false).catch(() => {})
    ebRunEvents.start()
    await restoreActiveEbRoleRuns()
    startUiPollers()
    emitScope(refreshScopes.appData())
  }

  function dispose() {
    disposed = true
    chatSettingsSaveQueue.abort()
    ebRunEvents.stop()
    runProbe.stop()
    stopUiPollers()
    disposeToolCatalog()
    disposeSystemPluginController()
    renderPrewarm.dispose()
    uiCore.dispose()
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
    getState: getControllerState,
    getSnapshot: () => getVer(),
    subscribe,
    getScopeVer,
    subscribeScope,
    emitScope,
    getMessageById,
    getComposerDraft,
    fmtTime,
    activeRole,
    activeChat,
    getProvider,
    renderAssistantInto,
    actions,
    dispose,
  }

  return { controller, init }
}
