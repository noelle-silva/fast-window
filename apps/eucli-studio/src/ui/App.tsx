import * as React from 'react'
import { Box, Button, CssBaseline, GlobalStyles, ThemeProvider, Typography } from '@mui/material'
import { useAiChatState } from './hooks/useAiChatState'
import { useSessionSwitch } from './hooks/useSessionSwitch'
import { useEvent } from './hooks/useEvent'
import { useFavoriteFolders } from './hooks/useFavoriteFolders'
import { useMessageActions } from './hooks/useMessageActions'
import { useChatTree } from './hooks/useChatTree'
import { useChatSending } from './hooks/useChatSending'
import {
  initialViewIntentState,
  onNodeClicked,
  onRunStarted,
  onRunRegistered,
  onChatSwitched,
  resolveViewFocusMid,
  resolveFollowTargetMid,
  runViewFactsFromCards,
  type ViewIntentState,
  type ViewFocusContext,
} from '../domain/viewIntent'
import { useComposerImagePicker } from './hooks/useComposerImagePicker'
import { useComposerTools } from './hooks/useComposerTools'
import { useChatSessionPickers } from './hooks/useChatSessionPickers'
import { useSessionRunObservations } from './hooks/useSessionRunObservations'
import { useRunningSessionNavigation } from './hooks/useRunningSessionNavigation'
import { useChatMessageIndex } from './hooks/useChatMessageIndex'
import { useChatMessageView } from './hooks/useChatMessageView'
import { useSessionKeepAlive } from './hooks/useSessionKeepAlive'
import { useSidebarResize } from './hooks/useSidebarResize'
import { clampNum } from './utils/numbers'
import { GROUP_ENTRY_VISIBLE, TOPBAR_H } from './appConstants'
import { createChatGlobalStyles } from './globalStyles'
import { messageRefreshScope } from '../domain/uiRefreshScope'
import { ProvidersDialog } from './dialogs/ProvidersDialog'
import { RoleDialog } from './dialogs/RoleDialog'
import { GroupDialog } from './dialogs/GroupDialog'
import { WorkspaceDialog } from './dialogs/WorkspaceDialog'
import { ConfirmDialog } from './dialogs/ConfirmDialog'
import { ToolWorkDirectoryPromptDialog } from './dialogs/ToolWorkDirectoryPromptDialog'
import { MermaidDialog } from './dialogs/MermaidDialog'
import { ImageDialog } from './dialogs/ImageDialog'
import { FavoriteFoldersDialogs } from './dialogs/FavoriteFoldersDialogs'
import { ChatSessionDialogs } from './dialogs/ChatSessionDialogs'
import { RunningSessionsDialog } from './dialogs/RunningSessionsDialog'
import { ChatContextMenus } from './dialogs/ChatContextMenus'
import { MessageMenusDialogs } from './dialogs/MessageMenusDialogs'
import { RolePickerPopover } from './dialogs/RolePickerPopover'
import { ChatPickerPopover } from './dialogs/ChatPickerPopover'
import { StandaloneWindowControls, type WindowControlActions } from './components/StandaloneWindowControls'
import { HookPromptSelector } from './components/HookPromptSelector'
import { ChatTopBar } from './components/ChatTopBar'
import { ChatSidebar } from './components/ChatSidebar'
import { resolveSortMovePosition } from './components/SortableDnd'
import { SidebarResizeLine } from './components/SidebarResizeLine'
import { SessionMessagePage } from './components/SessionMessagePage'
import { SessionPageStack } from './components/SessionPageStack'
import { Freeze } from './components/Freeze'
import type { AiChatDataDirectory } from './settings/DataSettingsPanel'
import type { AiChatEucliBoxConnection } from './settings/EbSettingsPanel'
import { PluginSettingsPage, type SettingsTabSelection } from './settings/PluginSettingsPage'
import { formatModelRefDisplayText, normalizeModelRef } from '../domain/modelRefUtils'
import { roleDefaultModelRef } from '../domain/roleModelCandidates'
import { activeChatTargetKey, resolveActiveChatNav } from '../domain/chatNavigation'
import { collectRunningSessions, runningSessionKey, type RunningSessionEntry } from '../domain/runningSessions'
import { workspaceRolesInScope } from '../domain/workspaceRoleScope'
import { chatSettingsTargetKey } from '../controller/chatSessionTarget'
import { chatReasoningEffort, effectiveReasoningEffort, modelReasoningProfileFromModelRef, reasoningEffortLabel } from '../domain/reasoning'
import { normalizeReasoningDisplayMode, normalizeReasoningRenderEnabled } from '../domain/reasoningDisplay'
import { normalizeMessageOffscreenSkipEnabled } from '../domain/messageOffscreen'
import { normalizeSessionKeepAliveLimit } from '../domain/sessionKeepAlive'
import { normalizeChatFontFamily, normalizeChatFontSize, normalizeChatLetterSpacing, normalizeChatLineHeight } from '../domain/chatFont'
import { normalizeComposerMinRows, normalizeComposerModelShowProvider, normalizeComposerRadius, normalizeComposerWidthPercent } from '../domain/composerAppearance'
import { chatStreamEnabled } from '../domain/chatStream'
import type { HookPromptLibrary } from '../domain/hookPrompt'
import type { PlaceholderLibrary } from '../domain/placeholder'
import type { ReleaseCandidatesViews, StudioBootstrap } from '../domain/release'
import { getColorThemeColors, resolveColorThemePreview } from '../domain/colorTheme'
import { ThemeColorsProvider } from './hooks/useThemeColors'
import { normalizeWallpaperSettings, wallpaperVeilAlpha } from '../domain/wallpaper'
import { useWallpaperImage } from './wallpaper/useWallpaperImage'
import { resolveSidebarLayout } from '../domain/sidebarLayout'
import { useSidebarNavigation } from './hooks/useSidebarNavigation'
import { colorMixVar, createStudioMuiTheme } from './colorThemeStyles'
import { ChatComposer } from './composer/ChatComposer'
import { ComposerControlsPopovers } from './composer/ComposerControlsPopovers'
import { ComposerImagePickerPopover } from './composer/ComposerImagePickerPopover'
import { ChatTreeModal } from './chatTree/ChatTreeModal'

