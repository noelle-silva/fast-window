import * as React from 'react'
import { Box, CircularProgress, CssBaseline, GlobalStyles, ThemeProvider, Typography } from '@mui/material'
import { useAiChatState } from './hooks/useAiChatState'
import { useDeferredChatSwitch } from './hooks/useDeferredChatSwitch'
import { useEvent } from './hooks/useEvent'
import { useFavoriteFolders } from './hooks/useFavoriteFolders'
import { useMessageActions } from './hooks/useMessageActions'
import { useChatTree } from './hooks/useChatTree'
import { useChatSending, type SendPathAnchor, emptySendPathAnchor } from './hooks/useChatSending'
import { useComposerAttachments } from './hooks/useComposerAttachments'
import { useComposerTools } from './hooks/useComposerTools'
import { useChatSessionPickers } from './hooks/useChatSessionPickers'
import { useSessionRunObservations } from './hooks/useSessionRunObservations'
import { useChatMessageIndex } from './hooks/useChatMessageIndex'
import { useChatMessageView } from './hooks/useChatMessageView'
import { clampNum } from './utils/numbers'
import { TOPBAR_H } from './appConstants'
import { createChatGlobalStyles } from './globalStyles'
import { ProvidersDialog } from './dialogs/ProvidersDialog'
import { RoleDialog } from './dialogs/RoleDialog'
import { GroupDialog } from './dialogs/GroupDialog'
import { WorkspaceDialog } from './dialogs/WorkspaceDialog'
import { ConfirmDialog } from './dialogs/ConfirmDialog'
import { MermaidDialog } from './dialogs/MermaidDialog'
import { ImageDialog } from './dialogs/ImageDialog'
import { FavoriteFoldersDialogs } from './dialogs/FavoriteFoldersDialogs'
import { ChatSessionDialogs } from './dialogs/ChatSessionDialogs'
import { ChatContextMenus } from './dialogs/ChatContextMenus'
import { MessageMenusDialogs } from './dialogs/MessageMenusDialogs'
import { RolePickerPopover } from './dialogs/RolePickerPopover'
import { ChatPickerPopover } from './dialogs/ChatPickerPopover'
import { StandaloneWindowControls, type WindowControlActions } from './components/StandaloneWindowControls'
import { HookPromptSelector } from './components/HookPromptSelector'
import { ChatTopBar } from './components/ChatTopBar'
import { ChatMessageList } from './components/ChatMessageList'
import { CustomScrollArea } from './components/CustomScrollArea'
import type { SettingsTabValue } from './settings/SettingsPageLayout'
import type { AiChatDataDirectory } from './settings/DataSettingsPanel'
import { PluginSettingsPage } from './settings/PluginSettingsPage'
import { formatModelRefDisplayText } from '../domain/modelRefUtils'
import { pendingChatForTarget } from '../domain/pendingChat'
import { chatNavigationFromOrderedChats } from '../domain/chatNavigation'
import { sortChatListItemsForDisplay } from '../domain/chatListOrdering'
import { workspaceRoleTargetId } from '../domain/workspaceRoleTarget'
import { chatSettingsTargetKey } from '../controller/chatSessionTarget'
import { chatReasoningEffort, effectiveReasoningEffort, modelReasoningProfileFromModelRef, reasoningEffortLabel } from '../domain/reasoning'
import { chatStreamEnabled } from '../domain/chatStream'
import type { HookPromptLibrary } from '../domain/hookPrompt'
import type { PlaceholderLibrary } from '../domain/placeholder'
import type { ReleaseCandidatesView, StudioBootstrap } from '../domain/release'
import { resolveColorThemePreset } from '../domain/colorTheme'
import { createStudioMuiTheme } from './colorThemeStyles'
import { ChatComposer } from './composer/ChatComposer'
import { ComposerControlsPopovers } from './composer/ComposerControlsPopovers'
import { ComposerAttachmentsPopovers } from './composer/ComposerAttachmentsPopovers'
import { ChatTreeModal } from './chatTree/ChatTreeModal'

type SettingsTab = SettingsTabValue

export type AiChatWindowControls = {
  standalone: boolean
  actions: WindowControlActions
}

function isNearBottom(el: HTMLElement, thresholdPx = 24) {
  const gap = el.scrollHeight - el.scrollTop - el.clientHeight
  return Math.ceil(gap) <= thresholdPx
}

