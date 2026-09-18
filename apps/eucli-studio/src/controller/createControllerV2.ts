// eucli-studio V2 controller: DI assembled from extracted modules.
import { createDefaultAssistantRenderEngine } from '../render/assistantEngineDefault'
import type { AiChatCapabilities } from '../gateway/capabilities'
import type { AiChatController } from './types'

// ---- domain ----
import {
  DEFAULT_MERMAID_FIX_SYSTEM_PROMPT,
  DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT,
  DEFAULT_STICKER_NAMING_SYSTEM_PROMPT,
} from '../domain/constants'
import { removeDraftFile, removeDraftImage as removeDraftImageFromList } from '../domain/draftFileUtils'
import type { DraftFileKind } from '../domain/draftFileUtils'
import {
  activateComposerDraftForCurrentSession,
  setActiveComposerFiles,
  setActiveComposerImages,
  setActiveComposerInput,
} from '../domain/sessionComposerDrafts'
import { pendingChatForTarget } from '../domain/pendingChat'

// ---- storage ----
import { createStickerStorage } from '../storage/stickerStorage'
import { createSplitStorage } from '../storage/splitStorage'
import { createLazyChatStore } from '../storage/lazyChatStore'
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
import { createModelGroupsController } from './modelGroups'
import { createFavoritesOperations } from './favoritesOperations'
import { createEntityEditors } from './entityEditors'
import { createChatOperations } from './chatOperations'
import { createPersistence } from './persistence'
import { createWorkspaceManager } from './workspaceManager'
import { createAccessSettingsController } from './accessSettingsController'
import { updateGroupSessionTitle, updateRoleSessionTitle } from './ebRoleSession'
import { createEbRunEventConsumer } from './ebRunEvents'
import { createToolCatalog } from './toolCatalog'
import { createInstallSourceClient } from './installSourceClient'
import { createModelRequestConfigController } from './modelRequestConfig'
import { workspaceRoleTargetId } from '../domain/workspaceRoleTarget'
import { readActiveEbRunCardsForTarget } from '../domain/activeRunCards'
import { loadWorkspaceSession } from './workspaceBridge'
import { createChatSessionTarget, chatSettingsTargetKey, type ChatSettingsTarget } from './chatSessionTarget'
import { createChatSettingsSaveQueue, type ChatSettingsAction } from './chatSettingsSaveQueue'
import { createInitialControllerState } from './controllerState'
import { createFileTextExtraction } from './fileTextExtraction'
import { createHookPromptLibraryController } from './hookPromptLibraryController'
import { createPlaceholderLibraryController } from './placeholderLibraryController'
import { createSystemPluginController } from './systemPluginController'
import { createChatSessionSettingsBridge } from './chatSessionSettingsBridge'
import { createControllerBootstrap } from './controllerBootstrap'
import { createAppearanceActions } from './actions/appearanceActions'
import { createAiServiceActions } from './actions/aiServiceActions'
import { createStickerActions } from './actions/stickerActions'
import { createFavoriteActions } from './actions/favoriteActions'
import { createEntityActions } from './actions/entityActions'
import { createToolActions } from './actions/toolActions'
import { createModelActions } from './actions/modelActions'
import { createAccessActions } from './actions/accessActions'
import { createLibraryActions } from './actions/libraryActions'
import { createChatNavigationActions } from './actions/chatNavigationActions'
import { createChatInteractionActions } from './actions/chatInteractionActions'
import { createViewerActions } from './actions/viewerActions'
import { fmtTime, createModalHelpers } from './controllerHelpers'