type SettingsTab = SettingsTabSelection

export type AiChatWindowControls = {
  standalone: boolean
  actions: WindowControlActions
}

function isNearBottom(el: HTMLElement, thresholdPx = 24) {
  const gap = el.scrollHeight - el.scrollTop - el.clientHeight
  return Math.ceil(gap) <= thresholdPx
}

export function AiChatApp(props: { controller: any; bootstrap?: StudioBootstrap; dataDirectory?: AiChatDataDirectory; eucliBoxConnection?: AiChatEucliBoxConnection; windowControls?: AiChatWindowControls; releaseViews: ReleaseCandidatesViews; onReleaseRefresh: (kind?: string) => Promise<void> | void }) {
  const { controller, bootstrap, dataDirectory, eucliBoxConnection, windowControls, releaseViews, onReleaseRefresh } = props
  const s = useAiChatState(controller)
  const data = s.data
  const colorThemePreset = resolveColorThemePreview(data?.settings?.colorTheme, (s.draft as any)?.colorThemeDraft)
  const colorThemeColors = React.useMemo(() => getColorThemeColors(colorThemePreset), [colorThemePreset])
  const theme = React.useMemo(() => createStudioMuiTheme(colorThemePreset.mode, colorThemeColors), [colorThemePreset.mode, colorThemeColors])
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
  const composerWidthPercent = normalizeComposerWidthPercent(data?.settings?.composerWidthPercent)
  const composerMinRows = normalizeComposerMinRows(data?.settings?.composerMinRows)
  const composerRadius = normalizeComposerRadius(data?.settings?.composerRadius)
  const composerModelShowProvider = normalizeComposerModelShowProvider(data?.settings?.composerModelShowProvider)
  const chatFontSize = normalizeChatFontSize(data?.settings?.chatFontSize)
  const chatFontFamily = normalizeChatFontFamily(data?.settings?.chatFontFamily)
  const chatLetterSpacing = normalizeChatLetterSpacing(data?.settings?.chatLetterSpacing)
  const chatLineHeight = normalizeChatLineHeight(data?.settings?.chatLineHeight)
  const renderSafetyPolicy = (() => {
    const v = String((data?.settings as any)?.renderSafetyPolicy || 'original').trim()
    return v === 'unsafe' ? 'unsafe' : v === 'baseline' ? 'baseline' : 'original'
  })()
  const userMessageCollapseEnabled = !!data?.settings?.userMessageCollapseEnabled
  const userMessageCollapseLines = clampNum(Number(data?.settings?.userMessageCollapseLines ?? 8), 1, 50)
  const reasoningDisplayMode = normalizeReasoningDisplayMode(data?.settings?.reasoningDisplayMode)
  const reasoningRenderEnabled = normalizeReasoningRenderEnabled(data?.settings?.reasoningRenderEnabled)
  const messageOffscreenSkipEnabled = normalizeMessageOffscreenSkipEnabled(data?.settings?.messageOffscreenSkipEnabled)
  const sessionKeepAliveLimit = normalizeSessionKeepAliveLimit((data?.settings as any)?.sessionKeepAliveLimit)
  const stickersEnabled = !!data?.settings?.stickers?.enabled
  const stickerMap = data?.settings?.stickers?.map
  const stickerCategories = Array.isArray(data?.settings?.stickers?.categories) ? data.settings.stickers.categories : []
  const bgAlpha = transparentChatBg ? wallpaperVeilAlpha(chatBgOpacity, chatBgBlur) : 1
  const wallpaper = normalizeWallpaperSettings(data?.settings?.wallpaper)
  const activeWallpaper = wallpaper.enabled ? wallpaper.presets.find((preset) => preset.id === wallpaper.activeId) || null : null
  const activeWallpaperSrc = useWallpaperImage(controller, activeWallpaper?.relPath || '')

  const activeTargetKind0 = String((s.draft as any)?.activeTargetKind || (data?.ui as any)?.activeTargetKind || 'role').trim()
  const activeTargetKind: 'role' | 'group' | 'workspace' = activeTargetKind0 === 'group' ? 'group' : activeTargetKind0 === 'workspace' ? 'workspace' : 'role'
  const activeGroupId = String((s.draft as any)?.activeGroupId || (data?.ui as any)?.activeGroupId || '')
  const activeWorkspaceId = String((s.draft as any)?.activeWorkspaceId || (data?.ui as any)?.activeWorkspaceId || '')
  const activeRole = controller.activeRole()
  const activeGroup = activeTargetKind === 'group' ? (groups.find((g: any) => String(g?.id || '') === activeGroupId) || null) : null
  const activeWorkspace = React.useMemo(
    () => workspaces.find((workspace: any) => String(workspace?.id || '') === activeWorkspaceId) || null,
    [workspaces, activeWorkspaceId],
  )
  const activeWorkspaceRoles = React.useMemo(() => workspaceRolesInScope(activeWorkspace, roles), [activeWorkspace, roles])
  const activeChatTargetId = activeChatTargetKey(activeTargetKind, { groupId: activeGroupId, workspaceId: activeWorkspaceId, roleId: (activeRole as any)?.id })
  const activeChatSelectionBox = activeChatTargetId
    ? activeTargetKind === 'group'
      ? (data as any)?.chatsByGroup?.[activeChatTargetId]
      : activeTargetKind === 'workspace'
        ? (data as any)?.chatsByWorkspace?.[activeChatTargetId]
        : data?.chatsByRole?.[activeChatTargetId]
    : null
  const activeChat = controller.activeChat()
  // 目标解析只有一个来源：domain/sessionSwitchTarget。
  // App 这里只提供「控制器偏好」这一格，selectedId 的合成由 hook 内部统一完成。
  const preferredActiveChatId = String(activeChatSelectionBox?.activeChatId || '').trim()
  const pendingRoleChat = (s as any)?.pendingChat
  const pendingWorkspaceChat = (s as any)?.pendingWorkspaceChat
  const chatSwitch = useSessionSwitch(controller, activeChat, preferredActiveChatId)
  const renderChat = chatSwitch.renderChat
  const renderChatId = chatSwitch.renderChatId
  const activeChatId = chatSwitch.activeChatId

  // 正文加载失败的唯一事实源是 controller 的 chatLoadError（由加载路径写入）。
  // 这里只做「事实 → 状态机」的单向转发：失败必须进入 FAILED 终态，
  // 否则目标会话永远等不到正文，界面就停在「正在打开…」。
  const chatLoadError = (s as any)?.chatLoadError
  const chatLoadErrorReason = String(chatLoadError?.reason || '').trim()
  const notifyLoadFailed = chatSwitch.notifyLoadFailed
  React.useLayoutEffect(() => {
    if (!chatLoadErrorReason) return
    notifyLoadFailed(chatLoadErrorReason)
  }, [chatLoadErrorReason, notifyLoadFailed])
  const [runningSessionsOpen, setRunningSessionsOpen] = React.useState(false)
  const jumpToRunningSession = useRunningSessionNavigation({ controller, requestSwitch: chatSwitch.requestSwitch })
  const openRunningSession = useEvent((entry: RunningSessionEntry) => {
    jumpToRunningSession(entry)
    setRunningSessionsOpen(false)
  })
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
  // 会话视图意图：决定“当前看哪里”的唯一事实源。转移逻辑全在 viewIntent 纯函数里。
  const [viewIntentState, setViewIntentState] = React.useState<ViewIntentState>(() => initialViewIntentState())
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
  const revealMessageRef = React.useRef<((mid: string) => void) | null>(null)
  const stickToBottomRef = React.useRef(true)
  const autoScrollBlockUntilRef = React.useRef(0)
  const composerRef = React.useRef<HTMLDivElement | null>(null)
  const [composerHeight, setComposerHeight] = React.useState(0)
  const chatPaneRef = React.useRef<HTMLDivElement | null>(null)
  const [page, setPage] = React.useState<'chat' | 'settings'>('chat')
  const [settingsTab, setSettingsTab] = React.useState<SettingsTab>('auto')
  const [settingsVisited, setSettingsVisited] = React.useState(false)
  // 业务端就绪后设置页随 App 启动即预挂载：全部分类面板常驻，首次点入即为热态。
  const settingsMounted = settingsVisited || page === 'settings' || !!bootstrap?.businessAvailable
  React.useEffect(() => {
    if (page === 'settings') setSettingsVisited(true)
  }, [page])
  const [branchNav, setBranchNav] = React.useState<{ mid: string; at: number }>({ mid: '', at: 0 })

  const {
    rolePickerEl,
    rolePickerView,
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
  const roleSessionControlsEnabled = activeTargetKind !== 'group' && !!activeRole

  // 界面布局：聊天页固定使用一个侧边栏，位置与宽度只有一份配置。
  // 设置页仍用顶栏返回条。
  const sidebarLayout = resolveSidebarLayout(data?.settings)
  const sidebarVisible = page === 'chat'
  const sidebarResize = useSidebarResize({
    side: sidebarLayout.side,
    onCommit: (w) => controller.actions.setSidebarWidth?.(w),
  })

  const sidebarNavigation = useSidebarNavigation({
    controller,
    data,
    sidebarVisible,
    activeTargetKind,
    activeRole,
    activeWorkspaceId,
    roles,
    workspaces,
    selectedActiveChatId: chatSwitch.selectedChatId,
    pendingRoleChat,
    pendingWorkspaceChat,
    requestSwitch: chatSwitch.requestSwitch,
    clearChatSessionRunNotice,
  })
  const {
    switchSession,
    selectRole: onSelectRoleInSidebar,
    selectWorkspace: onSelectWorkspaceInSidebar,
    selectWorkspaceRole: onSelectWorkspaceRoleInSidebar,
    selectSession: onSelectSidebarSession,
    changeTab: onChangeSidebarTab,
  } = sidebarNavigation

  const {
    imagePickerEl,
    closeImagePicker,
    openImagePicker,
    onPickDraftImages,
    onPaste,
  } = useComposerImagePicker({
    controller,
    loading: !!s.loading,
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
    activeBranchHeadMid,
  } = useChatMessageIndex({
    s,
    renderChat,
    renderChatId,
    activeChatId,
    activeChat,
    activeTargetKind,
    activeChatTargetId,
  })

  // 活动运行事实：统一经领域转换，交给纯函数挑选跟随对象，保证多分支并行时目标稳定。
  const runViewFacts = React.useMemo(
    () => runViewFactsFromCards(activeSessionRunCards),
    [activeSessionRunCardsKey],
  )
  const viewFocusContext: ViewFocusContext = React.useMemo(
    () => ({
      pendingRunAnchorMid: viewIntentState.pendingRunAnchorMid,
      runs: runViewFacts,
      branchHeadMid: activeBranchHeadMid,
      chat: activeChat,
    }),
    [viewIntentState.pendingRunAnchorMid, runViewFacts, activeBranchHeadMid, activeChat],
  )
  // “最新节点”就是跟随目标本身：点中它→跟随，点其它任何节点（含同级分支）→锚定。
  const followTargetMid = React.useMemo(() => resolveFollowTargetMid(viewFocusContext), [viewFocusContext])
  const viewFocusMid = React.useMemo(
    () => resolveViewFocusMid(viewIntentState.intent, viewFocusContext),
    [viewIntentState.intent, viewFocusContext],
  )
  const viewAnchorMid = viewIntentState.intent.kind === 'anchor' ? viewIntentState.intent.mid : ''

  // 这次运行被登记后，空窗期的临时跟随目标即失效；切换会话时重置。
  React.useEffect(() => {
    setViewIntentState((prev) => {
      for (const fact of runViewFacts) {
        const next = onRunRegistered(prev, fact.anchorMid)
        if (next !== prev) return next
      }
      return prev
    })
  }, [activeSessionRunCardsKey])
  React.useEffect(() => {
    setViewIntentState(onChatSwitched())
  }, [String(activeChat?.id || '')])

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
    viewFocusMid,
    viewAnchorMid,
    // 点中“跟随目标”才进入跟随；点其它任何节点（含同级分支）都锚定。
    setViewIntentFromNodeClick: (mid: string) => setViewIntentState((prev) => onNodeClicked(prev, mid, followTargetMid)),
    branchDraft,
    branchDraftKey,
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
    renderMessages,
    activeRunTailPendingMessage,
    lastMsgText,
    activeContextTokenUsageText,
    activeContextTokenUsageShortText,
    activeCacheRateText,
    activeAsyncToolTasks,
    activeAsyncToolTaskRunningCount,
    lastMsgId,
  } = useChatMessageView({
    renderChat,
    renderChatId,
    chatAllMessagesRaw,
    prevAiMidByAssistantId,
    activeBranchIdUi,
    viewFocusMid,
    activeSessionRunCards,
    activeSessionRunCardsKey,
    activeChatRunCards,
    activeChat,
    activeTargetKind,
    branchDraft,
    branchDraftKey,
  })
  // 会话页面是否可装：只由「目标实体与数据」决定。
  // 切换中（switching）不是阻塞项——旧页会继续垫底，新页在下面完成绘制。
  const sessionPageBlocked =
    !!s.loading ||
    (activeTargetKind === 'group' && !activeGroup) ||
    (activeTargetKind === 'workspace' && !activeWorkspace) ||
    (activeTargetKind === 'workspace' && !activeWorkspaceRoles.length) ||
    (activeTargetKind !== 'group' && !activeRole)
  // 页面 key 的唯一来源是「已加载正文所属会话」（chatSwitch.renderChatId），
  // 不再自己判一次 renderChat.messages：那是对同一事实的第三次判断。
  // 消息数组的归一化由 useChatMessageView / normalizeStoredChat 负责。
  const sessionPageKey = !sessionPageBlocked && renderChatId ? renderChatId : ''
  // 可见页只由 PAINTED 推进；切换期间旧页保持可见，直到新页真正画出来。
  const sessionVisibleKey = chatSwitch.visibleKey
  const sessionKeepAliveKeys = useSessionKeepAlive(sessionPageKey, {
    limit: sessionKeepAliveLimit,
    pinnedKey: sessionVisibleKey,
  })
  // 屏外跳过的高度记忆按布局条件失效：这里汇总会影响消息高度的全局设置、字体与右侧树面板占位。
  const messageLayoutSignature = [
    chatFontSize,
    chatFontFamily,
    chatLetterSpacing,
    chatLineHeight,
    userMessageCollapseEnabled ? userMessageCollapseLines : 0,
    reasoningDisplayMode,
    reasoningRenderEnabled ? 1 : 0,
    renderSafetyPolicy,
    stickersEnabled ? `stickers:${Object.keys(stickerMap || {}).length}` : 'stickers:off',
    treeOpen && effectiveTreeView === 'right' ? `tree:${Math.round(treePanelW)}` : 'tree:off',
  ].join('|')
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
  const chatOverrideRef = normalizeModelRef(chatOverride)
  const hasChatOverride = !!chatOverrideRef
  const overrideProviderId = String(chatOverrideRef?.providerId || '').trim()
  const overrideModelId = String(chatOverrideRef?.modelId || '').trim()

  const roleModelRef = roleDefaultModelRef(activeRole)
  const roleProviderId = String(roleModelRef?.providerId || '').trim()
  const roleModelId = String(roleModelRef?.modelId || '').trim()

  const effectiveProviderId = hasChatOverride ? overrideProviderId : roleProviderId
  const effectiveModelId = hasChatOverride ? overrideModelId : roleModelId
  const effectiveModelRef = hasChatOverride ? chatOverrideRef : roleModelRef
  const reasoningProfile = activeTargetKind !== 'group'
    ? modelReasoningProfileFromModelRef(effectiveModelRef, providers, modelGroups)
    : { supportsReasoning: false, defaultReasoningEffort: '' as const }
  const activeChatReasoningEffort = chatReasoningEffort(activeChat)
  const activeEffectiveReasoningEffort = effectiveReasoningEffort(activeChat, reasoningProfile)
  const activeReasoningLabel = reasoningEffortLabel(activeEffectiveReasoningEffort)
  const hasChatReasoningOverride = !!activeChatReasoningEffort

  const {
    tempModelPickerEl,
    tempModelSource,
    tempModelProviderId,
    tempModelGroupId,
    tempModelPick,
    setTempModelPick,
    tempModelReady,
    roleModelCandidates,
    tempModelHighlightKey,
    onPickRoleModelCandidate,
    roleModelStepPrevEnabled,
    roleModelStepNextEnabled,
    stepRoleModelCandidate,
    reasoningPickerEl,
    asyncToolTasksEl,
    asyncToolTasks,
    asyncToolTasksLoading,
    closeTempModelPicker,
    openTempModelPicker,
    onTempModelSourceChanged,
    onTempProviderChanged,
    onTempModelGroupChanged,
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
    modelGroups,
    effectiveModelRef,
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




  const activeRoleId = String(activeRole?.id || '')
  // 会话导航统一走 domain：工作区会话按「工作区::角色」复合键取箱，
  // 曾用纯工作区 id 直查取空，导致历史切换按钮恒灰。
  const chatNav = resolveActiveChatNav({
    loading: !!s.loading,
    kind: activeTargetKind,
    groupId: activeGroupId,
    workspaceId: activeWorkspaceId,
    roleId: activeRoleId,
    data,
    state: s,
    activeChat,
  })

  React.useLayoutEffect(() => {
    // 只有聊天页有输入区；离开聊天页时清掉偏移，让通知回到默认位置。
    if (page !== 'chat') {
      document.documentElement.style.removeProperty('--studio-toast-bottom')
      return
    }
    const el = composerRef.current
    if (!el) return

    const measure = () => {
      try {
        const height = Math.ceil(el.getBoundingClientRect().height || 0)
        setComposerHeight(height)
        // 通知浮层要浮在输入区之上：把实测高度交给样式，避免写死偏移。
        document.documentElement.style.setProperty('--studio-toast-bottom', `${height + 32}px`)
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

  // 首次引导：由客户端本地记忆决定是否弹出「工具默认工作目录」引导；
  // 它只影响体验，工具的实际落点始终由业务端配置决定。
  React.useEffect(() => {
    void controller.actions.checkToolWorkDirectoryPrompt?.()
  }, [controller])

  // 滚动跟随只对「当前可见页」生效：隐藏的保活页不参与任何 scrollTop 写入。
  const pageVisible = sessionVisibleKey === sessionPageKey && !!sessionPageKey

  React.useEffect(() => {
    if (page !== 'chat' || !pageVisible) return
    const el = chatRootRef.current
    if (!el) return
    const onScroll = () => {
      stickToBottomRef.current = isNearBottom(el)
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true } as any)
    return () => el.removeEventListener('scroll', onScroll as any)
  }, [page, pageVisible, sessionPageKey, activeRole?.id, activeChat?.id, activeBranchIdUi, branchDraftKey])

  React.useEffect(() => {
    if (page !== 'chat' || !pageVisible) return
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
  }, [page, pageVisible, sessionPageKey, activeRole?.id, activeChat?.id, activeBranchIdUi, branchDraftKey, branchNav.mid])

  React.useEffect(() => {
    if (page !== 'chat' || !pageVisible) return
    const el = chatRootRef.current
    if (!el) return
    if (Date.now() < autoScrollBlockUntilRef.current) return
    if (!stickToBottomRef.current) return
    requestAnimationFrame(() => {
      try {
        el.scrollTop = el.scrollHeight
      } catch (_) {}
    })
  }, [page, pageVisible, sessionPageKey, allMessages.length, lastMsgId, lastMsgText, activeBranchIdUi, branchDraftKey])

  // 流式推进走范围刷新，不再触发整页渲染；这里单独订阅最后一条消息的范围，
  // 只做“跟随到底部”的滚动副作用，不引起 React 重渲染。
  // 页面不可见时不订阅：后台页面不该为流式推进继续写 scrollTop。
  React.useEffect(() => {
    if (page !== 'chat' || !pageVisible) return
    const mid = String(lastMsgId || '').trim()
    if (!mid || typeof controller?.subscribeScope !== 'function') return
    return controller.subscribeScope(messageRefreshScope(mid), () => {
      const el = chatRootRef.current
      if (!el) return
      if (Date.now() < autoScrollBlockUntilRef.current) return
      if (!stickToBottomRef.current) return
      requestAnimationFrame(() => {
        try {
          el.scrollTop = el.scrollHeight
        } catch (_) {}
      })
    })
  }, [page, pageVisible, sessionPageKey, lastMsgId, activeBranchIdUi, branchDraftKey, controller])

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
      // 目标可能在屏外占位中：先恢复它附近的排版，再读取位置完成定位。
      revealMessageRef.current?.(mid)
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
  }, [page, sessionPageKey, activeRole?.id, activeChat?.id, activeBranchIdUi, branchNav.mid, branchNav.at])

  const {
    sendFromComposer,
    onSend,
    onStop,
  } = useChatSending({
    controller,
    activeChat,
    activeStopRunId,
    viewAnchorMid,
    branchDraft,
    // 发起运行即回到“跟随最新”：用户要看这次运行的新产出。
    // 空窗期用分叉点兜住，避免闪回旧分支头部。
    onSendStarted: (runAnchorMid: string) => setViewIntentState((prev) => onRunStarted(prev, runAnchorMid)),
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
    followLatestView: () => setViewIntentState((prev) => onRunStarted(prev, '')),
    setBranchNav,
    stickToBottomRef,
    autoScrollBlockUntilRef,
    treeSuppressClickRef,
  })

  // 顶栏按钮配置：侧边栏负责角色 / 工作区导航，顶栏只保留会话操作与全局入口。
  const canCreateChat = activeTargetKind === 'workspace' ? !!(activeWorkspace && activeRole) : !!activeRole
  const runningSessions = collectRunningSessions({ state: s, data, includeGroups: GROUP_ENTRY_VISIBLE })
  const activeRunningSessionKey = runningSessionKey(activeTargetKind, activeChatTargetId, activeChatId)
  const navControlsProps = {
    canCreateChat,
    treeOpen,
    chatNav,
    onOpenChatPicker: openChatPicker,
    onOpenRunningSessions: () => setRunningSessionsOpen(true),
    onCreateChat: () => controller.actions.createChat(),
    onToggleTree: () => setTreeOpen((v) => !v),
    onOpenProviders: () => controller.actions.openProviders?.(),
    onOpenSettings: openPluginSettings,
    onSwitchChat: switchSession,
  }

  const sidebarMovePosition = (items: any[], activeId: string, overId: string) =>
    resolveSortMovePosition(items.map((item: any) => String(item?.id || '')), activeId, overId) || 'before'

  const sidebarProps = {
    controller,
    view: sidebarNavigation.view,
    onToggleView: sidebarNavigation.toggleView,
    width: sidebarLayout.width,
    sidebarRef: sidebarResize.sidebarRef,
    resizing: sidebarResize.resizing,
    onSplitterPointerDown: sidebarResize.onSplitterPointerDown,
    topbarOpacity,
    topbarBlur,
    roles,
    workspaceRoles: activeWorkspaceRoles,
    workspaces,
    activeRoleId: String((activeRole as any)?.id || ''),
    activeRoleAvatarImage: String((activeRole as any)?.avatarImage || ''),
    activeWorkspaceId,
    activeTargetKind,
    activeChatId: chatSwitch.selectedChatId,
    data,
    pendingRoleChat,
    pendingWorkspaceChat,
    formatModelRefText,
    openPluginSettings,
    fmtTime: controller.fmtTime,
    chatSessionRunIndicatorKind,
    onSelectRole: onSelectRoleInSidebar,
    onSelectWorkspace: onSelectWorkspaceInSidebar,
    onSelectWorkspaceRole: onSelectWorkspaceRoleInSidebar,
    onMoveRole: (activeId: string, overId: string) => controller.actions.moveRole?.(activeId, overId, sidebarMovePosition(roles, activeId, overId)),
    onMoveWorkspace: (activeId: string, overId: string) => controller.actions.moveWorkspace?.(activeId, overId, sidebarMovePosition(workspaces, activeId, overId)),
    onSelectSession: onSelectSidebarSession,
    onChatContextMenu,
    onTabChange: onChangeSidebarTab,
  }

  return (
    <ThemeProvider theme={theme}>
      <ThemeColorsProvider colors={colorThemeColors}>
      <CssBaseline />
      <GlobalStyles styles={createChatGlobalStyles({ colorThemeColors, transparentChatBg, bgAlpha, chatBgBlur, chatFontSize, chatFontFamily, chatLetterSpacing, chatLineHeight })} />

      <Box sx={{ height: '100%', minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative', isolation: 'isolate', color: 'var(--studio-text-primary)', background: 'var(--studio-app-background)' }}>
        {activeWallpaper ? (
          <Box sx={{ position: 'absolute', inset: 0, zIndex: -2, pointerEvents: 'none', overflow: 'hidden' }}>
            {activeWallpaperSrc ? (
              <Box
                component="img"
                src={activeWallpaperSrc}
                alt=""
                sx={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: `${activeWallpaper.view.x}% ${activeWallpaper.view.y}%`,
                  transform: `scale(${activeWallpaper.view.scale * 1.05})`,
                  transformOrigin: `${activeWallpaper.view.x}% ${activeWallpaper.view.y}%`,
                  display: 'block',
                }}
              />
            ) : null}
          </Box>
        ) : null}
        {activeWallpaper ? (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              zIndex: -1,
              pointerEvents: 'none',
              bgcolor: colorMixVar('--studio-canvas', Math.max(1, bgAlpha * 100)),
              backdropFilter: chatBgBlur > 0 ? `blur(${chatBgBlur}px)` : 'none',
              WebkitBackdropFilter: chatBgBlur > 0 ? `blur(${chatBgBlur}px)` : 'none',
            }}
          />
        ) : null}
        <ChatTopBar
          page={page}
          topbarOpacity={topbarOpacity}
          topbarBlur={topbarBlur}
          standaloneWindowControls={standaloneWindowControls}
          onTopbarPointerDown={onTopbarPointerDown}
          onCloseSettings={closePluginSettings}
          nav={navControlsProps}
        />

        <Box sx={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'row' }}>
          {sidebarVisible && sidebarLayout.side === 'left' ? (
            <ChatSidebar {...sidebarProps} side="left" />
          ) : null}

          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <Box
          aria-hidden={page === 'chat' ? undefined : true}
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            // 常驻不卸载：离开聊天页只隐藏，避免返回时整棵聊天子树重新挂载造成卡顿。
            visibility: page === 'chat' ? 'inherit' : 'hidden',
          }}
        >
          <Freeze frozen={page !== 'chat'}>
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
              {/* 切换进度只做「细进度条」：不遮挡内容区，旧页继续垫底。 */}
              {chatSwitch.switching ? (
                <Box
                  role="progressbar"
                  aria-label="正在切换会话"
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 2,
                    zIndex: 3,
                    overflow: 'hidden',
                    pointerEvents: 'none',
                    bgcolor: 'var(--studio-border)',
                    '&::after': {
                      content: '""',
                      position: 'absolute',
                      inset: 0,
                      width: '35%',
                      bgcolor: 'var(--studio-secondary)',
                      animation: 'fw-switch-progress 900ms ease-in-out infinite',
                    },
                    '@keyframes fw-switch-progress': {
                      '0%': { transform: 'translateX(-100%)' },
                      '100%': { transform: 'translateX(320%)' },
                    },
                  }}
                />
              ) : null}
             <SessionPageStack
                activeKey={sessionPageKey}
                visibleKey={sessionVisibleKey}
                keys={sessionKeepAliveKeys}
                activeScrollRef={chatRootRef}
                onPainted={chatSwitch.notifyPainted}
                activePage={
                  sessionPageKey ? (
                    <SessionMessagePage
                      sessionKey={sessionPageKey}
                      messages={renderMessages}
                      hasMessages={!!renderChat && Array.isArray(renderChat.messages) && renderChat.messages.length > 0}
                      activeRunTailPendingMessage={activeRunTailPendingMessage}
                      layoutSignature={messageLayoutSignature}
                      messageOffscreenEnabled={messageOffscreenSkipEnabled}
                      revealMessageRef={revealMessageRef}
                      emptyContent={
                        <Typography variant="body2" color="text.secondary">
                          还没有消息。输入内容并发送。
                        </Typography>
                      }
                      messageListProps={{
                        controller,
                        roles,
                        activeRole,
                        activeTargetKind,
                        activeVisibleRunCards,
                        prevAiMidByAssistantId,
                        assistantSiblingsByPrevAiMid,
                        chatAllMessagesRaw,
                        expandedToolMsgIds,
                        expandedUserMsgIds,
                        editingMsg,
                        loading: s.loading,
                        uiBusy,
                        userMessageCollapseEnabled,
                        userMessageCollapseLines,
                        reasoningDisplayMode,
                        reasoningRenderEnabled,
                        stickersEnabled,
                        stickerMap,
                        renderSafetyPolicyKey: renderSafetyPolicy,
                        formatModelRefText,
                        messageMutationBlocked,
                        onMessageContextMenu,
                        onToggleToolMessage: toggleExpandedToolMsg,
                        onToggleUserMessage: toggleExpandedUserMsg,
                        onEditTextChange: setEditingMsgText,
                        onCancelEditMessage: cancelEditMessage,
                        onSaveEditMessage: saveEditMessage,
                        onStartEditMessage: startEditMessage,
                        onCopyMessageText: copyMessageText,
                        onSwitchBranchSibling: switchBranchSibling,
                        onRegenerate: openRegenConfirm,
                        onDeleteMessage: openDeleteMessageConfirm,
                      }}
                      scrollHostSx={{
                        flex: 1,
                        minHeight: 0,
                      }}
                      scrollSx={{
                        height: '100%',
                        overflowX: 'hidden',
                        overflowAnchor: 'none',
                        pl: 2,
                        pr: treeOpen && effectiveTreeView === 'right' ? `calc(16px + ${Math.round(treePanelW)}px)` : 2,
                        pt: `calc(${TOPBAR_H}px + 16px)`,
                        bgcolor: transparentChatBg ? 'transparent' : 'var(--studio-paper-muted)',
                        paddingBottom: `calc(${Math.max(0, composerHeight)}px + 24px)`,
                      }}
                      onClick={onClickOpenImageViewer}
                    />
                  ) : null
                }
              />

              {/* 只有「没有旧页可垫底」时才允许占位内容：冷启动首次、上次失败、上次 empty。
                  切换期间旧页保持可见，这里不能抢画面。 */}
              {!sessionPageKey && !sessionVisibleKey ? (
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    overflowY: 'auto',
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
                  ) : activeTargetKind === 'workspace' && !activeWorkspaceRoles.length ? (
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        当前工作区还没有注册角色。
                      </Typography>
                      <Button size="small" variant="contained" sx={{ mt: 1 }} onClick={() => openPluginSettings('workspaces')}>
                        去注册角色
                      </Button>
                    </Box>
                  ) : activeTargetKind === 'workspace' && !activeRole ? (
                    <Typography variant="body2" color="text.secondary">
                      请选择角色
                    </Typography>
                  ) : activeTargetKind !== 'group' && !activeRole ? (
                    <Typography variant="body2" color="text.secondary">
                      请选择角色
                    </Typography>
                  ) : !renderChat ? (
                    chatSwitch.failed ? (
                      // 加载失败是终态：必须给出错误占位 + 重试入口，
                      // 绝不允许继续显示「正在打开…」让用户无限等待。
                      <Box role="alert" sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                        <Typography variant="body2" color="error">
                          会话加载失败：{chatSwitch.failedReason || '未知错误'}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <Button size="small" variant="contained" onClick={() => chatSwitch.retryLoad()}>
                            重试
                          </Button>
                        </Box>
                      </Box>
                    ) : openingChatMeta ? (
                      // 无旧页可垫底时才用骨架；骨架复用消息区精确几何，promote 时不跳动。
                      <Box role="status" aria-live="polite" sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                        {[0, 1, 2].map((i) => (
                          <Box
                            key={i}
                            sx={{
                              height: i === 0 ? 56 : 96,
                              borderRadius: 3,
                              bgcolor: 'var(--studio-paper)',
                              border: '1px solid var(--studio-border)',
                              opacity: 0.6,
                            }}
                          />
                        ))}
                        <Typography variant="caption" color="text.secondary">
                          正在打开「{String((openingChatMeta as any)?.title || '会话')}」…
                        </Typography>
                      </Box>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        还没有消息。输入内容并发送。
                      </Typography>
                    )
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      还没有消息。输入内容并发送。
                    </Typography>
                  )}
                </Box>
              ) : null}

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
                composerWidthPercent={composerWidthPercent}
                composerMinRows={composerMinRows}
                composerRadius={composerRadius}
                composerModelShowProvider={composerModelShowProvider}
                draft={s.draft}
                activeSessionComposerDraftKey={String((s as any).activeSessionComposerDraftKey || '')}
                composerInputRef={composerInputRef}
                activeTargetKind={activeTargetKind}
                activeChatTargetId={String(activeChatTargetId || '')}
                activeChatId={String(activeChatId || '')}
                activeRole={activeRole}
                activeGroup={activeGroup}
                roles={roles}
                activeStopRunId={activeStopRunId}
                formatModelRefText={formatModelRefText}
                openImagePicker={openImagePicker}
                hookPrompts={hookPrompts}
                activeHookPromptMode={activeHookPromptMode as any}
                activeHookPromptPresetId={activeHookPromptPresetId}
                roleDefaultHookPromptPresetId={roleDefaultHookPromptPresetId}
                hookPromptSelectorDisabled={hookPromptSelectorDisabled}
                chatSettingsHookSaving={chatSettingsHookSaving}
                hookPromptSelectorDisabledReason={hookPromptSelectorDisabledReason}
                roleSessionControlsEnabled={roleSessionControlsEnabled}
                hasChatOverride={hasChatOverride}
                effectiveModelId={effectiveModelId}
                effectiveModelRef={effectiveModelRef}
                openTempModelPicker={openTempModelPicker}
                roleModelStepPrevEnabled={roleModelStepPrevEnabled}
                roleModelStepNextEnabled={roleModelStepNextEnabled}
                stepRoleModelCandidate={stepRoleModelCandidate}
                providers={providers}
                modelGroups={modelGroups}
                reasoningProfile={reasoningProfile}
                activeReasoningLabel={activeReasoningLabel}
                chatSettingsReasoningSaving={chatSettingsReasoningSaving}
                openReasoningPicker={openReasoningPicker}
                hasChatReasoningOverride={hasChatReasoningOverride}
                activeContextTokenUsageText={activeContextTokenUsageText}
                activeContextTokenUsageShortText={activeContextTokenUsageShortText}
                activeCacheRateText={activeCacheRateText}
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
          </Freeze>

          {/* 全局弹层区：刻意放在页面冻结子树之外。
              弹层是 Portal 浮层、不属于页面内容；一旦被 Freeze 冻结，
              「关闭弹层 + 切页」同批次的更新会被 Freeze 复用旧元素而吞掉，
              弹层 open 会卡在 true、遮罩残留并拦截整页交互
              （典型症状：没有工作区时点「去创建工作区」跳设置页，浮窗不关）。 */}
          <ComposerImagePickerPopover
            controller={controller}
            loading={!!s.loading}
            activeRole={activeRole}
            imagePickerEl={imagePickerEl}
            closeImagePicker={closeImagePicker}
            onPickDraftImages={onPickDraftImages}
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
            onRunStarted={(runAnchorMid: string) => setViewIntentState((prev) => onRunStarted(prev, runAnchorMid))}
          />

          <ComposerControlsPopovers
            controller={controller}
            loading={!!s.loading}
            providers={providers}
            modelGroups={modelGroups}
            roleSessionControlsEnabled={roleSessionControlsEnabled}
            tempModelPickerEl={tempModelPickerEl}
            closeTempModelPicker={closeTempModelPicker}
            tempModelSource={tempModelSource}
            onTempModelSourceChanged={onTempModelSourceChanged}
            tempModelProviderId={tempModelProviderId}
            onTempProviderChanged={onTempProviderChanged}
            tempModelGroupId={tempModelGroupId}
            onTempModelGroupChanged={onTempModelGroupChanged}
            tempModelPick={tempModelPick}
            setTempModelPick={setTempModelPick}
            tempModelReady={tempModelReady}
            roleModelCandidates={roleModelCandidates}
            tempModelHighlightKey={tempModelHighlightKey}
            onPickRoleModelCandidate={onPickRoleModelCandidate}
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
            rolePickerView={rolePickerView}
            roles={roles}
            workspaceRoles={activeWorkspaceRoles}
            workspaces={workspaces}
            draftActiveRoleId={String(s.draft?.activeRoleId || '')}
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
            requestSwitch={switchSession}
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

          <RunningSessionsDialog
            open={runningSessionsOpen}
            entries={runningSessions}
            activeKey={activeRunningSessionKey}
            onClose={() => setRunningSessionsOpen(false)}
            onOpen={openRunningSession}
          />

        </Box>

        {settingsMounted ? (
        <Box
          aria-hidden={page === 'settings' ? undefined : true}
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            // 与聊天层同理：用 inherit 而非显式 visible，避免隐藏时子级穿透父级重新显形。
            visibility: page === 'settings' ? 'inherit' : 'hidden',
          }}
        >
          <Freeze frozen={page !== 'settings'}>
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
            toolWorkDirectory={(s as any).toolWorkDirectory}
            modelRequestConfig={(s as any).modelRequestConfig}
            conversationImageConfig={(s as any).conversationImageConfig}
            requestRecords={(s as any).requestRecords}
            bootstrap={bootstrap}
            releaseViews={releaseViews}
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
            eucliBoxConnection={eucliBoxConnection}
          />
          </Freeze>
        </Box>
        ) : null}
          </Box>

          {sidebarVisible && sidebarLayout.side === 'right' ? (
            <ChatSidebar {...sidebarProps} side="right" />
          ) : null}
        </Box>

        <SidebarResizeLine lineRef={sidebarResize.lineRef} active={sidebarResize.resizing} />

        <ProvidersDialog open={s.modal === 'providers'} controller={controller} providers={providers} draft={s.draft} models={s.models} loading={!!s.loading} />
        <RoleDialog open={s.modal === 'role'} controller={controller} providers={providers} modelGroups={modelGroups} draft={s.draft} models={s.models} tools={(s as any).tools} hookPrompts={hookPrompts} placeholders={placeholders} systemPlugins={systemPlugins} />
        <GroupDialog open={s.modal === 'group'} controller={controller} roles={roles} draft={s.draft} />
        <WorkspaceDialog open={s.modal === 'workspace'} controller={controller} draft={s.draft} roles={roles} />
        <ToolWorkDirectoryPromptDialog controller={controller} state={(s as any).toolWorkDirectory} />
        <ConfirmDialog open={s.modal === 'confirm'} controller={controller} draft={s.draft} roles={roles} groups={groups} providers={providers} workspaces={workspaces} />
        <MermaidDialog open={s.modal === 'mermaid'} controller={controller} mermaid={s.mermaid} />
        <ImageDialog open={s.modal === 'image'} controller={controller} viewer={s.imageViewer} />
      </Box>
      </ThemeColorsProvider>
    </ThemeProvider>
  )
}