export function AiChatApp(props: { controller: any; bootstrap?: StudioBootstrap; dataDirectory?: AiChatDataDirectory; windowControls?: AiChatWindowControls; releaseBusy: boolean; releaseView: ReleaseCandidatesView | null; onReleaseRead: (kind?: string) => Promise<void> | void; onReleaseRefresh: (kind?: string) => Promise<void> | void }) {
  const { controller, bootstrap, dataDirectory, windowControls, releaseBusy, releaseView, onReleaseRead, onReleaseRefresh } = props
  const s = useAiChatState(controller)
  const data = s.data
  const colorThemePreset = resolveColorThemePreset(data?.settings?.colorTheme)
  const theme = React.useMemo(() => createStudioMuiTheme(colorThemePreset), [colorThemePreset])
  const roles = Array.isArray(data?.roles) ? data.roles : []
  const groups = Array.isArray((data as any)?.groups) ? ((data as any).groups as any[]) : []
  const workspaces = Array.isArray((data as any)?.workspaces) ? ((data as any).workspaces as any[]) : []
  const providers = Array.isArray(data?.settings?.providers) ? data.settings.providers : []
  const modelGroups = Array.isArray((s as any)?.modelGroups?.items) ? (s as any).modelGroups.items : []
  const hookPrompts = (s as any)?.hookPrompts && typeof (s as any).hookPrompts === 'object' ? (s as any).hookPrompts : { loading: false, error: '', library: { presets: [] } as HookPromptLibrary }
  const placeholders = (s as any)?.placeholders && typeof (s as any).placeholders === 'object' ? (s as any).placeholders : { loading: false, error: '', library: { placeholders: [], folders: [] } as PlaceholderLibrary, preview: { text: '', problems: [] }, problems: [], dependencyTree: { name: '' } }
  const systemPlugins = (s as any)?.systemPlugins && typeof (s as any).systemPlugins === 'object' ? (s as any).systemPlugins : { loading: false, error: '', items: [], selectedPluginId: '', selectedPlugin: null, availableInterfaces: [] }
  const transparentChatBg = !!data?.settings?.transparentChatBg
  const chatBgOpacity = clampNum(Number(data?.settings?.chatBgOpacity ?? 0), 0, 100)
  const chatBgBlur = clampNum(Number(data?.settings?.chatBgBlur ?? 0), 0, 24)
  const topbarOpacity = clampNum(Number(data?.settings?.topbarOpacity ?? 100), 0, 100)
  const topbarBlur = clampNum(Number(data?.settings?.topbarBlur ?? 0), 0, 24)
  const composerOpacity = clampNum(Number(data?.settings?.composerOpacity ?? 86), 40, 100)
  const composerBlur = clampNum(Number(data?.settings?.composerBlur ?? 10), 0, 24)
  const renderSafetyPolicy = (() => {
    const v = String((data?.settings as any)?.renderSafetyPolicy || 'original').trim()
    return v === 'unsafe' ? 'unsafe' : v === 'baseline' ? 'baseline' : 'original'
  })()
  const userMessageCollapseEnabled = !!data?.settings?.userMessageCollapseEnabled
  const userMessageCollapseLines = clampNum(Number(data?.settings?.userMessageCollapseLines ?? 8), 1, 50)
  const attachSendLimitChars = clampNum(Number(data?.settings?.attachments?.sendLimitChars ?? 80000), 1000, 2000000)
  const attachMaxFileSizeMbByKind0 = (data?.settings?.attachments as any)?.maxFileSizeMbByKind
  const attachMaxFileSizeMbByKind = attachMaxFileSizeMbByKind0 && typeof attachMaxFileSizeMbByKind0 === 'object' ? attachMaxFileSizeMbByKind0 : {}
  const attachMaxFileSizeMbTxt = clampNum(Number((attachMaxFileSizeMbByKind as any)?.txt ?? 10), 0, 2048)
  const attachMaxFileSizeMbMd = clampNum(Number((attachMaxFileSizeMbByKind as any)?.md ?? 10), 0, 2048)
  const attachMaxFileSizeMbPdf = clampNum(Number((attachMaxFileSizeMbByKind as any)?.pdf ?? 10), 0, 2048)
  const attachMaxFileSizeMbDocx = clampNum(Number((attachMaxFileSizeMbByKind as any)?.docx ?? 10), 0, 2048)
  const attachMaxFileSizeMbPpt = clampNum(Number((attachMaxFileSizeMbByKind as any)?.ppt ?? 10), 0, 2048)
  const stickersEnabled = !!data?.settings?.stickers?.enabled
  const stickerMap = data?.settings?.stickers?.map
  const stickerCategories = Array.isArray(data?.settings?.stickers?.categories) ? data.settings.stickers.categories : []
  const bgAlpha = transparentChatBg ? Math.max(chatBgOpacity / 100, chatBgBlur > 0 ? 0.01 : 0) : 1

  const activeTargetKind0 = String((s.draft as any)?.activeTargetKind || (data?.ui as any)?.activeTargetKind || 'role').trim()
  const activeTargetKind = activeTargetKind0 === 'group' ? 'group' : activeTargetKind0 === 'workspace' ? 'workspace' : 'role'
  const activeGroupId = String((s.draft as any)?.activeGroupId || (data?.ui as any)?.activeGroupId || '')
  const activeWorkspaceId = String((s.draft as any)?.activeWorkspaceId || (data?.ui as any)?.activeWorkspaceId || '')
  const activeRole = controller.activeRole()
  const activeGroup = activeTargetKind === 'group' ? (groups.find((g: any) => String(g?.id || '') === activeGroupId) || null) : null
  const activeWorkspace = activeTargetKind === 'workspace' ? (workspaces.find((workspace: any) => String(workspace?.id || '') === activeWorkspaceId) || null) : null
  const activeWorkspaceChatTargetId = workspaceRoleTargetId(activeWorkspaceId, (activeRole as any)?.id)
  const activeChatTargetId = activeTargetKind === 'group' ? activeGroupId : activeTargetKind === 'workspace' ? activeWorkspaceChatTargetId : String(activeRole?.id || '')
  const activeChatSelectionBox = activeChatTargetId
    ? activeTargetKind === 'group'
      ? (data as any)?.chatsByGroup?.[activeChatTargetId]
      : activeTargetKind === 'workspace'
        ? (data as any)?.chatsByWorkspace?.[activeChatTargetId]
        : data?.chatsByRole?.[activeChatTargetId]
    : null
  const activeChat = controller.activeChat()
  const selectedActiveChatId = String(activeChat?.id || activeChatSelectionBox?.activeChatId || '').trim()
  const selectedActiveChatKey = selectedActiveChatId ? `${activeTargetKind}:${activeChatTargetId}:${selectedActiveChatId}` : ''
  const chatSwitch = useDeferredChatSwitch(controller, activeChat, selectedActiveChatId, selectedActiveChatKey)
  const renderChat = chatSwitch.renderChat
  const renderChatId = chatSwitch.renderChatId
  const activeChatId = chatSwitch.activeChatId
  const chatSettingsSavingByTarget = (s as any)?.chatSettings?.savingByTarget
  const activeChatSettingsTargetKey = activeChatTargetId && activeChatId
    ? chatSettingsTargetKey({ kind: activeTargetKind, targetId: activeChatTargetId, sessionId: activeChatId })
    : ''
  const chatSettingsSavingStatuses = chatSettingsSavingByTarget && typeof chatSettingsSavingByTarget === 'object'
    ? Object.values(chatSettingsSavingByTarget).filter((item: any) => (
        chatSettingsTargetKey({ kind: String(item?.kind || '') as any, targetId: String(item?.targetId || ''), sessionId: String(item?.sessionId || '') }) === activeChatSettingsTargetKey
      )) as any[]
    : []
  const chatSettingsSavingFor = (action: string) => chatSettingsSavingStatuses.find((item: any) => String(item?.action || '') === action) || null
  const chatSettingsModelSaving = !!chatSettingsSavingFor('model')
  const chatSettingsReasoningSaving = !!chatSettingsSavingFor('reasoning')
  const chatSettingsStreamSaving = !!chatSettingsSavingFor('stream')
  const chatSettingsHookSaving = !!chatSettingsSavingFor('hook')
  const openingChatMeta = (() => {
    if (activeChat || !data) return null
    const targetId = String(activeChatTargetId || '').trim()
    if (!targetId) return null
    const box = activeChatSelectionBox
    const openingChatId = String(activeChatId || box?.activeChatId || '').trim()
    if (!openingChatId) return null
    const metas = Array.isArray(box?.chatMetas) ? box.chatMetas : []
    return metas.find((m: any) => String(m?.id || '') === openingChatId) || null
  })()
  const branchDraftRaw: any = (s as any)?.branchDraft
  const branchDraft =
    activeTargetKind === 'role' &&
    branchDraftRaw &&
    typeof branchDraftRaw === 'object' &&
    String(branchDraftRaw?.roleId || '') === String(activeRole?.id || '') &&
    String(branchDraftRaw?.chatId || '') === String(activeChat?.id || '')
      ? branchDraftRaw
      : null
  const branchDraftKey = branchDraft ? `${String(branchDraft?.chatId || '')}:${String(branchDraft?.forkFromMid || '')}:${String(branchDraft?.createdAt || '')}` : ''
  const [sendPathAnchor, setSendPathAnchor] = React.useState<SendPathAnchor>(() => emptySendPathAnchor())
  const clearSendPathAnchor = useEvent(() => setSendPathAnchor(emptySendPathAnchor()))
  const sendPathAnchorNonceRef = React.useRef(0)
  const treeSuppressClickRef = React.useRef(false)

  const {
    clearChatSessionRunNotice,
    chatSessionRunIndicatorKind,
    isSendingThisChat,
  } = useSessionRunObservations({
    data,
    s,
    activeTargetKind,
    activeChatTargetId,
    activeChatId,
  })

  const formatModelRefText = React.useCallback(
    (modelRef: any) => {
      return formatModelRefDisplayText(modelRef, providers, modelGroups)
    },
    [providers, modelGroups],
  )

  const {
    favoriteFolders,
    collectFavoriteFolderSubtreeIds,
    favoriteSearchOpen,
    setFavoriteSearchOpen,
    favoriteSearchText,
    setFavoriteSearchText,
    favoriteSearchInputRef,
    favoriteDialog,
    setFavoriteDialog,
    createFavoriteFolder,
    setCreateFavoriteFolder,
    favoriteFolderMenu,
    renameFavoriteFolder,
    setRenameFavoriteFolder,
    confirmDeleteFavoriteFolder,
    moveFavoriteFolderContents,
    setMoveFavoriteFolderContents,
    moveFavoriteFolderDialog,
    setMoveFavoriteFolderDialog,
    confirmClearFavoriteFolder,
    setConfirmClearFavoriteFolder,
    favoriteChatMenu,
    setFavoriteChatMenu,
    openCreateFavoriteFolder,
    closeCreateFavoriteFolder,
    closeFavoriteFolderMenu,
    openRenameFavoriteFolder,
    closeRenameFavoriteFolder,
    submitRenameFavoriteFolder,
    openDeleteFavoriteFolderConfirm,
    closeDeleteFavoriteFolderConfirm,
    closeMoveFavoriteFolderContents,
    closeMoveFavoriteFolderDialog,
    closeConfirmClearFavoriteFolder,
    submitDeleteFavoriteFolder,
    submitMoveFavoriteFolderContents,
    submitClearFavoriteFolder,
    submitMoveFavoriteFolder,
    collapseAllFavoriteFolders,
    openFavoriteDialog,
    closeFavoriteDialog,
    saveFavoriteDialog,
    submitCreateFavoriteFolder,
    closeFavoriteChatMenu,
    renderFavoriteFolderPicker,
    renderFavoriteFolderSinglePicker,
    renderFavoriteFolderTree,
  } = useFavoriteFolders({
    controller,
    data,
    roles,
    groups,
    workspaces,
    clearChatSessionRunNotice,
    requestSwitch: chatSwitch.requestSwitch,
    closeChatPicker: () => closeChatPicker(),
    chatSessionRunIndicatorKind,
    activeTargetKind,
    activeChatTargetId,
    activeChatId,
  })

  const chatRootRef = React.useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = React.useRef(true)
  const autoScrollBlockUntilRef = React.useRef(0)
  const composerRef = React.useRef<HTMLDivElement | null>(null)
  const [composerHeight, setComposerHeight] = React.useState(0)
  const chatPaneRef = React.useRef<HTMLDivElement | null>(null)
  const [page, setPage] = React.useState<'chat' | 'settings'>('chat')
  const [settingsTab, setSettingsTab] = React.useState<SettingsTab>('roles')
  const [branchNav, setBranchNav] = React.useState<{ mid: string; at: number }>({ mid: '', at: 0 })

  const {
    rolePickerEl,
    rolePickerTab,
    setRolePickerTab,
    rolePickerMode,
    chatPickerEl,
    chatPickerView,
    setChatPickerView,
    chatPickerSearchOpen,
    setChatPickerSearchOpen,
    chatPickerSearchText,
    setChatPickerSearchText,
    chatPickerSearchInputRef,
    chatHistoryScrollRef,
    onChatHistoryScrollPositionChange,
    chatHistoryVisibleCount,
    chatMenu,
    closeChatMenu,
    onChatContextMenu,
    confirmDelChat,
    setConfirmDelChat,
    editingChatTitle,
    setEditingChatTitle,
    closeEditingChatTitle,
    saveEditingChatTitle,
    openRolePicker,
    openWorkspaceRolePicker,
    closeRolePicker,
    openChatPicker,
    closeChatPicker,
    openPluginSettings,
    closePluginSettings,
  } = useChatSessionPickers({
    controller,
    data,
    loading: !!s.loading,
    page,
    setPage,
    setSettingsTab,
    activeTargetKind,
    activeGroup,
    activeWorkspace,
    activeRole,
    activeChatTargetId,
    setFavoriteChatMenu,
    closeFavoriteChatMenu,
    closeFavoriteFolderMenu,
    closeFavoriteDialog,
    closeCreateFavoriteFolder,
    closeRenameFavoriteFolder,
    closeDeleteFavoriteFolderConfirm,
    closeMoveFavoriteFolderContents,
    closeMoveFavoriteFolderDialog,
    closeConfirmClearFavoriteFolder,
    setFavoriteSearchOpen,
    setFavoriteSearchText,
  })
  const composerInputRef = React.useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)
  const draftFilePickerInputRef = React.useRef<HTMLInputElement | null>(null)
  const roleSessionControlsEnabled = activeTargetKind !== 'group' && !!activeRole

  const {
    attachmentPickerEl,
    closeAttachmentPicker,
    openAttachmentPicker,
    onPickDraftImages,
    onPickDraftFiles,
    onPickFilesChanged,
    attachView,
    closeAttachView,
    openAttachView,
    fileAdjust,
    closeFileAdjust,
    openFileAdjust,
    onPaste,
  } = useComposerAttachments({
    controller,
    loading: !!s.loading,
    draftFilePickerInputRef,
  })

  const onTopbarPointerDown = useEvent((e: React.PointerEvent) => {
    if (e.button !== 0) return
    const t = e.target as any
    if (!t || typeof t.closest !== 'function') return
    if (t.closest('button, a, input, textarea, select, [role="button"], [data-window-controls="true"]')) return
    controller?.capabilities?.ui?.startDragging?.()
  })

  const standaloneWindowControls = windowControls?.standalone ? <StandaloneWindowControls actions={windowControls.actions} /> : null

  const onClickOpenImageViewer = useEvent((e: React.MouseEvent) => {
    const t = e.target as any
    if (!(t instanceof Element)) return
    const img = t.closest?.('img[data-fw-img="1"]')
    if (!img) return
    if (!(img instanceof HTMLImageElement)) return
    const src = String(img.getAttribute('src') || '').trim()
    if (!src) return
    e.preventDefault()
    e.stopPropagation()
    controller.actions.openImageViewer(e.currentTarget as any, img)
  })

  const {
    chatAllMessagesRaw,
    chatAllById,
    chatAllIndexById,
    prevAiMidByAssistantId,
    activeSessionRunCards,
    activeSessionRunCardsKey,
    activeChatRunCards,
    activeBranchIdUi,
    activeSendPathAnchorMid,
    activeSendPathRunId,
    activeSendPathRunCard,
    activeSendPathFollowMid,
    activeBranchHeadMid,
  } = useChatMessageIndex({
    s,
    renderChat,
    renderChatId,
    activeChatId,
    activeChat,
    activeTargetKind,
    activeChatTargetId,
    sendPathAnchor,
  })

  const getLastMsgId = useEvent(() => String(lastMsgId || ''))

  const {
    treeOpen,
    setTreeOpen,
    treePan,
    setTreePan,
    treeScale,
    setTreeScale,
    treeDir,
    setTreeDir,
    treeSelectedMid,
    setTreeSelectedMid,
    treePop,
    setTreePop,
    treeDragging,
    treeViewportRef,
    treeViewRef,
    treeHostRightRef,
    treeHostFloatRef,
    effectiveTreeView,
    treePanelW,
    treeResizing,
    applyTreeViewTransform,
    scheduleTreeViewTransform,
    onTreeSplitterPointerDown,
    onTreeSplitterPointerMove,
    endTreeResize,
    onTreePointerDown,
    onTreePointerMove,
    endTreeDrag,
    onTreeWheel,
    cycleTreeDir,
    treeRender,
    treeFocusMid,
    jumpToMessage,
    closeTreeModal,
  } = useChatTree({
    controller,
    data,
    activeChat,
    renderChat,
    renderChatId,
    page,
    composerInputRef,
    chatPaneRef,
    chatAllById,
    chatAllMessagesRaw,
    activeSessionRunCards,
    activeSessionRunCardsKey,
    activeSendPathFollowMid,
    activeSendPathAnchorMid,
    activeBranchHeadMid,
    branchDraft,
    branchDraftKey,
    clearSendPathAnchor,
    stickToBottomRef,
    autoScrollBlockUntilRef,
    setBranchNav,
    treeSuppressClickRef,
    getLastMsgId,
  })
  const {
    allMessages,
    activeVisibleRunCards,
    activeStopRunId,
    assistantSiblingsByPrevAiMid,
    groupedAttMsgsByRootMid,
    displayRenderMessages,
    lastMsgText,
    activeContextTokenUsageText,
    activeContextTokenUsageShortText,
    activeAsyncToolTasks,
    activeAsyncToolTaskRunningCount,
    lastMsgId,
  } = useChatMessageView({
    renderChat,
    renderChatId,
    chatAllMessagesRaw,
    prevAiMidByAssistantId,
    activeBranchIdUi,
    activeSendPathAnchorMid,
    activeSendPathFollowMid,
    activeSessionRunCards,
    activeSessionRunCardsKey,
    activeChatRunCards,
    activeChat,
    activeTargetKind,
    treeSelectedMid,
    branchDraft,
    branchDraftKey,
  })
  const treeHighlightEdgeKeys = React.useMemo(() => {
    const tr: any = treeRender
    const target = String(lastMsgId || '').trim()
    if (!tr || !target) return new Set<string>()
    const byId = tr?.byId
    if (!byId || typeof byId.get !== 'function') return new Set<string>()

    const out = new Set<string>()
    const seen = new Set<string>()
    let cur = target
    let guard = 0
    while (cur && !seen.has(cur) && guard < 6000) {
      guard++
      seen.add(cur)
      const n = byId.get(cur) || null
      if (!n) break
      const p = String(n?.parentId || '').trim()
      if (!p) break
      out.add(`${p}->${cur}`)
      cur = p
    }
    return out
  }, [treeRender, lastMsgId])
  const chatOverride = (activeChat && typeof activeChat === 'object' ? (activeChat as any).modelOverride : null) as any
  const overrideProviderId = String(chatOverride?.providerId || '').trim()
  const overrideModelId = String(chatOverride?.modelId || '').trim()
  const hasChatOverride = !!overrideProviderId && !!overrideModelId

  const roleProviderId = String((activeRole as any)?.modelRef?.providerId || '').trim()
  const roleModelId = String((activeRole as any)?.modelRef?.modelId || '').trim()
  const roleModelRef = (activeRole as any)?.modelRef || null

  const effectiveProviderId = hasChatOverride ? overrideProviderId : roleProviderId
  const effectiveModelId = hasChatOverride ? overrideModelId : roleModelId
  const effectiveModelRef = hasChatOverride
    ? { kind: 'provider', providerId: overrideProviderId, modelId: overrideModelId }
    : roleModelRef
  const reasoningProfile = activeTargetKind !== 'group'
    ? modelReasoningProfileFromModelRef(effectiveModelRef, providers, modelGroups)
    : { supportsReasoning: false, defaultReasoningEffort: '' as const }
  const activeChatReasoningEffort = chatReasoningEffort(activeChat)
  const activeEffectiveReasoningEffort = effectiveReasoningEffort(activeChat, reasoningProfile)
  const activeReasoningLabel = reasoningEffortLabel(activeEffectiveReasoningEffort)
  const hasChatReasoningOverride = !!activeChatReasoningEffort

  const {
    tempModelPickerEl,
    tempModelProviderId,
    tempModelPick,
    setTempModelPick,
    reasoningPickerEl,
    asyncToolTasksEl,
    asyncToolTasks,
    asyncToolTasksLoading,
    closeTempModelPicker,
    openTempModelPicker,
    onTempProviderChanged,
    saveTempModelOverride,
    clearTempModelOverride,
    openReasoningPicker,
    pickReasoningEffort,
    clearReasoningEffort,
    closeReasoningPicker,
    closeAsyncToolTasks,
    refreshAsyncToolTasks,
    openAsyncToolTasks,
  } = useComposerTools({
    controller,
    roleSessionControlsEnabled,
    activeRole,
    providers,
    effectiveProviderId,
    effectiveModelId,
    reasoningProfile,
    activeTargetKind,
    activeGroupId,
    activeWorkspaceId,
    activeChatId: String(activeChatId || ''),
    activeAsyncToolTasks,
  })
  const activeHookPromptMode = String((activeChat as any)?.hookPromptMode || '').trim() === 'none' ? 'none' : String((activeChat as any)?.hookPromptMode || '').trim() === 'preset' ? 'preset' : 'inherit'
  const activeHookPromptPresetId = String((activeChat as any)?.hookPromptPresetId || '').trim()
  const activeStreamOn = chatStreamEnabled(activeChat)
  const roleDefaultHookPromptPresetId = String((activeRole as any)?.hookPromptPresetId || '').trim()
  const hookPromptSelectorDisabled = s.loading || !activeChat
  const hookPromptSelectorDisabledReason = !activeChat
    ? '请先创建或选择会话'
    : chatSettingsHookSaving
      ? 'hook 提示词保存中…'
      : ''

  const uiBusy = !!s.loading




  const draftFiles: any[] = Array.isArray((s.draft as any)?.files) ? ((s.draft as any).files as any[]) : []
  const hasDraftFiles = draftFiles.length > 0
  const draftFilesPending = hasDraftFiles && draftFiles.some((f: any) => !!f?.pending)
  const draftFilesWarn =
    hasDraftFiles &&
    draftFiles.some((f: any) => {
      if (!f || f.pending) return false
      if (String(f?.error || '').trim()) return false
      const rawLen = String(f?.text || '').trim().length
      if (!rawLen) return false
      const pct = clampNum(Math.round(Number(f?.sendPct ?? 100)), 0, 100)
      const sendLen = Math.max(0, Math.ceil((rawLen * pct) / 100))
      return sendLen > attachSendLimitChars
    })

  const activeRoleId = String(activeRole?.id || '')
  const attachViewItem = (() => {
    const mid = String(attachView.mid || '').trim()
    const idx = Math.floor(Number(attachView.idx ?? -1))
    if (!mid || !renderChat || !Array.isArray((renderChat as any).messages) || idx < 0) return null
    const m = (renderChat as any).messages.find((x: any) => String(x?.id || '') === mid) || null
    const atts = m && Array.isArray(m.attachments) ? m.attachments : []
    const a = idx >= 0 && idx < atts.length ? atts[idx] : null
    if (!a) return null
    return { message: m, attachment: a }
  })()
  const chatNav = (() => {
    const loading = !!s.loading
    if (loading) return { olderId: '', newerId: '', lockedReason: '正在加载中' }
    let targetId = ''
    if (activeTargetKind === 'group') {
      targetId = String((activeGroup as any)?.id || activeGroupId || '').trim()
      if (!targetId) return { olderId: '', newerId: '', lockedReason: '请先选择群组' }
    } else if (activeTargetKind === 'workspace') {
      targetId = String((activeWorkspace as any)?.id || activeWorkspaceId || '').trim()
      if (!targetId) return { olderId: '', newerId: '', lockedReason: '请先选择工作区' }
    } else {
      targetId = String(activeRoleId || '').trim()
      if (!targetId) return { olderId: '', newerId: '', lockedReason: '请先选择角色' }
    }
    if (!data) return { olderId: '', newerId: '', lockedReason: '数据未就绪' }

    const box = activeTargetKind === 'group' ? (data as any)?.chatsByGroup?.[targetId] : activeTargetKind === 'workspace' ? (data as any)?.chatsByWorkspace?.[targetId] : data?.chatsByRole?.[targetId]
    const chats = sortChatListItemsForDisplay(Array.isArray(box?.chatMetas) && box.chatMetas.length ? box.chatMetas : Array.isArray(box?.chats) ? box.chats : [])
    const pendingChat = pendingChatForTarget(s, activeTargetKind, targetId)
    const currentChatId = String(activeChat?.id || box?.activeChatId || String(chats[0]?.id || '') || '')
    return chatNavigationFromOrderedChats({ orderedChats: chats, activeChatId: currentChatId, pendingChat })
  })()

  React.useLayoutEffect(() => {
    if (page !== 'chat') return
    const el = composerRef.current
    if (!el) return

    const measure = () => {
      try {
        setComposerHeight(Math.ceil(el.getBoundingClientRect().height || 0))
      } catch (_) {}
    }

    const raf = requestAnimationFrame(measure)

    if (typeof ResizeObserver === 'undefined') {
      return () => cancelAnimationFrame(raf)
    }

    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [page])

  React.useEffect(() => {
    if (page !== 'chat') return
    const el = chatRootRef.current
    if (!el) return
    const onScroll = () => {
      stickToBottomRef.current = isNearBottom(el)
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true } as any)
    return () => el.removeEventListener('scroll', onScroll as any)
  }, [page, activeRole?.id, activeChat?.id, activeBranchIdUi, branchDraftKey])

  React.useEffect(() => {
    if (page !== 'chat') return
    const el = chatRootRef.current
    if (!el) return
    if (Date.now() < autoScrollBlockUntilRef.current) return
    if (branchNav.mid) return
    stickToBottomRef.current = true
    requestAnimationFrame(() => {
      try {
        el.scrollTop = el.scrollHeight
      } catch (_) {}
    })
  }, [page, activeRole?.id, activeChat?.id, activeBranchIdUi, branchDraftKey, branchNav.mid])

  React.useEffect(() => {
    if (page !== 'chat') return
    const el = chatRootRef.current
    if (!el) return
    if (Date.now() < autoScrollBlockUntilRef.current) return
    if (!stickToBottomRef.current) return
    requestAnimationFrame(() => {
      try {
        el.scrollTop = el.scrollHeight
      } catch (_) {}
    })
  }, [page, allMessages.length, lastMsgId, lastMsgText, activeBranchIdUi, branchDraftKey])

  React.useEffect(() => {
    if (page !== 'chat') return
    const mid = String(branchNav.mid || '').trim()
    if (!mid) return

    const root = chatRootRef.current
    if (!root) return

    stickToBottomRef.current = false

    let tries = 0
    let canceled = false

    const tick = () => {
      if (canceled) return
      tries++
      const esc = typeof CSS !== 'undefined' && typeof (CSS as any).escape === 'function' ? (CSS as any).escape(mid) : mid.replace(/"/g, '\\"')
      const node = root.querySelector(`[data-mid="${esc}"]`) as HTMLElement | null
      if (node) {
        try {
          const rr = root.getBoundingClientRect()
          const nr = node.getBoundingClientRect()
          const top = nr.top - rr.top + root.scrollTop
          const target = Math.max(0, Math.floor(top - 12))
          root.scrollTop = target
        } catch (_) {}
        setBranchNav({ mid: '', at: 0 })
        return
      }
      if (tries >= 10) {
        setBranchNav({ mid: '', at: 0 })
        return
      }
      requestAnimationFrame(tick)
    }

    requestAnimationFrame(tick)
    return () => {
      canceled = true
    }
  }, [page, activeRole?.id, activeChat?.id, activeBranchIdUi, branchNav.mid, branchNav.at])

  const {
    sendWarn,
    closeSendWarn,
    beginRunPathFollow,
    sendFromComposer,
    confirmSendWarn,
    onSend,
    onStop,
  } = useChatSending({
    controller,
    activeChat,
    activeBranchIdUi,
    chatAllMessagesRaw,
    activeStopRunId,
    setSendPathAnchor,
    sendPathAnchorNonceRef,
    clearSendPathAnchor,
    setTreeSelectedMid,
    treeSelectedMid,
    branchDraft,
    draftFiles,
    draftFilesPending,
    attachSendLimitChars,
    stickToBottomRef,
  })
  const {
    expandedUserMsgIds,
    expandedToolMsgIds,
    toggleExpandedUserMsg,
    toggleExpandedToolMsg,
    messageMutationBlocked,
    regen,
    setRegen,
    msgMenu,
    treeNodeMenu,
    confirmDelMsg,
    setConfirmDelMsg,
    confirmDelTree,
    setConfirmDelTree,
    editingMsg,
    closeMsgMenu,
    onMessageContextMenu,
    closeTreeNodeMenu,
    onTreeNodeContextMenu,
    startEditMessage,
    setEditingMsgText,
    cancelEditMessage,
    saveEditMessage,
    copyMessageText,
    switchBranchSibling,
    openRegenConfirm,
    regenPathParentMid,
    openDeleteMessageConfirm,
    msgMenuMid,
    msgMenuText,
    msgMenuIsToolResponse,
    msgMenuCanEdit,
    msgMenuRegenMid,
    msgMenuRegenRole,
    msgMenuCanRegen,
  } = useMessageActions({
    controller,
    loading: !!s.loading,
    page,
    activeChat,
    activeRoleId: String(activeRole?.id || ''),
    activeBranchIdUi,
    branchDraftKey,
    userMessageCollapseEnabled,
    renderChat,
    renderChatId,
    activeSessionRunCards,
    activeSessionRunCardsKey,
    chatAllById,
    clearSendPathAnchor,
    setBranchNav,
    stickToBottomRef,
    autoScrollBlockUntilRef,
    treeSuppressClickRef,
  })
  const fileAdjustItem = fileAdjust.id ? draftFiles.find((x: any) => String(x?.id || '') === String(fileAdjust.id || '')) : null
  const fileAdjustName = String(fileAdjustItem?.name || '文件')
  const fileAdjustPending = !!fileAdjustItem?.pending
  const fileAdjustError = String(fileAdjustItem?.error || '').trim()
  const fileAdjustRaw = String(fileAdjustItem?.text || '').trim()
  const fileAdjustFullLen = fileAdjustRaw.length
  const fileAdjustPct = clampNum(Math.round(Number(fileAdjustItem?.sendPct ?? 100)), 0, 100)
  const fileAdjustSendLen = Math.max(0, Math.ceil((fileAdjustFullLen * fileAdjustPct) / 100))
  const fileAdjustTooLong = !fileAdjustPending && !fileAdjustError && fileAdjustFullLen > 0 && fileAdjustSendLen > attachSendLimitChars

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles styles={createChatGlobalStyles({ colorThemePreset, transparentChatBg, bgAlpha, chatBgBlur })} />

      <Box sx={{ height: '100%', minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative', color: 'var(--studio-text-primary)', background: 'var(--studio-app-background)' }}>
        <ChatTopBar
          page={page}
          loading={!!s.loading}
          roles={roles}
          groups={groups}
          workspaces={workspaces}
          activeTargetKind={activeTargetKind}
          activeGroup={activeGroup}
          activeRole={activeRole}
          activeWorkspace={activeWorkspace}
          topbarOpacity={topbarOpacity}
          topbarBlur={topbarBlur}
          treeOpen={treeOpen}
          chatNav={chatNav}
          standaloneWindowControls={standaloneWindowControls}
          onTopbarPointerDown={onTopbarPointerDown}
          onCloseSettings={closePluginSettings}
          onToggleTree={() => setTreeOpen((v) => !v)}
          onOpenRolePicker={openRolePicker}
          onOpenWorkspaceRolePicker={openWorkspaceRolePicker}
          onOpenChatPicker={openChatPicker}
          onCreateChat={() => controller.actions.createChat()}
          onOpenSettings={openPluginSettings}
          onSwitchChat={chatSwitch.requestSwitch}
        />

        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {page === 'chat' ? (
          <>
            <Box
              ref={chatPaneRef}
              sx={{
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                bgcolor: transparentChatBg ? 'transparent' : 'var(--studio-canvas)',
              }}
            >
             <CustomScrollArea
                ref={chatRootRef}
                onClick={onClickOpenImageViewer}
                hostSx={{
                  flex: 1,
                  minHeight: 0,
                }}
                scrollSx={{
                  height: '100%',
                  overflowX: 'hidden',
                  pl: 2,
                  pr: treeOpen && effectiveTreeView === 'right' ? `calc(16px + ${Math.round(treePanelW)}px)` : 2,
                  pt: `calc(${TOPBAR_H}px + 16px)`,
                  bgcolor: transparentChatBg ? 'transparent' : 'var(--studio-paper-muted)',
                  paddingBottom: `calc(${Math.max(0, composerHeight)}px + 24px)`,
               }}
              >
                {s.loading ? (
                  <Typography variant="body2" color="text.secondary">
                    加载中…
                  </Typography>
                ) : activeTargetKind === 'group' && !activeGroup ? (
                  <Typography variant="body2" color="text.secondary">
                    请选择群组
                  </Typography>
                ) : activeTargetKind === 'workspace' && !activeWorkspace ? (
                  <Typography variant="body2" color="text.secondary">
                    请选择工作区
                  </Typography>
                ) : activeTargetKind === 'workspace' && !activeRole ? (
                  <Typography variant="body2" color="text.secondary">
                    请选择角色
                  </Typography>
                ) : activeTargetKind !== 'group' && !activeRole ? (
                  <Typography variant="body2" color="text.secondary">
                    请选择角色
                  </Typography>
                ) : chatSwitch.switching ? (
                  <Box role="status" aria-live="polite" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
                    <CircularProgress size={18} thickness={4.4} color="inherit" />
                    <Typography variant="body2" color="text.secondary">
                      正在切换会话…
                    </Typography>
                  </Box>
                ) : !renderChat ? (
                  openingChatMeta ? (
                    <Box role="status" aria-live="polite" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
                      <CircularProgress size={18} thickness={4.4} color="inherit" />
                      <Typography variant="body2" color="text.secondary">
                        正在打开「{String((openingChatMeta as any)?.title || '会话')}」…
                      </Typography>
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      还没有消息。输入内容并发送。
                    </Typography>
                  )
              ) : !Array.isArray(renderChat.messages) || renderChat.messages.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  还没有消息。输入内容并发送。
                </Typography>
              ) : (
                <ChatMessageList
                  controller={controller}
                  messages={displayRenderMessages}
                  roles={roles}
                  activeRole={activeRole}
                  activeTargetKind={activeTargetKind}
                  activeVisibleRunCards={activeVisibleRunCards}
                  groupedAttMsgsByRootMid={groupedAttMsgsByRootMid}
                  prevAiMidByAssistantId={prevAiMidByAssistantId}
                  assistantSiblingsByPrevAiMid={assistantSiblingsByPrevAiMid}
                  chatAllMessagesRaw={chatAllMessagesRaw}
                  expandedToolMsgIds={expandedToolMsgIds}
                  expandedUserMsgIds={expandedUserMsgIds}
                  editingMsg={editingMsg}
                  loading={s.loading}
                  uiBusy={uiBusy}
                  userMessageCollapseEnabled={userMessageCollapseEnabled}
                  userMessageCollapseLines={userMessageCollapseLines}
                  stickersEnabled={stickersEnabled}
                  stickerMap={stickerMap}
                  renderSafetyPolicyKey={renderSafetyPolicy}
                  chatRootRef={chatRootRef}
                  formatModelRefText={formatModelRefText}
                  messageMutationBlocked={messageMutationBlocked}
                  onMessageContextMenu={onMessageContextMenu}
                  onToggleToolMessage={toggleExpandedToolMsg}
                  onToggleUserMessage={toggleExpandedUserMsg}
                  onEditTextChange={setEditingMsgText}
                  onCancelEditMessage={cancelEditMessage}
                  onSaveEditMessage={saveEditMessage}
                  onStartEditMessage={startEditMessage}
                  onCopyMessageText={copyMessageText}
                  onOpenAttachView={openAttachView}
                  onSwitchBranchSibling={switchBranchSibling}
                  onRegenerate={openRegenConfirm}
                  onDeleteMessage={openDeleteMessageConfirm}
                />
              )}
             </CustomScrollArea>

             <ComposerAttachmentsPopovers
               controller={controller}
               loading={!!s.loading}
               activeRole={activeRole}
               attachView={attachView}
               attachViewItem={attachViewItem}
               closeAttachView={closeAttachView}
               sendWarn={sendWarn}
               closeSendWarn={closeSendWarn}
               attachSendLimitChars={attachSendLimitChars}
               confirmSendWarn={confirmSendWarn}
               attachmentPickerEl={attachmentPickerEl}
               closeAttachmentPicker={closeAttachmentPicker}
               onPickDraftImages={onPickDraftImages}
               onPickDraftFiles={onPickDraftFiles}
               fileAdjust={fileAdjust}
               closeFileAdjust={closeFileAdjust}
               fileAdjustName={fileAdjustName}
               fileAdjustItem={fileAdjustItem}
               fileAdjustPending={fileAdjustPending}
               fileAdjustError={fileAdjustError}
               fileAdjustFullLen={fileAdjustFullLen}
               fileAdjustSendLen={fileAdjustSendLen}
               fileAdjustPct={fileAdjustPct}
               fileAdjustTooLong={fileAdjustTooLong}
               fileAdjustRaw={fileAdjustRaw}
             />

              <MessageMenusDialogs
                controller={controller}
                loading={!!s.loading}
                uiBusy={uiBusy}
                msgMenu={msgMenu}
                closeMsgMenu={closeMsgMenu}
                msgMenuIsToolResponse={msgMenuIsToolResponse}
                msgMenuMid={msgMenuMid}
                msgMenuText={msgMenuText}
                copyMessageText={copyMessageText}
                toggleExpandedToolMsg={toggleExpandedToolMsg}
                expandedToolMsgIds={expandedToolMsgIds}
                msgMenuCanEdit={msgMenuCanEdit}
                startEditMessage={startEditMessage}
                messageMutationBlocked={messageMutationBlocked}
                msgMenuCanRegen={msgMenuCanRegen}
                msgMenuRegenMid={msgMenuRegenMid}
                msgMenuRegenRole={msgMenuRegenRole}
                setRegen={setRegen}
                regen={regen}
                treeNodeMenu={treeNodeMenu}
                closeTreeNodeMenu={closeTreeNodeMenu}
                confirmDelMsg={confirmDelMsg}
                setConfirmDelMsg={setConfirmDelMsg}
                confirmDelTree={confirmDelTree}
                setConfirmDelTree={setConfirmDelTree}
                regenPathParentMid={regenPathParentMid}
                beginRunPathFollow={beginRunPathFollow}
              />


              <ChatTreeModal
                treeOpen={treeOpen}
                effectiveTreeView={effectiveTreeView}
                treePanelW={treePanelW}
                treeResizing={treeResizing}
                transparentChatBg={transparentChatBg}
                bgAlpha={bgAlpha}
                onTreeSplitterPointerDown={onTreeSplitterPointerDown}
                onTreeSplitterPointerMove={onTreeSplitterPointerMove}
                endTreeResize={endTreeResize}
                setTreePan={setTreePan}
                setTreeScale={setTreeScale}
                treeViewRef={treeViewRef}
                scheduleTreeViewTransform={scheduleTreeViewTransform}
                applyTreeViewTransform={applyTreeViewTransform}
                treeDir={treeDir}
                cycleTreeDir={cycleTreeDir}
                treeDragging={treeDragging}
                onTreePointerDown={onTreePointerDown}
                onTreePointerMove={onTreePointerMove}
                endTreeDrag={endTreeDrag}
                onTreeWheel={onTreeWheel}
                treeHostRightRef={treeHostRightRef}
                treeHostFloatRef={treeHostFloatRef}
                treeViewportRef={treeViewportRef}
                treeSuppressClickRef={treeSuppressClickRef}
                treeRender={treeRender}
                treeFocusMid={treeFocusMid}
                treeHighlightEdgeKeys={treeHighlightEdgeKeys}
                treePop={treePop}
                setTreeSelectedMid={setTreeSelectedMid}
                setTreePop={setTreePop}
                jumpToMessage={jumpToMessage}
                onTreeNodeContextMenu={onTreeNodeContextMenu}
                closeTreeModal={closeTreeModal}
              />

              <ChatComposer
                controller={controller}
                loading={!!s.loading}
                composerRef={composerRef}
                onClickOpenImageViewer={onClickOpenImageViewer}
                treeOpen={treeOpen}
                effectiveTreeView={effectiveTreeView}
                treePanelW={treePanelW}
                composerOpacity={composerOpacity}
                composerBlur={composerBlur}
                draft={s.draft}
                activeSessionComposerDraftKey={String((s as any).activeSessionComposerDraftKey || '')}
                attachSendLimitChars={attachSendLimitChars}
                draftFilePickerInputRef={draftFilePickerInputRef}
                onPickFilesChanged={onPickFilesChanged}
                composerInputRef={composerInputRef}
                activeTargetKind={activeTargetKind}
                activeChatTargetId={String(activeChatTargetId || '')}
                activeChatId={String(activeChatId || '')}
                activeRole={activeRole}
                activeGroup={activeGroup}
                roles={roles}
                activeStopRunId={activeStopRunId}
                draftFilesPending={draftFilesPending}
                draftFilesWarn={draftFilesWarn}
                hasDraftFiles={hasDraftFiles}
                formatModelRefText={formatModelRefText}
                openFileAdjust={openFileAdjust}
                openAttachmentPicker={openAttachmentPicker}
                hookPrompts={hookPrompts}
                activeHookPromptMode={activeHookPromptMode as any}
                activeHookPromptPresetId={activeHookPromptPresetId}
                roleDefaultHookPromptPresetId={roleDefaultHookPromptPresetId}
                hookPromptSelectorDisabled={hookPromptSelectorDisabled}
                chatSettingsHookSaving={chatSettingsHookSaving}
                hookPromptSelectorDisabledReason={hookPromptSelectorDisabledReason}
                roleSessionControlsEnabled={roleSessionControlsEnabled}
                chatSettingsModelSaving={chatSettingsModelSaving}
                hasChatOverride={hasChatOverride}
                chatOverride={chatOverride}
                effectiveModelId={effectiveModelId}
                openTempModelPicker={openTempModelPicker}
                providers={providers}
                reasoningProfile={reasoningProfile}
                activeReasoningLabel={activeReasoningLabel}
                chatSettingsReasoningSaving={chatSettingsReasoningSaving}
                openReasoningPicker={openReasoningPicker}
                hasChatReasoningOverride={hasChatReasoningOverride}
                activeContextTokenUsageText={activeContextTokenUsageText}
                activeContextTokenUsageShortText={activeContextTokenUsageShortText}
                activeAsyncToolTaskRunningCount={activeAsyncToolTaskRunningCount}
                openAsyncToolTasks={openAsyncToolTasks}
                activeStreamOn={activeStreamOn}
                chatSettingsStreamSaving={chatSettingsStreamSaving}
                activeChat={activeChat}
                onSend={onSend}
                onStop={onStop}
                onPaste={onPaste}
              />
        </Box>


        <ComposerControlsPopovers
          loading={!!s.loading}
          providers={providers}
          roleSessionControlsEnabled={roleSessionControlsEnabled}
          tempModelPickerEl={tempModelPickerEl}
          closeTempModelPicker={closeTempModelPicker}
          tempModelProviderId={tempModelProviderId}
          onTempProviderChanged={onTempProviderChanged}
          tempModelPick={tempModelPick}
          setTempModelPick={setTempModelPick}
          clearTempModelOverride={clearTempModelOverride}
          hasChatOverride={hasChatOverride}
          saveTempModelOverride={saveTempModelOverride}
          reasoningPickerEl={reasoningPickerEl}
          closeReasoningPicker={closeReasoningPicker}
          activeEffectiveReasoningEffort={activeEffectiveReasoningEffort}
          activeChatReasoningEffort={activeChatReasoningEffort}
          pickReasoningEffort={pickReasoningEffort}
          clearReasoningEffort={clearReasoningEffort}
          hasChatReasoningOverride={hasChatReasoningOverride}
          asyncToolTasksEl={asyncToolTasksEl}
          closeAsyncToolTasks={closeAsyncToolTasks}
          refreshAsyncToolTasks={refreshAsyncToolTasks}
          asyncToolTasksLoading={asyncToolTasksLoading}
          asyncToolTasks={asyncToolTasks}
        />


        <RolePickerPopover
          controller={controller}
          rolePickerEl={rolePickerEl}
          closeRolePicker={closeRolePicker}
          rolePickerMode={rolePickerMode}
          rolePickerTab={rolePickerTab}
          setRolePickerTab={setRolePickerTab}
          roles={roles}
          groups={groups}
          workspaces={workspaces}
          draftActiveRoleId={String(s.draft?.activeRoleId || '')}
          activeGroupId={activeGroupId}
          activeWorkspaceId={activeWorkspaceId}
          activeTargetKind={activeTargetKind}
          formatModelRefText={formatModelRefText}
          openPluginSettings={openPluginSettings}
        />

        <ChatPickerPopover
          controller={controller}
          data={data}
          chatPickerEl={chatPickerEl}
          closeChatPicker={closeChatPicker}
          chatPickerView={chatPickerView}
          setChatPickerView={setChatPickerView}
          chatPickerSearchOpen={chatPickerSearchOpen}
          setChatPickerSearchOpen={setChatPickerSearchOpen}
          chatPickerSearchText={chatPickerSearchText}
          setChatPickerSearchText={setChatPickerSearchText}
          chatPickerSearchInputRef={chatPickerSearchInputRef}
          chatHistoryScrollRef={chatHistoryScrollRef}
          onChatHistoryScrollPositionChange={onChatHistoryScrollPositionChange}
          chatHistoryVisibleCount={chatHistoryVisibleCount}
          favoriteSearchOpen={favoriteSearchOpen}
          setFavoriteSearchOpen={setFavoriteSearchOpen}
          favoriteSearchText={favoriteSearchText}
          setFavoriteSearchText={setFavoriteSearchText}
          favoriteSearchInputRef={favoriteSearchInputRef}
          favoriteFolders={favoriteFolders}
          renderFavoriteFolderTree={renderFavoriteFolderTree}
          collapseAllFavoriteFolders={collapseAllFavoriteFolders}
          openCreateFavoriteFolder={openCreateFavoriteFolder}
          activeTargetKind={activeTargetKind}
          activeGroup={activeGroup}
          activeWorkspace={activeWorkspace}
          activeRole={activeRole}
          activeChatTargetId={String(activeChatTargetId || '')}
          pendingGroupChat={(s as any)?.pendingGroupChat}
          pendingWorkspaceChat={(s as any)?.pendingWorkspaceChat}
          pendingRoleChat={(s as any)?.pendingChat}
          chatSessionRunIndicatorKind={chatSessionRunIndicatorKind}
          clearChatSessionRunNotice={clearChatSessionRunNotice}
          requestSwitch={chatSwitch.requestSwitch}
          onChatContextMenu={onChatContextMenu}
        />

        <ChatContextMenus
          controller={controller}
          loading={!!s.loading}
          favoriteFolderMenu={favoriteFolderMenu}
          closeFavoriteFolderMenu={closeFavoriteFolderMenu}
          openCreateFavoriteFolder={openCreateFavoriteFolder}
          setMoveFavoriteFolderDialog={setMoveFavoriteFolderDialog}
          openRenameFavoriteFolder={openRenameFavoriteFolder}
          setConfirmClearFavoriteFolder={setConfirmClearFavoriteFolder}
          openDeleteFavoriteFolderConfirm={openDeleteFavoriteFolderConfirm}
          favoriteChatMenu={favoriteChatMenu}
          closeFavoriteChatMenu={closeFavoriteChatMenu}
          openFavoriteDialog={openFavoriteDialog}
          setEditingChatTitle={setEditingChatTitle}
          isSendingThisChat={isSendingThisChat}
          chatMenu={chatMenu}
          closeChatMenu={closeChatMenu}
          setConfirmDelChat={setConfirmDelChat}
        />

      <FavoriteFoldersDialogs
        loading={!!s.loading}
        favoriteFolders={favoriteFolders}
        createFavoriteFolder={createFavoriteFolder}
        setCreateFavoriteFolder={setCreateFavoriteFolder}
        closeCreateFavoriteFolder={closeCreateFavoriteFolder}
        submitCreateFavoriteFolder={submitCreateFavoriteFolder}
        openCreateFavoriteFolder={openCreateFavoriteFolder}
        renameFavoriteFolder={renameFavoriteFolder}
        setRenameFavoriteFolder={setRenameFavoriteFolder}
        closeRenameFavoriteFolder={closeRenameFavoriteFolder}
        submitRenameFavoriteFolder={submitRenameFavoriteFolder}
        confirmDeleteFavoriteFolder={confirmDeleteFavoriteFolder}
        closeDeleteFavoriteFolderConfirm={closeDeleteFavoriteFolderConfirm}
        submitDeleteFavoriteFolder={submitDeleteFavoriteFolder}
        moveFavoriteFolderContents={moveFavoriteFolderContents}
        setMoveFavoriteFolderContents={setMoveFavoriteFolderContents}
        closeMoveFavoriteFolderContents={closeMoveFavoriteFolderContents}
        submitMoveFavoriteFolderContents={submitMoveFavoriteFolderContents}
        confirmClearFavoriteFolder={confirmClearFavoriteFolder}
        closeConfirmClearFavoriteFolder={closeConfirmClearFavoriteFolder}
        submitClearFavoriteFolder={submitClearFavoriteFolder}
        moveFavoriteFolderDialog={moveFavoriteFolderDialog}
        setMoveFavoriteFolderDialog={setMoveFavoriteFolderDialog}
        closeMoveFavoriteFolderDialog={closeMoveFavoriteFolderDialog}
        submitMoveFavoriteFolder={submitMoveFavoriteFolder}
        collectFavoriteFolderSubtreeIds={collectFavoriteFolderSubtreeIds}
        favoriteDialog={favoriteDialog}
        closeFavoriteDialog={closeFavoriteDialog}
        saveFavoriteDialog={saveFavoriteDialog}
        renderFavoriteFolderPicker={renderFavoriteFolderPicker}
        renderFavoriteFolderSinglePicker={renderFavoriteFolderSinglePicker}
      />

      <ChatSessionDialogs
        controller={controller}
        loading={!!s.loading}
        editingChatTitle={editingChatTitle}
        setEditingChatTitle={setEditingChatTitle}
        closeEditingChatTitle={closeEditingChatTitle}
        saveEditingChatTitle={saveEditingChatTitle}
        confirmDelChat={confirmDelChat}
        setConfirmDelChat={setConfirmDelChat}
        isSendingThisChat={isSendingThisChat}
      />

          </>
        ) : (
          <PluginSettingsPage
            controller={controller}
            loading={!!s.loading}
            data={data}
            roles={roles}
            groups={groups}
            workspaces={workspaces}
            providers={providers}
            modelGroups={(s as any).modelGroups}
            models={s.models}
            tools={(s as any).tools}
            modelRequestConfig={(s as any).modelRequestConfig}
            bootstrap={bootstrap}
            releaseBusy={releaseBusy}
            releaseView={releaseView}
            onReleaseRead={onReleaseRead}
            onReleaseRefresh={onReleaseRefresh}
            accessSettings={(s as any)?.accessSettings}
            hookPrompts={hookPrompts}
            placeholders={placeholders}
            systemPlugins={systemPlugins}
            draft={s.draft}
            activeRoleId={String(s.draft?.activeRoleId || '')}
            activeWorkspaceId={String((s.draft as any)?.activeWorkspaceId || '')}
            activeTargetKind={activeTargetKind}
            tab={settingsTab}
            onTabChange={setSettingsTab}
            dataDirectory={dataDirectory}
          />
        )}
        </Box>

        <ProvidersDialog open={s.modal === 'providers'} controller={controller} providers={providers} draft={s.draft} models={s.models} />
        <RoleDialog open={s.modal === 'role'} controller={controller} providers={providers} modelGroups={modelGroups} draft={s.draft} models={s.models} tools={(s as any).tools} hookPrompts={hookPrompts} />
        <GroupDialog open={s.modal === 'group'} controller={controller} roles={roles} draft={s.draft} />
        <WorkspaceDialog open={s.modal === 'workspace'} controller={controller} draft={s.draft} />
        <ConfirmDialog open={s.modal === 'confirm'} controller={controller} draft={s.draft} roles={roles} groups={groups} providers={providers} workspaces={workspaces} />
        <MermaidDialog open={s.modal === 'mermaid'} controller={controller} mermaid={s.mermaid} />
        <ImageDialog open={s.modal === 'image'} controller={controller} viewer={s.imageViewer} />
      </Box>
    </ThemeProvider>
  )
}