export function createAiChatControllerV2(deps: { capabilities: AiChatCapabilities }): {
  controller: AiChatController
  init: () => Promise<void>
} {
  const capabilities = deps.capabilities
  const api = capabilities
  const runtimeStorage = capabilities.runtimeStorage
  const storage = capabilities.storage

  // ============================================================
  // 1. STATE
  const state = createInitialControllerState()
  let disposed = false

  // ============================================================
  // 2. UI CORE
  // ============================================================
  const uiCore = createUiCore()
  const { emit, subscribe, getVer } = uiCore

  // ============================================================
  // 3. SPLIT META CACHE (shared across modules)
  // ============================================================
  let splitMetaCache: any = null
  let splitMetaLoadPromise: Promise<any> | null = null

  // ============================================================
  // 4. ASSISTANT RENDERER
  // ============================================================
  const assistantRenderer = createDefaultAssistantRenderEngine(capabilities)
  const { ensureRenderer, renderAssistantInto: renderAssistantIntoRaw, sanitizeSvg } = assistantRenderer

  // ============================================================
  // 5. INLINE HELPERS

  function render() { emit() }
  function renderComposer() { emit() }

  function getControllerState() {
    activateComposerDraftForCurrentSession(state)
    return state
  }

  function scrollToBottomSoon() {
    // UI 负责滚动逻辑
  }

  function currentRenderSafetyPolicy() {
    const v = String((state.data?.settings as any)?.renderSafetyPolicy || '').trim()
    return v === 'unsafe' ? 'unsafe' : v === 'baseline' ? 'baseline' : 'original'
  }

  const { closeModal } = createModalHelpers({ state, render })

  const fileTextExtraction = createFileTextExtraction({
    getState: () => state,
    showToast: api.ui?.showToast,
  })
  const { extractTextFromFile } = fileTextExtraction

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
    const renderSafetyPolicy = currentRenderSafetyPolicy()
    renderAssistantIntoRaw(el, text, {
      ...(options || {}),
      stickersEnabled: enabled,
      getStickerPath: getStickerRelPath,
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
    loadStickersFromSource,
    setStickersEnabled,
    syncRoleAvatarFile,
    syncGroupAvatarFile,
  } = stickerStore

  const splitStore = createSplitStorage({
    storage,
    syncRoleAvatarFile,
    syncGroupAvatarFile,
    getState: () => state,
    setState: (data: any) => { state.data = data },
    onError: (msg: string) => { api.ui?.showToast?.(msg, { kind: 'error' }) },
  })
  const {
    loadSplitMeta,
    withSplitMetaWrite,
    ensureSplitStoreReady,
    setActiveRoleChatSelection,
    removeRoleChatEntry,
    saveRoleOrder,
    setActiveGroupChatSelection,
    removeGroupChatEntry,
    saveMetaOnly,
    saveFavoritesOnly,
    saveRoleEntity,
    removeRoleEntity,
    saveGroupEntity,
    removeGroupEntity,
    saveProviderEntity,
    removeProviderEntity,
  } = splitStore

  // Update splitMetaCache on loadSplitMeta (wrapper)
  const loadSplitMetaCached = async () => {
    if (splitMetaLoadPromise) return splitMetaLoadPromise
    splitMetaLoadPromise = loadSplitMeta()
      .then((meta) => {
        if (meta) splitMetaCache = meta
        return meta
      })
      .finally(() => {
        splitMetaLoadPromise = null
      })
    return splitMetaLoadPromise
  }

  function getSplitMetaCache(): any {
    return splitMetaCache
  }

  const lazyChatStore = createLazyChatStore({
    storage,
    getState: () => state,
    loadSplitMeta: loadSplitMetaCached,
    getSplitMetaCache,
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
    const chat = await loadStoredChat('role', roleId, sessionId)
    if (!chat) return null
    const loaded = upsertLoadedChat('role', roleId, chat)
    ebRunEvents.flushSession(roleId, sessionId)
    return loaded
  }

  async function reloadGroupSession(groupIdRaw: any, sessionIdRaw: any) {
    const groupId = String(groupIdRaw || '').trim()
    const sessionId = String(sessionIdRaw || '').trim()
    if (!groupId || !sessionId) return null
    const chat = await loadStoredChat('group', groupId, sessionId)
    if (!chat) return null
    const loaded = upsertLoadedChat('group', groupId, chat)
    ebRunEvents.flushSession('group', groupId, sessionId)
    return loaded
  }

  async function reloadWorkspaceSession(workspaceIdRaw: any, sessionIdRaw: any, roleIdRaw?: any) {
    const workspaceId = String(workspaceIdRaw || '').trim()
    const sessionId = String(sessionIdRaw || '').trim()
    const roleId = String(roleIdRaw || state.draft?.activeRoleId || state.data?.ui?.activeRoleId || '').trim()
    if (!workspaceId || !sessionId) return null
    const request = capabilities.net?.request
    if (typeof request !== 'function') return null
    const chat = await loadWorkspaceSession(request, workspaceId, roleId, sessionId)
    if (!chat) return null
    const loaded = upsertWorkspaceChat(workspaceId, chat)
    ebRunEvents.flushSession('workspace', workspaceId, sessionId)
    return loaded
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
    onStateChanged: () => emit(),
    onError: (message: string) => { api.ui?.showToast?.(message, { kind: 'error' }) },
  })

  // ============================================================
  // 8. GROUP CHAT SYNC
  // ============================================================
  const groupChatSync = createGroupChatSync({
    storage,
    getState: () => state,
    loadSplitMeta: loadSplitMetaCached,
    getSplitMetaCache,
    withSplitMetaWrite,
    hasActiveGroupRunInSession: (groupId: string, chatId: string) => readActiveEbRunCardsForTarget(state, 'group', groupId, chatId).length > 0,
  })
  const { syncActiveGroupChatsFromStorage } = groupChatSync

  const persistence = createPersistence({
    getState: () => state,
    activeChatFromData,
    saveMetaOnly,
  })
  const { saveMeta, saveCurrentChat } = persistence

  const workspaceManager = createWorkspaceManager({
    getState: () => state,
    netRequest: capabilities.net?.request || ((() => Promise.resolve({})) as any),
    emit,
    render,
    closeModal,
    saveMeta,
    scrollToBottomSoon,
    showToast: api.ui?.showToast,
    activeTargetKind,
    activeRole,
    activeWorkspace,
    activeChatFromData,
    clearPendingWorkspaceChat,
    removeLoadedChat: (kind: 'role' | 'group' | 'workspace', targetId: string, chatId: string) => {
      if (kind === 'workspace') {
        const box = (state.data as any)?.chatsByWorkspace?.[String(targetId || '')]
        if (!box || !Array.isArray(box.chats)) return
        box.chats = box.chats.filter((chat: any) => String(chat?.id || '') !== String(chatId || ''))
        return
      }
      removeLoadedChat(kind as any, targetId, chatId)
    },
  })
  const {
    refreshWorkspaces,
    ensureWorkspaceChatLoaded,
    ensureActiveWorkspaceChatLoaded,
    upsertWorkspaceChat,
    setActiveWorkspace,
    setWorkspaceRole,
    openNewWorkspaceEditor,
    openWorkspaceEditor,
    addWorkspaceDirectory,
    removeWorkspaceDirectory,
    setWorkspaceDirectoryField,
    refreshWorkspacePromptPreview,
    saveWorkspaceEditor,
    deleteWorkspaceEditor,
    createChatForActiveWorkspace,
    pickChatForActiveWorkspace,
    renameWorkspaceChatTitle,
    deleteChatForWorkspace,
  } = workspaceManager

  async function ensureChatLoaded(kind: 'role' | 'group' | 'workspace', targetId: string, chatId: string) {
    if (kind === 'workspace') return ensureWorkspaceChatLoaded(targetId, chatId)
    return ensureStoredChatLoaded(kind, targetId, chatId)
  }

  async function ensureActiveChatLoaded() {
    if (activeTargetKind() === 'workspace') return ensureActiveWorkspaceChatLoaded()
    return ensureStoredActiveChatLoaded()
  }

  // ============================================================
  // 8.1. SAVE & LOAD (bridge to splitStorage)
  // ============================================================
  const hookPromptLibraryController = createHookPromptLibraryController({
    getState: () => state,
    getNetRequest: () => capabilities.net?.request,
    emit,
    showToast: api.ui?.showToast,
  })
  const { refreshHookPromptLibrary, persistHookPromptLibrary } = hookPromptLibraryController

  const placeholderLibraryController = createPlaceholderLibraryController({
    getState: () => state,
    getNetRequest: () => capabilities.net?.request,
    emit,
    showToast: api.ui?.showToast,
  })
  const { refreshPlaceholderLibrary, persistPlaceholderLibrary, refreshPlaceholderPreview, refreshPlaceholderDependencyTree } = placeholderLibraryController

  const systemPluginController = createSystemPluginController({
    getState: () => state,
    getNetRequest: () => capabilities.net?.request,
    emit,
    showToast: api.ui?.showToast,
    refreshPlaceholderLibrary,
  })
  const {
    refreshSystemPlugins,
    openSystemPlugin,
    saveSystemPluginConfig,
    refreshAvailableSystemPluginPlaceholderInterfaces,
    loadSystemPluginInstallState,
    installSystemPluginAction,
    updateSystemPluginAction,
    createPlaceholderFromSystemPlugin,
  } = systemPluginController

  const chatSessionSettingsBridge = createChatSessionSettingsBridge({
    getState: () => state,
    getNetRequest: () => capabilities.net?.request,
    emit,
    showToast: api.ui?.showToast,
    runChatSettingsSave,
    captureChatSettingsTarget,
    currentChatForSettingsTarget,
    isActiveChatSettingsTarget,
    upsertWorkspaceChat,
    upsertLoadedChat,
  })
  const { applyChatSettingsAction, selectHookPromptForActiveChat } = chatSessionSettingsBridge

  const controllerBootstrap = createControllerBootstrap({
    state,
    render,
    showToast: api.ui?.showToast,
    getNetRequest: () => capabilities.net?.request,
    isDisposed: () => disposed,
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

  async function save() {
    await saveCurrentChat()
  }

  async function runChatSettingsSave(target: ChatSettingsTarget, action: ChatSettingsAction, value: unknown, work: (isCurrent: () => boolean) => Promise<void>, failText: string): Promise<'saved' | false> {
    return chatSettingsSaveQueue.runSave(target, action, value, work, failText)
  }

  async function waitForChatSettingsSave() {
    await chatSettingsSaveQueue.waitCurrentTargetSave()
  }

  // ============================================================
  // 10. IMAGE UTILS
  // ============================================================
  const imageUtils = createImageUtils({
    filesImagesRead: (api.files?.images?.read as any) || ((() => Promise.resolve('')) as any),
    uiRefImgCache,
    uiRefImgPending,
  })
  const { readFileAsDataUrl, hydrateRefImages } = imageUtils
  const pickImageFiles = api.files?.pickImages as ((maxCount?: number) => Promise<any[]>) | undefined

  // ============================================================
  // 11. MODEL REFRESH
  // ============================================================
  const modelRefresh = createModelRefresh({
    getState: () => state,
    getProvider,
    netRequest: capabilities.net?.request || ((() => Promise.resolve({})) as any),
    emit,
    showToast: api.ui?.showToast,
  })
  const { refreshModels } = modelRefresh

  const modelGroupsController = createModelGroupsController({
    getState: () => state,
    netRequest: capabilities.net?.request || ((() => Promise.resolve({})) as any),
    emit,
    showToast: api.ui?.showToast,
  })
  const {
    refreshModelGroups,
    saveModelGroups,
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
    emit,
    showToast: api.ui?.showToast,
  })
  const { refreshTools, openToolConfig, closeToolConfig, setToolConfigValue, removeToolConfigValue, setToolPromptDescriptionDraft, resetToolPromptDescriptionDraftToDefault, saveSelectedToolConfig, loadToolInstallState, installTool, updateTool } = toolCatalog

  const installSourceClient = createInstallSourceClient({
    netRequest: capabilities.net?.request || ((() => Promise.resolve({})) as any),
  })
  const { get: getInstallSource, set: setInstallSource } = installSourceClient

  const modelRequestConfigController = createModelRequestConfigController({
    getState: () => state,
    netRequest: capabilities.net?.request || ((() => Promise.resolve({})) as any),
    emit,
    showToast: api.ui?.showToast,
  })
  const { refreshModelRequestConfig, setModelRequestConfigDraft, resetModelRequestConfigDraftToDefaults, saveModelRequestConfig } = modelRequestConfigController

  const accessSettingsController = createAccessSettingsController({
    getState: () => state,
    netRequest: capabilities.net?.request || ((() => Promise.resolve({})) as any),
    emit,
    showToast: api.ui?.showToast,
  })

  // ============================================================
  // 12. FAVORITES OPERATIONS
  // ============================================================
  const favOps = createFavoritesOperations({
    getState: () => state,
    save: saveFavoritesOnly,
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
    emit,
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
    save: saveMeta,
    render,
    closeModal,
    showToast: api.ui?.showToast,
    pickImageFiles,
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
  const chatOps = createChatOperations({
    getState: () => state,
    pickImageFiles,
    netRequest: capabilities.net?.request || ((() => Promise.resolve({})) as any),
    showToast: api.ui?.showToast,
    save,
    ensureActiveChatLoaded,
    ensureChatLoaded: (kind: 'role' | 'group' | 'workspace', targetId: string, chatId: string) => ensureChatLoaded(kind as any, targetId, chatId),
    reloadRoleSession,
    reloadGroupSession,
    reloadWorkspaceSession,
    waitForChatSettingsSave,
    emit,
    render,
    renderComposer,
    scrollToBottomSoon,
    readImageFileAsDataUrl: readFileAsDataUrl,
    extractTextFromFile: (file: File, kind: string) => extractTextFromFile(file, kind as DraftFileKind),
  })
  const {
    pickDraftImages,
    addDraftImagesFromFiles,
    addDraftFilesFromFiles,
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
  } = chatOps

  // ============================================================
  // 17. UI POLLING
  // ============================================================
  const ebRunEvents = createEbRunEventConsumer({
    getState: () => state,
    emit,
    subscribeDirectEvents: (capabilities.host as any)?.directEvents?.subscribe,
    // 视窗架构：运行事件只刷新画面，不把 UI 快照整包写回业务端。
    // 会话事实由业务端运行时持久化，终态由运行完成后的会话重读对账。
  })

  const uiPolling = createUiPolling({
    getState: () => state,
    storage,
    rtStorage: runtimeStorage,
    loadSplitMeta: loadSplitMetaCached,
    getSplitMetaCache,
    emit,
    subscribeDirectEvents: (capabilities.host as any)?.directEvents?.subscribe,
    activeTargetKind,
    activeChatFromData,
    ensureActiveChatLoaded,
    syncActiveGroupChatsFromStorage,
  })
  const { startUiPollers, stopUiPollers } = uiPolling

  // ============================================================
  // 19. EVENT HANDLERS
  // ============================================================
  // Build placeholder actions object for eventHandlers (circular dep)
  const actionsPlaceholder: Record<string, any> = {
    emit,
    save: () => saveMeta(),
    render,
    renderTop: render,
    renderComposer,
    renderChat: render,
    renderModal: render,
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
    setDraft: (key: any, value: any) => {
      const k = String(key || '')
      if (k === 'input') {
        setActiveComposerInput(state, value)
        return
      }
      if ((k === 'workspaceName' || k === 'workspacePrompt') && state.modal === 'workspace') {
        ;(state.draft as any).workspaceActualPromptStale = true
        ;(state.draft as any).workspaceActualPromptError = ''
      }
      if (k) (state.draft as any)[k] = value
      emit()
    },
    // These will be filled by the full actions object
    openProvidersEditor: () => openProvidersEditor(),
    createRole: () => createRole(),
    createChatForActiveTarget: () => createChatForActiveTarget(),
    openRoleEditor: (id: string) => openRoleEditor(id),
    pickChatForActiveTarget: (id: string) => pickChatForActiveTarget(id),
    removeDraftImage: (id: string) => {
      const draft = activateComposerDraftForCurrentSession(state)
      setActiveComposerImages(state, removeDraftImageFromList(draft.images, String(id || '')))
      emit()
    },
    removeDraftFile: (id: string) => {
      const draft = activateComposerDraftForCurrentSession(state)
      setActiveComposerFiles(state, removeDraftFile(draft.files, String(id || '')))
      emit()
    },
    sendChat: () => sendChat(),
    pickDraftImages: () => pickDraftImages(),
    addDraftImagesFromFiles: (files: any) => addDraftImagesFromFiles(Array.isArray(files) ? files : []),
    addDraftFilesFromFiles: (files: any) => addDraftFilesFromFiles(Array.isArray(files) ? files : []),
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
    emit,
    render,
    showToast: api.ui?.showToast,
    clipboard: api.clipboard,
  })
  const { cancelMermaidDrag: evCancelMermaidDrag } = eventHandlers

  // ============================================================
  // 20. ACTIONS — complete controller.actions object
  // ============================================================
  const appearanceActions = createAppearanceActions({ state, emit, saveMeta, showToast: api.ui?.showToast, currentRenderSafetyPolicy })
  const aiServiceActionSet = createAiServiceActions({ state, emit, saveMeta, showToast: api.ui?.showToast })
  const stickerActions = createStickerActions({ state, emit, showToast: api.ui?.showToast, pickImageFiles, addStickerInternal, createStickerCategoryInternal, deleteStickerCategoryInternal, deleteStickerInternal, renameStickerInternal, loadStickersFromSource, setStickersEnabled })
  const favoriteActions = createFavoriteActions({ favOps })
  const entityActions = createEntityActions({
    state,
    emit,
    saveMeta,
    showToast: api.ui?.showToast,
    getProvider,
    closeModal,
    saveRoleOrder,
    openProvidersEditor,
    openProviderInlineEditor,
    saveProviderInlineEditor,
    createProvider,
    deleteProvider,
    openRoleEditor,
    createRole,
    saveRoleEditor,
    deleteRole,
    openGroupEditor,
    createGroup,
    saveGroupEditor,
    deleteGroup,
    openWorkspaceEditor,
    openNewWorkspaceEditor,
    saveWorkspaceEditor,
    deleteWorkspaceEditor,
    addWorkspaceDirectory,
    removeWorkspaceDirectory,
    setWorkspaceDirectoryField,
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
    emit,
    showToast: api.ui?.showToast,
    refreshTools,
    openToolConfig,
    closeToolConfig,
    setToolConfigValue,
    removeToolConfigValue,
    setToolPromptDescriptionDraft,
    resetToolPromptDescriptionDraftToDefault,
    saveSelectedToolConfig,
    loadToolInstallState,
    installTool,
    updateTool,
    getInstallSource,
    setInstallSource,
  })
  const modelActions = createModelActions({
    refreshModelRequestConfig,
    setModelRequestConfigDraft,
    resetModelRequestConfigDraftToDefaults,
    saveModelRequestConfig,
    refreshModelGroups,
    saveModelGroups,
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
  const libraryActions = createLibraryActions({
    refreshHookPromptLibrary,
    persistHookPromptLibrary,
    refreshPlaceholderLibrary,
    persistPlaceholderLibrary,
    refreshPlaceholderPreview,
    refreshPlaceholderDependencyTree,
    refreshSystemPlugins,
    openSystemPlugin,
    saveSystemPluginConfig,
    refreshAvailableSystemPluginPlaceholderInterfaces,
    createPlaceholderFromSystemPlugin,
    loadSystemPluginInstallState,
    installSystemPluginAction,
    updateSystemPluginAction,
    selectHookPromptForActiveChat,
  })
  const chatNavigationActions = createChatNavigationActions({
    state,
    emit,
    saveMeta,
    ensureActiveChatLoaded,
    ensureChatsBoxBare,
    ensureGroupChatsBoxBare,
    setActiveWorkspace,
    setWorkspaceRole,
    createChatForActiveTarget,
    pickChatForActiveTarget,
    pickDraftImages,
    addDraftImagesFromFiles,
    addDraftFilesFromFiles,
  })
  const chatInteractionActions = createChatInteractionActions({
    state,
    emit,
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
    emit,
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
    ...chatNavigationActions,
    ...aiServiceActionSet,
    ...stickerActions,
    ...favoriteActions,
    ...entityActions,
    ...toolActions,
    ...modelActions,
    ...accessActions,
    ...libraryActions,
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
  }

  // ============================================================
  // 21. INIT
  // ============================================================
  async function init() {
    disposed = false
    await ensureRenderer().catch(() => {})
    await load()
    refreshModelGroups(false).catch(() => {})
    ebRunEvents.start()
    await restoreActiveEbRoleRuns()
    startUiPollers()
    render()
  }

  function dispose() {
    disposed = true
    chatSettingsSaveQueue.abort()
    ebRunEvents.stop()
    stopUiPollers()
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
