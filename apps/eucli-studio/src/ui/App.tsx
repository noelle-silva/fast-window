import * as React from 'react'
import { Box, Button, Typography } from '@mui/material'
import { useScopedUiVersion, useScopedUiVersions } from './hooks/useScopedUiVersion'
import { useSessionSwitch } from './hooks/useSessionSwitch'
import { useEvent } from './hooks/useEvent'
import { useFavoriteFolders } from './hooks/useFavoriteFolders'
import { useFavoriteFolderNavigation } from './hooks/useFavoriteFolderNavigation'
import type { FavoriteFolderLevelEntry } from '../domain/favoriteFolderLevel'
import { useMessageActions } from './hooks/useMessageActions'
import { useChatTree } from './hooks/useChatTree'
import { useChatSending } from './hooks/useChatSending'
import {
  EMPTY_SELECTION,
  followFrom,
  placeSelection,
  resolveSelection,
  selectionAtLatest,
  type ViewSelection,
} from '../domain/viewSelection'
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
import { messageRefreshScope, refreshScopes } from '../domain/uiRefreshScope'
import { APP_ROOT_REFRESH_SCOPES } from '../domain/appRefreshScopes'
import { ProvidersDialog } from './dialogs/ProvidersDialog'
import { RoleDialog } from './dialogs/RoleDialog'
import { GroupDialog } from './dialogs/GroupDialog'
import { WorkspaceDialog } from './dialogs/WorkspaceDialog'
import { ConfirmDialog } from './dialogs/ConfirmDialog'
import { ToolWorkDirectoryPromptDialog } from './dialogs/ToolWorkDirectoryPromptDialog'
import { MermaidDialog } from './dialogs/MermaidDialog'
import { ImageDialog } from './dialogs/ImageDialog'
import { StandaloneWindowControls, type WindowControlActions } from './components/StandaloneWindowControls'
import { resolveSortMovePosition } from './components/SortableDnd'
import { SidebarResizeLine } from './components/SidebarResizeLine'
import { SessionMessagePage } from './components/SessionMessagePage'
import type { AiChatDataDirectory } from './settings/DataSettingsPanel'
import type { AiChatEucliBoxConnection } from './settings/EbSettingsPanel'
import { PluginSettingsPage, type SettingsTabSelection } from './settings/PluginSettingsPage'
import { formatModelRefDisplayText, normalizeModelRef } from '../domain/modelRefUtils'
import { roleDefaultModelRef } from '../domain/roleModelCandidates'
import { activeChatTargetKey, resolveActiveChatNav } from '../domain/chatNavigation'
import { resolveRunFocusMid } from '../domain/branching'
import { collectRunningSessions, runningSessionKey, type RunningSessionEntry } from '../domain/runningSessions'
import { workspaceRolesInScope } from '../domain/workspaceRoleScope'
import { chatSettingsTargetKey } from '../controller/chatSessionTarget'
import { selectChatLoadFailure } from '../controller/chatLoadFailure'
import { chatReasoningEffort, effectiveReasoningEffort, modelReasoningProfileFromModelRef, reasoningEffortLabel } from '../domain/reasoning'
import { normalizeReasoningDisplayMode, normalizeReasoningRenderEnabled } from '../domain/reasoningDisplay'
import { normalizeMessageOffscreenSkipEnabled } from '../domain/messageOffscreen'
import { normalizeSessionKeepAliveLimit } from '../domain/sessionKeepAlive'
import { normalizeChatFontFamily, normalizeChatFontSize, normalizeChatLetterSpacing, normalizeChatLineHeight } from '../domain/chatFont'
import { normalizeComposerMinRows, normalizeComposerModelShowProvider, normalizeComposerRadius, normalizeComposerWidthPercent } from '../domain/composerAppearance'
import { normalizeComposerToolsLayout } from '../domain/composerToolsLayout'
import {
  normalizeChatBgBlur,
  normalizeChatBgOpacity,
  normalizeComposerBlur,
  normalizeComposerOpacity,
  normalizeTopbarBlur,
  normalizeTopbarOpacity,
} from '../domain/appearanceSettings'
import { chatStreamEnabled } from '../domain/chatStream'
import type { HookPromptLibrary } from '../domain/hookPrompt'
import type { PlaceholderLibrary } from '../domain/placeholder'
import type { ReleaseCandidatesViews, StudioBootstrap } from '../domain/release'
import { getColorThemeColors, resolveColorThemePreview } from '../domain/colorTheme'
import { isTransparentChatBg, normalizeWallpaperSettings, wallpaperVeilAlpha } from '../domain/wallpaper'
import { useWallpaperImage } from './wallpaper/useWallpaperImage'
import { resolveSidebarLayout } from '../domain/sidebarLayout'
import {
  DESK_HOVER_ROLE_ICON_SETTING_KEY,
  normalizeDeskHoverRoleIcon,
  type DeskEntry,
} from '../domain/desks'
import {
  FAVORITE_HOVER_ROLE_ICON_SETTING_KEY,
  normalizeFavoriteHoverRoleIcon,
} from '../domain/favoriteFolderSettings'
import { addDeskDraft } from '../domain/deskDrafts'
import { parseWorkspaceRoleTargetId, workspaceRoleTargetId } from '../domain/workspaceRoleTarget'
import { useSidebarNavigation } from './hooks/useSidebarNavigation'
import { createStudioMuiTheme } from './colorThemeStyles'
import { ChatTreeModal } from './chatTree/ChatTreeModal'
import { ShellFrame } from './surfaces/ShellFrame'
import { TopBarSurface } from './surfaces/TopBarSurface'
import { SidebarSurface } from './surfaces/SidebarSurface'
import { SidebarBPanel } from './components/SidebarBPanel'
import { ComposerSurface } from './surfaces/ComposerSurface'
import { SessionViewport } from './surfaces/SessionViewport'
import { SettingsSurface } from './surfaces/SettingsSurface'
import { OverlaySurface } from './surfaces/OverlaySurface'

type SettingsTab = SettingsTabSelection

export type AiChatWindowControls = {
  standalone: boolean
  actions: WindowControlActions
}

function isNearBottom(el: HTMLElement, thresholdPx = 24) {
  const gap = el.scrollHeight - el.scrollTop - el.clientHeight
  return Math.ceil(gap) <= thresholdPx
}

// 无树 / 无目标时返回同一个稳定空集，避免每次渲染新建 Set 让下游 memo 失效。
const EMPTY_TREE_HIGHLIGHT_EDGE_KEYS = new Set<string>()

// 消息页滚动容器的稳定 props：所有会话页共享同一对象。
const SESSION_SCROLL_HOST_SX = { flex: 1, minHeight: 0 } as const

// 空会话文案只创建一次，避免每次渲染给消息页新元素。
const EMPTY_SESSION_CONTENT = (
  <Typography variant="body2" color="text.secondary">
    还没有消息。输入内容并发送。
  </Typography>
)

export function AiChatApp(props: { controller: any; bootstrap?: StudioBootstrap; dataDirectory?: AiChatDataDirectory; eucliBoxConnection?: AiChatEucliBoxConnection; windowControls?: AiChatWindowControls; releaseViews: ReleaseCandidatesViews; onReleaseRefresh: (kind?: string) => Promise<void> | void }) {
  const { controller, bootstrap, dataDirectory, eucliBoxConnection, windowControls, releaseViews, onReleaseRefresh } = props
  const s = controller.getState()
  const data = s.data
  // App 根不再订阅全局版本：每类变化都由显式地址驱动。
  // appData 只承担启动加载 / epoch 换代 / 整包替换 / loading 这类低频事实。
  const appDataVersion = useScopedUiVersion(controller, refreshScopes.appData())
  // 外观 / 字体 / 壁纸 / 树设置等全局设置：App 是壳层的唯一接线点，
  // 设置变化先在这里失效，再由稳定 props 分发给 ShellFrame / Surface。
  const settingsVersion = useScopedUiVersion(controller, refreshScopes.settings())
  // 实体 / 库 / 插件域与壳层路由：这些数据会被就地修改，必须用地址版本穿透 memo。
  // 订阅清单只来自注册表，新增实体域不再需要在这里补数组。
  const domainVersion = useScopedUiVersions(controller, APP_ROOT_REFRESH_SCOPES)
  const runCardsVersion = useScopedUiVersion(controller, refreshScopes.runCards())

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
  const transparentChatBg = isTransparentChatBg(data?.settings)
  const chatBgOpacity = normalizeChatBgOpacity(data?.settings?.chatBgOpacity)
  const chatBgBlur = normalizeChatBgBlur(data?.settings?.chatBgBlur)
  const topbarOpacity = normalizeTopbarOpacity(data?.settings?.topbarOpacity)
  const topbarBlur = normalizeTopbarBlur(data?.settings?.topbarBlur)
  const composerOpacity = normalizeComposerOpacity(data?.settings?.composerOpacity)
  const composerBlur = normalizeComposerBlur(data?.settings?.composerBlur)
  const composerWidthPercent = normalizeComposerWidthPercent(data?.settings?.composerWidthPercent)
  const composerMinRows = normalizeComposerMinRows(data?.settings?.composerMinRows)
  const composerRadius = normalizeComposerRadius(data?.settings?.composerRadius)
  const composerModelShowProvider = normalizeComposerModelShowProvider(data?.settings?.composerModelShowProvider)
  // 按钮布局按字段引用 + 设置版本双保险失效：设置对象可能被原地改写，引用未必变化。
  const composerToolsLayoutSource = (data?.settings as any)?.composerToolsLayout
  const composerToolsLayout = React.useMemo(
    () => normalizeComposerToolsLayout(composerToolsLayoutSource),
    [composerToolsLayoutSource, settingsVersion],
  )
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
  const wallpaper = React.useMemo(
    () => normalizeWallpaperSettings(data?.settings?.wallpaper),
    [appDataVersion, settingsVersion, data?.settings?.wallpaper],
  )
  const activeWallpaper = React.useMemo(
    () => (wallpaper.enabled ? wallpaper.presets.find((preset) => preset.id === wallpaper.activeId) || null : null),
    [wallpaper],
  )
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
  // 当前 target 的会话列表元数据（标题 / 排序 / 运行指示）：
  // 顶栏相邻会话与侧栏都由它驱动，标题生成后必须在这里失效。
  const activeChatListScope = React.useMemo(
    () => (activeChatTargetId ? refreshScopes.chatList(activeTargetKind, activeChatTargetId) : ''),
    [activeTargetKind, activeChatTargetId],
  )
  const activeChatListVersion = useScopedUiVersion(controller, activeChatListScope, !!activeChatListScope)
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

  const navigationVersion = useScopedUiVersion(controller, refreshScopes.navigation())
  const activeSessionScope = React.useMemo(
    () => (activeChatId && activeChatTargetId
      ? refreshScopes.session(activeTargetKind, activeChatTargetId, activeChatId)
      : ''),
    [activeTargetKind, activeChatTargetId, activeChatId],
  )
  const activeSessionVersion = useScopedUiVersion(controller, activeSessionScope, !!activeSessionScope)

  // 正文加载失败的唯一事实源是 controller 的 chatLoadFailures（由加载路径写入）。
  // 失败按会话分格存放，这里只取「当前目标会话」那一格：
  // 并发加载时别的会话失败，绝不会把提示挂到当前目标上。
  // 这里只做「事实 → 状态机」的单向转发：失败必须进入 FAILED 终态，
  // 否则目标会话永远等不到正文，界面就停在「正在打开…」。
  const chatLoadFailure = selectChatLoadFailure(
    (s as any)?.chatLoadFailures,
    activeTargetKind,
    activeChatTargetId,
    activeChatId,
  )
  const chatLoadErrorReason = String(chatLoadFailure?.reason || '').trim()
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
  const chatSettingsSavingStatuses = React.useMemo(() => {
    if (!chatSettingsSavingByTarget || typeof chatSettingsSavingByTarget !== 'object') return []
    return Object.values(chatSettingsSavingByTarget).filter((item: any) => (
      chatSettingsTargetKey({ kind: String(item?.kind || '') as any, targetId: String(item?.targetId || ''), sessionId: String(item?.sessionId || '') }) === activeChatSettingsTargetKey
    )) as any[]
    // 队列状态在对象内部增删，引用不变；当前 session 版本负责失效。
  }, [appDataVersion, activeSessionVersion, chatSettingsSavingByTarget, activeChatSettingsTargetKey])
  const chatSettingsSavingFor = React.useCallback(
    (action: string) => chatSettingsSavingStatuses.find((item: any) => String(item?.action || '') === action) || null,
    [chatSettingsSavingStatuses],
  )
  const chatSettingsModelSaving = !!chatSettingsSavingFor('model')
  const chatSettingsReasoningSaving = !!chatSettingsSavingFor('reasoning')
  const chatSettingsStreamSaving = !!chatSettingsSavingFor('stream')
  const chatSettingsHookSaving = !!chatSettingsSavingFor('hook')
  const openingChatMeta = React.useMemo(() => {
    if (activeChat || !data) return null
    const targetId = String(activeChatTargetId || '').trim()
    if (!targetId) return null
    const box = activeChatSelectionBox
    const openingChatId = String(activeChatId || box?.activeChatId || '').trim()
    if (!openingChatId) return null
    const metas = Array.isArray(box?.chatMetas) ? box.chatMetas : []
    return metas.find((m: any) => String(m?.id || '') === openingChatId) || null
    // chatMetas 会就地更新，引用不保证变化；chatList 版本负责失效。
  }, [appDataVersion, activeChatListVersion, activeChat, data, activeChatTargetId, activeChatId, activeChatSelectionBox])
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
  // 视图位置：只记“现在显示到哪个节点”。它由动作直接写入，不参与任何模式判断。
  const [selection, setSelection] = React.useState<ViewSelection>(() => EMPTY_SELECTION)
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
    controller,
  })

  const formatModelRefText = React.useCallback(
    (modelRef: any) => {
      return formatModelRefDisplayText(modelRef, providers, modelGroups)
    },
    [providers, modelGroups],
  )

  // 收藏夹独立模态：顶栏星星按钮打开，原来的「聊天记录」浮层已下线。
  const [favoritesOpen, setFavoritesOpen] = React.useState(false)

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
    openFavoritedChat,
    onFavoriteChatContextMenu,
    buildFavoriteFolderLevel,
  } = useFavoriteFolders({
    controller,
    data,
    roles,
    groups,
    workspaces,
    clearChatSessionRunNotice,
    requestSwitch: chatSwitch.requestSwitch,
    closeFavoritesDialog: () => setFavoritesOpen(false),
    chatSessionRunIndicatorKind,
    activeTargetKind,
    activeChatTargetId,
    activeChatId,
  })

  const favoriteFolderNav = useFavoriteFolderNavigation({ folders: favoriteFolders })

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

  // 界面布局：聊天页有两个侧边栏身份 A / B，各自一份宽度，侧别由布局不变量保证互斥。
  // 设置页仍用顶栏返回条。
  const sidebarLayout = resolveSidebarLayout(data?.settings)
  const sidebarVisible = page === 'chat'
  const sidebarResizeA = useSidebarResize({
    side: sidebarLayout.a.side,
    onCommit: (w) => controller.actions.setSidebarWidth?.('a', w),
  })
  const sidebarResizeB = useSidebarResize({
    side: sidebarLayout.b.side,
    onCommit: (w) => controller.actions.setSidebarWidth?.('b', w),
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
    memoryVersion: sidebarMemoryVersion,
    deskTab: deskSidebarTab,
    selectRole: onSelectRoleInSidebar,
    selectWorkspace: onSelectWorkspaceInSidebar,
    selectWorkspaceRole: onSelectWorkspaceRoleInSidebar,
    selectSession: onSelectSidebarSession,
    changeTab: onChangeSidebarTab,
    changeDeskTab: onChangeDeskTab,
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

  const standaloneWindowControls = React.useMemo(
    () => (windowControls?.standalone ? <StandaloneWindowControls actions={windowControls.actions} /> : null),
    [windowControls?.standalone, windowControls?.actions],
  )

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
  } = useChatMessageIndex({
    s,
    renderChat,
    renderChatId,
    activeChatId,
    activeChat,
    activeTargetKind,
    activeChatTargetId,
  })

  // 位置解析只决定“这一帧显示什么”，绝不写回位置：位置只由动作写入。
  // 否则任何一帧陈旧的会话快照都会把位置永久改坏，看起来就是“闪一下又回原地”。
  const effectiveSelection = React.useMemo(
    () => resolveSelection(renderChat, selection),
    [selection, renderChat, renderChatId, chatAllMessagesRaw.length, Number((renderChat as any)?.updatedAt || 0)],
  )
  const viewFocusMid = effectiveSelection.mid

  // 开分叉草稿是一次外部动作：位置直接落到它的分叉点，
  // 这样“显示的那个节点”和“发送的起点”永远是同一个。
  React.useEffect(() => {
    const forkFromMid = String((branchDraft as any)?.forkFromMid || '').trim()
    if (!forkFromMid) return
    setSelection(placeSelection(renderChat, forkFromMid))
  }, [branchDraftKey])

  // 动作一：我发起的那次运行被受理后，位置移到这次运行的节点。
  // 只搬一次：同一次运行不重复搬；节点还没进正文就等下一帧再试。
  const followRunId = String((s as any)?.followRun || '')
  const placedRunRef = React.useRef('')
  React.useEffect(() => {
    if (!followRunId || placedRunRef.current === followRunId) return
    const card = activeSessionRunCards.find((item: any) => String(item?.runId || '') === followRunId)
    if (!card) return
    // 跟到这次运行真正生成的那条：产出节点（必须长在本次输入之下，函数里已守）。
    // 产出推进就跟着推进；这次运行结束后卡片消失，自然停住。
    const node = resolveRunFocusMid(renderChat, {
      anchorMid: String(card?.inputMessageId || ''),
      outputMid: String(card?.lastMessageId || ''),
    })
    if (!node || !chatAllById.has(node)) return
    const placedKey = `${followRunId}:${node}`
    if (placedRunRef.current === placedKey) return
    placedRunRef.current = placedKey
    setSelection(followFrom(node))
  }, [followRunId, activeSessionRunCardsKey, chatAllMessagesRaw.length, renderChat])

  // 只有「我正看着的那条会消失」才退回上一级并停住：
  //   删单条 → 删的必须正好是当前显示的那条；
  //   删整棵 → 当前显示的那条必须在这棵里面。
  // 删别处一律不动：选中的那条没消失，就没有理由改视线。
  const onNodeRemoving = useEvent((midRaw: string, scope: 'single' | 'subtree') => {
    const target = String(midRaw || '').trim()
    if (!target) return
    const focused = String(effectiveSelection.mid || '').trim()
    if (!focused) return

    let affected = scope === 'single' && focused === target
    if (scope === 'subtree') {
      let cursor = focused
      let guard = 0
      while (cursor && guard++ < 6000) {
        if (cursor === target) {
          affected = true
          break
        }
        cursor = String(chatAllById.get(cursor)?.parentMid || '')
      }
    }
    if (!affected) return

    const parentMid = String(chatAllById.get(target)?.parentMid || '')
    if (parentMid) setSelection(placeSelection(renderChat, parentMid))
  })

  // 切入会话：会话真的换了、而且位置不属于这份会话时，才落点。
  // 同一会话刷新让 id 抖一下不落点——落点会把刚发出去、刚落到新消息上的位置盖回旧末尾。
  const lastChatIdRef = React.useRef('')
  React.useEffect(() => {
    const id = String(renderChatId || '')
    if (!id || lastChatIdRef.current === id) return
    lastChatIdRef.current = id
    setSelection((prev) => (chatAllById.has(String(prev.mid || '')) ? prev : selectionAtLatest(renderChat)))
  }, [renderChatId, chatAllById, renderChat])

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
    // 点节点就是一次动作：把位置放到被点的节点上，别处不做判断。
    setViewIntentFromNodeClick: (mid: string) => setSelection(placeSelection(renderChat, mid)),
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
    followRunId,
    activeChat,
    activeTargetKind,
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
    if (!tr || !target) return EMPTY_TREE_HIGHLIGHT_EDGE_KEYS
    const byId = tr?.byId
    if (!byId || typeof byId.get !== 'function') return EMPTY_TREE_HIGHLIGHT_EDGE_KEYS

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
  const chatOverrideRef = React.useMemo(
    () => normalizeModelRef(chatOverride),
    // 归一化结果的语义只由 override 本身决定；session 版本负责穿透就地更新。
    [activeSessionVersion, chatOverride],
  )
  const hasChatOverride = !!chatOverrideRef
  const overrideProviderId = String(chatOverrideRef?.providerId || '').trim()
  const overrideModelId = String(chatOverrideRef?.modelId || '').trim()

  const roleModelRef = React.useMemo(
    () => roleDefaultModelRef(activeRole),
    // 角色默认模型随角色读写就地更新，实体域版本是失效依据。
    [domainVersion, activeRole],
  )
  const roleProviderId = String(roleModelRef?.providerId || '').trim()
  const roleModelId = String(roleModelRef?.modelId || '').trim()

  const effectiveProviderId = hasChatOverride ? overrideProviderId : roleProviderId
  const effectiveModelId = hasChatOverride ? overrideModelId : roleModelId
  const effectiveModelRef = hasChatOverride ? chatOverrideRef : roleModelRef
  const reasoningProfile = React.useMemo(() => {
    if (activeTargetKind === 'group') return { supportsReasoning: false, defaultReasoningEffort: '' as const }
    return modelReasoningProfileFromModelRef(effectiveModelRef, providers, modelGroups)
    // providers / modelGroups 会就地更新，实体域版本负责失效。
  }, [domainVersion, activeTargetKind, effectiveModelRef, providers, modelGroups])
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
  const chatNav = React.useMemo(() => resolveActiveChatNav({
    loading: !!s.loading,
    kind: activeTargetKind,
    groupId: activeGroupId,
    workspaceId: activeWorkspaceId,
    roleId: activeRoleId,
    data,
    state: s,
    activeChat,
    // 会话列表可能就地排序 / 增删，引用不保证变化；chatList / navigation 版本共同失效。
  }), [appDataVersion, navigationVersion, activeChatListVersion, activeSessionVersion, s, data, activeTargetKind, activeGroupId, activeWorkspaceId, activeRoleId, activeChat])

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
    displayedMid: effectiveSelection.mid,
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
    onBranchSiblingSelected: (mid: string) => setSelection(followFrom(mid)),
    setBranchNav,
    stickToBottomRef,
    autoScrollBlockUntilRef,
    treeSuppressClickRef,
  })

  // 顶栏按钮配置：侧边栏负责角色 / 工作区导航，顶栏只保留会话操作与全局入口。
  const canCreateChat = activeTargetKind === 'workspace' ? !!(activeWorkspace && activeRole) : !!activeRole
  const runningSessions = React.useMemo(
    () => collectRunningSessions({ state: s, data, includeGroups: GROUP_ENTRY_VISIBLE }),
    // 运行卡与会话标题都在 state/data 内就地更新；
    // appData 兜底整包数据，runCardsVersion 保证只发 runCards 时列表也不陈旧，
    // activeChatListVersion 让当前 target 的标题 / 排序变化穿透这份派生。
    [appDataVersion, runCardsVersion, activeChatListVersion, s, data],
  )
  const activeRunningSessionKey = runningSessionKey(activeTargetKind, activeChatTargetId, activeChatId)

  // 工作桌面条目看运行态：从同一份运行会话清单折出会话标识集合，不另建来源。
  const runningDeskChatIds = React.useMemo(
    () => new Set(runningSessions.map((it) => String(it.sessionId || '')).filter(Boolean)),
    [runningSessions],
  )

  // 稳定 handler：所有内联箭头只在这里创建一次，Surface 的 memo 才能真正生效。
  const onOpenRunningSessions = useEvent(() => setRunningSessionsOpen(true))
  const onCloseRunningSessions = useEvent(() => setRunningSessionsOpen(false))
  // 新建会话：按住 Ctrl / Cmd 时，同时在桌面挂一条内存临时条目（后端还不知道这条会话）。
  const onCreateChat = useEvent(async (event?: React.MouseEvent) => {
    const created = await controller.actions.createChat?.()
    if (!event?.ctrlKey && !event?.metaKey) return
    if (!created?.pendingChatId) return
    addDeskDraft({
      pendingChatId: created.pendingChatId,
      targetKind: created.targetKind,
      targetId: created.targetId,
      roleId: created.roleId,
      title: created.title,
    })
  })
  const onToggleTree = useEvent(() => setTreeOpen((v) => !v))
  const onOpenProviders = useEvent(() => controller.actions.openProviders?.())

  const sidebarMovePosition = React.useCallback(
    (items: any[], activeId: string, overId: string) =>
      resolveSortMovePosition(items.map((item: any) => String(item?.id || '')), activeId, overId) || 'before',
    [],
  )
  const onMoveRole = useEvent((activeId: string, overId: string) => {
    controller.actions.moveRole?.(activeId, overId, sidebarMovePosition(roles, activeId, overId))
  })
  const onMoveWorkspace = useEvent((activeId: string, overId: string) => {
    controller.actions.moveWorkspace?.(activeId, overId, sidebarMovePosition(workspaces, activeId, overId))
  })

  const navControlsProps = React.useMemo(() => ({
    canCreateChat,
    treeOpen,
    chatNav,
    onOpenFavorites: () => setFavoritesOpen(true),
    onOpenRunningSessions,
    onCreateChat,
    onToggleTree,
    onOpenProviders,
    onOpenSettings: openPluginSettings,
    onSwitchChat: switchSession,
  }), [
    canCreateChat,
    treeOpen,
    chatNav,
    onOpenRunningSessions,
    onCreateChat,
    onToggleTree,
    onOpenProviders,
    openPluginSettings,
    switchSession,
  ])

  // Ctrl / Cmd 点侧边栏会话：直接放进工作桌面。工作区目标的标识是「工作区|角色」合成串，
  // 这里拆回工作区与角色两段，动作层的引用键才拼得对。
  const addChatToDeskFromSidebar = React.useCallback(
    (targetKind: 'role' | 'workspace', targetId: string, chatId: string) => {
      if (targetKind === 'workspace') {
        const target = parseWorkspaceRoleTargetId(targetId)
        if (!target.workspaceId || !target.roleId) return
        controller.actions.addChatToDesk?.('workspace', target.workspaceId, target.roleId, chatId)
        return
      }
      controller.actions.addChatToDesk?.('role', targetId, '', chatId)
    },
    [controller],
  )

  const sidebarProps = React.useMemo(() => ({
    controller,
    navigationVersion: sidebarMemoryVersion,
    view: sidebarNavigation.view,
    onToggleView: sidebarNavigation.toggleView,
    width: sidebarLayout.a.width,
    tabsVariant: sidebarLayout.a.tabsVariant,
    sidebarRef: sidebarResizeA.sidebarRef,
    resizing: sidebarResizeA.resizing,
    onSplitterPointerDown: sidebarResizeA.onSplitterPointerDown,
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
    onMoveRole,
    onMoveWorkspace,
    onSelectSession: onSelectSidebarSession,
    onAddSessionToDesk: addChatToDeskFromSidebar,
    onChatContextMenu,
    onTabChange: onChangeSidebarTab,
  }), [
    controller,
    sidebarMemoryVersion,
    sidebarNavigation.view,
    sidebarNavigation.toggleView,
    sidebarLayout.a.width,
    sidebarLayout.a.tabsVariant,
    sidebarResizeA.sidebarRef,
    sidebarResizeA.resizing,
    sidebarResizeA.onSplitterPointerDown,
    topbarOpacity,
    topbarBlur,
    roles,
    activeWorkspaceRoles,
    workspaces,
    activeRole,
    activeWorkspaceId,
    activeTargetKind,
    chatSwitch.selectedChatId,
    data,
    pendingRoleChat,
    pendingWorkspaceChat,
    formatModelRefText,
    openPluginSettings,
    chatSessionRunIndicatorKind,
    onSelectRoleInSidebar,
    onSelectWorkspaceInSidebar,
    onSelectWorkspaceRoleInSidebar,
    onMoveRole,
    onMoveWorkspace,
    onSelectSidebarSession,
    addChatToDeskFromSidebar,
    onChatContextMenu,
    onChangeSidebarTab,
    settingsVersion,
    domainVersion,
  ])

  // 侧边栏 B 是工作桌面：数据在后端 sessions/desks.json。
  // 条目装配与订阅都在面板内部完成（面板自己订阅 entities:desks），根组件不手写实体订阅。
  const deskHoverShowsRoleIcon = normalizeDeskHoverRoleIcon(
    (data?.settings as any)?.[DESK_HOVER_ROLE_ICON_SETTING_KEY],
  )
  // 收藏夹的悬停图标开关与桌面那份各存一份，默认都开。
  const favoriteHoverShowsRoleIcon = normalizeFavoriteHoverRoleIcon(
    (data?.settings as any)?.[FAVORITE_HOVER_ROLE_ICON_SETTING_KEY],
  )

  const openDeskEntry = React.useCallback(
    (entry: DeskEntry) => {
      const targetKey =
        entry.targetKind === 'workspace' ? workspaceRoleTargetId(entry.targetId, entry.roleId) : entry.targetId
      clearChatSessionRunNotice(entry.targetKind, targetKey, entry.chatId)
      if (entry.targetKind === 'group') controller.actions.setActiveGroup?.(entry.targetId)
      else if (entry.targetKind === 'workspace') {
        controller.actions.setActiveWorkspace?.(entry.targetId)
        controller.actions.setWorkspaceRole?.(entry.roleId)
      } else controller.actions.setActiveRole?.(entry.targetId)
      chatSwitch.requestSwitch(entry.chatId, { force: true })
    },
    [chatSwitch, clearChatSessionRunNotice, controller],
  )

  const removeDeskEntry = React.useCallback(
    (entry: DeskEntry) => {
      controller.actions.removeChatFromDesk?.(entry.targetKind, entry.targetId, entry.roleId, entry.chatId)
    },
    [controller],
  )

  // 桌面内拖动：按引用键换位，顺序写回同一份清单。
  const moveDeskEntry = React.useCallback(
    (activeKey: string, overKey: string) => {
      controller.actions.moveDeskChat?.(activeKey, overKey)
    },
    [controller],
  )

  // 桌面条目的右键与会话列表同一个菜单：把引用折成菜单认的目标标识再交给它。
  const onDeskEntryContextMenu = React.useCallback(
    (event: React.MouseEvent, entry: DeskEntry) => {
      const targetId =
        entry.targetKind === 'workspace' ? workspaceRoleTargetId(entry.targetId, entry.roleId) : entry.targetId
      onChatContextMenu(event, entry.targetKind, targetId, entry.chatId, entry.title)
    },
    [onChatContextMenu],
  )

  // 收藏夹内容主体：弹窗与侧边栏 B 用的是同一份 props，外壳各自决定。
  const favoriteFoldersPanel = React.useMemo(() => ({
    favoriteFolders,
    renderFavoriteFolderTree,
    collapseAllFavoriteFolders,
    openCreateFavoriteFolder,
    favoriteSearchOpen,
    setFavoriteSearchOpen,
    favoriteSearchText,
    setFavoriteSearchText,
    favoriteSearchInputRef,
  }), [
    favoriteFolders,
    renderFavoriteFolderTree,
    collapseAllFavoriteFolders,
    openCreateFavoriteFolder,
    favoriteSearchOpen,
    setFavoriteSearchOpen,
    favoriteSearchText,
    setFavoriteSearchText,
    favoriteSearchInputRef,
  ])

  // 层级浏览这一层的投影：当前文件夹的直接子级（子文件夹 + 会话条目）。
  // 预取写完会话索引后要有一枚滴答，让层级投影重算：
  // 索引是就地写进 box 的，memo 的其它依赖引用都没变。
  const [favoriteChatsTick, setFavoriteChatsTick] = React.useState(0)
  const favoriteLevel = React.useMemo(
    () => buildFavoriteFolderLevel(favoriteFolderNav.currentFolderId),
    [buildFavoriteFolderLevel, favoriteFolderNav.currentFolderId, favoriteChatsTick],
  )

  // 收藏夹跨 target 展示：进某一层时，按该层引用涉及的 target 预取会话索引，
  // 让条目直接带真实标题，而不是一排「待加载」。按需触发、去重、串行、失败静默。
  const prefetchedFavoriteTargetsRef = React.useRef(new Set<string>())
  React.useEffect(() => {
    const targets: Array<{ kind: 'role' | 'group' | 'workspace'; targetId: string }> = []
    const seen = new Set<string>()
    for (const ref of favoriteLevel.refs) {
      if (ref.status !== 'pending') continue
      const targetId = ref.targetKind === 'workspace' ? workspaceRoleTargetId(ref.targetId, ref.roleId) : ref.targetId
      const key = `${ref.targetKind}:${targetId}`
      if (!targetId || seen.has(key) || prefetchedFavoriteTargetsRef.current.has(key)) continue
      seen.add(key)
      targets.push({ kind: ref.targetKind, targetId })
    }
    if (!targets.length) return
    for (const key of seen) prefetchedFavoriteTargetsRef.current.add(key)
    void (async () => {
      for (const target of targets) {
        try {
          const ok = await controller.actions.ensureTargetChatIndex?.(target.kind, target.targetId)
          if (ok) setFavoriteChatsTick((value) => value + 1)
        } catch {
          // 预取失败不影响收藏夹展示，保持待加载占位即可。
        }
      }
    })()
  }, [favoriteLevel, controller])

  const onCreateFavoriteFolderHere = useEvent(() => {
    openCreateFavoriteFolder(favoriteFolderNav.currentFolderId)
  })
  const onOpenFavoriteRef = useEvent((entry: FavoriteFolderLevelEntry) => {
    openFavoritedChat(entry.targetKind, entry.targetId, entry.roleId, entry.chatId)
  })
  const onOpenFavoriteRefMenu = useEvent((event: React.MouseEvent, entry: FavoriteFolderLevelEntry) => {
    onFavoriteChatContextMenu(
      event,
      favoriteFolderNav.currentFolderId,
      entry.targetKind,
      entry.targetId,
      entry.roleId,
      entry.chatId,
      entry.title,
    )
  })
  const onReorderFavoriteFolders = useEvent((orderedFolderIds: string[]) => {
    controller.actions.reorderFavoriteFolders?.(favoriteFolderNav.currentFolderId, orderedFolderIds)
  })
  const onReorderFavoriteRefs = useEvent((orderedRefKeys: string[]) => {
    controller.actions.reorderFavoriteChatRefs?.(favoriteFolderNav.currentFolderId, orderedRefKeys)
  })
  const onMoveFavoriteRef = useEvent((refKey: string, targetFolderId: string) => {
    controller.actions.moveFavoriteChatRef?.(refKey, targetFolderId)
  })
  const onRemoveFavoriteRef = useEvent((refKey: string) => {
    controller.actions.removeFavoriteChatRef?.(favoriteFolderNav.currentFolderId, refKey)
  })

  const sidebarBFavorites = React.useMemo(() => ({
    level: favoriteLevel,
    canGoBack: favoriteFolderNav.canGoBack,
    onBack: favoriteFolderNav.back,
    onNavigate: favoriteFolderNav.navigate,
    onCreateFolder: onCreateFavoriteFolderHere,
    onOpenRef: onOpenFavoriteRef,
    onRefContextMenu: onOpenFavoriteRefMenu,
    onReorderFolders: onReorderFavoriteFolders,
    onReorderRefs: onReorderFavoriteRefs,
    onMoveRef: onMoveFavoriteRef,
    onRemoveRef: onRemoveFavoriteRef,
    hoverShowsRoleIcon: favoriteHoverShowsRoleIcon,
  }), [
    favoriteLevel,
    favoriteFolderNav.canGoBack,
    favoriteFolderNav.back,
    favoriteFolderNav.navigate,
    onCreateFavoriteFolderHere,
    onOpenFavoriteRef,
    onOpenFavoriteRefMenu,
    onReorderFavoriteFolders,
    onReorderFavoriteRefs,
    onMoveFavoriteRef,
    onRemoveFavoriteRef,
    favoriteHoverShowsRoleIcon,
  ])

  const sidebarBProps = React.useMemo(
    () => ({
      width: sidebarLayout.b.width,
      tabsVariant: sidebarLayout.b.tabsVariant,
      sidebarRef: sidebarResizeB.sidebarRef,
      resizing: sidebarResizeB.resizing,
      onSplitterPointerDown: sidebarResizeB.onSplitterPointerDown,
      topbarOpacity,
      topbarBlur,
      tab: deskSidebarTab,
      onTabChange: onChangeDeskTab,
      favoritesBrowser: sidebarBFavorites,
      controller,
      data,
      activeChatId: chatSwitch.selectedChatId,
      runningChatIds: runningDeskChatIds,
      hoverShowsRoleIcon: deskHoverShowsRoleIcon,
      onOpenDeskEntry: openDeskEntry,
      onRemoveDeskEntry: removeDeskEntry,
      onMoveDeskEntry: moveDeskEntry,
      onDeskEntryContextMenu,
    }),
    [
      sidebarLayout.b.width,
      sidebarLayout.b.tabsVariant,
      sidebarResizeB.sidebarRef,
      sidebarResizeB.resizing,
      sidebarResizeB.onSplitterPointerDown,
      topbarOpacity,
      topbarBlur,
      deskSidebarTab,
      onChangeDeskTab,
      sidebarBFavorites,
      controller,
      data,
      chatSwitch.selectedChatId,
      runningDeskChatIds,
      deskHoverShowsRoleIcon,
      openDeskEntry,
      removeDeskEntry,
      moveDeskEntry,
      onDeskEntryContextMenu,
    ],
  )

  const composerProps = React.useMemo(() => ({
    controller,
    loading: !!s.loading,
    composerRef,
    onClickOpenImageViewer,
    treeOpen,
    effectiveTreeView,
    treePanelW,
    composerOpacity,
    composerBlur,
    composerWidthPercent,
    composerMinRows,
    composerRadius,
    composerModelShowProvider,
    composerToolsLayout,
    activeSessionComposerDraftKey: String((s as any).activeSessionComposerDraftKey || ''),
    composerInputRef,
    activeTargetKind,
    activeChatTargetId: String(activeChatTargetId || ''),
    activeChatId: String(activeChatId || ''),
    activeRole,
    activeGroup,
    roles,
    workspaces,
    activeStopRunId,
    formatModelRefText,
    openImagePicker,
    hookPrompts,
    activeHookPromptMode: activeHookPromptMode as any,
    activeHookPromptPresetId,
    roleDefaultHookPromptPresetId,
    hookPromptSelectorDisabled,
    chatSettingsHookSaving,
    hookPromptSelectorDisabledReason,
    roleSessionControlsEnabled,
    hasChatOverride,
    effectiveModelId,
    effectiveModelRef,
    openTempModelPicker,
    roleModelStepPrevEnabled,
    roleModelStepNextEnabled,
    stepRoleModelCandidate,
    providers,
    modelGroups,
    reasoningProfile,
    activeReasoningLabel,
    chatSettingsReasoningSaving,
    openReasoningPicker,
    hasChatReasoningOverride,
    activeContextTokenUsageText,
    activeContextTokenUsageShortText,
    activeCacheRateText,
    activeAsyncToolTaskRunningCount,
    openAsyncToolTasks,
    activeStreamOn,
    chatSettingsStreamSaving,
    activeChat,
    onSend,
    onStop,
    onPaste,
  }), [
    controller,
    s.loading,
    (s as any).activeSessionComposerDraftKey,
    composerRef,
    onClickOpenImageViewer,
    treeOpen,
    effectiveTreeView,
    treePanelW,
    composerOpacity,
    composerBlur,
    composerWidthPercent,
    composerMinRows,
    composerRadius,
    composerModelShowProvider,
    composerToolsLayout,
    composerInputRef,
    activeTargetKind,
    activeChatTargetId,
    activeChatId,
    activeRole,
    activeGroup,
    roles,
    workspaces,
    activeStopRunId,
    formatModelRefText,
    openImagePicker,
    hookPrompts,
    activeHookPromptMode,
    activeHookPromptPresetId,
    roleDefaultHookPromptPresetId,
    hookPromptSelectorDisabled,
    chatSettingsHookSaving,
    hookPromptSelectorDisabledReason,
    roleSessionControlsEnabled,
    hasChatOverride,
    effectiveModelId,
    effectiveModelRef,
    openTempModelPicker,
    roleModelStepPrevEnabled,
    roleModelStepNextEnabled,
    stepRoleModelCandidate,
    providers,
    modelGroups,
    reasoningProfile,
    activeReasoningLabel,
    chatSettingsReasoningSaving,
    openReasoningPicker,
    hasChatReasoningOverride,
    activeContextTokenUsageText,
    activeContextTokenUsageShortText,
    activeCacheRateText,
    activeAsyncToolTaskRunningCount,
    openAsyncToolTasks,
    activeStreamOn,
    chatSettingsStreamSaving,
    activeChat,
    onSend,
    onStop,
    onPaste,
    settingsVersion,
    domainVersion,
  ])

  const messageListProps = React.useMemo(() => ({
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
  }), [
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
    s.loading,
    uiBusy,
    userMessageCollapseEnabled,
    userMessageCollapseLines,
    reasoningDisplayMode,
    reasoningRenderEnabled,
    stickersEnabled,
    stickerMap,
    renderSafetyPolicy,
    formatModelRefText,
    messageMutationBlocked,
    onMessageContextMenu,
    toggleExpandedToolMsg,
    toggleExpandedUserMsg,
    setEditingMsgText,
    cancelEditMessage,
    saveEditMessage,
    startEditMessage,
    copyMessageText,
    switchBranchSibling,
    openRegenConfirm,
    openDeleteMessageConfirm,
    settingsVersion,
    domainVersion,
  ])

  const scrollSx = React.useMemo(() => ({
    height: '100%',
    overflowX: 'hidden',
    overflowAnchor: 'none',
    pl: 2,
    pr: treeOpen && effectiveTreeView === 'right' ? `calc(16px + ${Math.round(treePanelW)}px)` : 2,
    pt: `calc(${TOPBAR_H}px + 16px)`,
    bgcolor: transparentChatBg ? 'transparent' : 'var(--studio-paper-muted)',
    paddingBottom: `calc(${Math.max(0, composerHeight)}px + 24px)`,
  }), [treeOpen, effectiveTreeView, treePanelW, transparentChatBg, composerHeight])

  const sessionPage = React.useMemo(
    () => (sessionPageKey ? (
      <SessionMessagePage
        sessionKey={sessionPageKey}
        messages={renderMessages}
        hasMessages={!!renderChat && Array.isArray(renderChat.messages) && renderChat.messages.length > 0}
        activeRunTailPendingMessage={activeRunTailPendingMessage}
        layoutSignature={messageLayoutSignature}
        messageOffscreenEnabled={messageOffscreenSkipEnabled}
        revealMessageRef={revealMessageRef}
        emptyContent={EMPTY_SESSION_CONTENT}
        messageListProps={messageListProps}
        scrollHostSx={SESSION_SCROLL_HOST_SX}
        scrollSx={scrollSx}
        onClick={onClickOpenImageViewer}
      />
    ) : null),
    [
      sessionPageKey,
      renderMessages,
      renderChat,
      activeRunTailPendingMessage,
      messageLayoutSignature,
      messageOffscreenSkipEnabled,
      revealMessageRef,
      messageListProps,
      scrollSx,
      onClickOpenImageViewer,
    ],
  )

  const emptyOverlay = React.useMemo(() => {
    if (sessionPageKey || sessionVisibleKey) return null
    return (
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
            EMPTY_SESSION_CONTENT
          )
        ) : (
          EMPTY_SESSION_CONTENT
        )}
      </Box>
    )
  }, [
    sessionPageKey,
    sessionVisibleKey,
    s.loading,
    activeTargetKind,
    activeGroup,
    activeWorkspace,
    activeWorkspaceRoles,
    activeRole,
    renderChat,
    chatSwitch.failed,
    chatSwitch.failedReason,
    chatSwitch.retryLoad,
    openingChatMeta,
    openPluginSettings,
    transparentChatBg,
    treeOpen,
    effectiveTreeView,
    treePanelW,
    composerHeight,
  ])

  const treeElement = React.useMemo(() => (
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
  ), [
    treeOpen,
    effectiveTreeView,
    treePanelW,
    treeResizing,
    transparentChatBg,
    bgAlpha,
    onTreeSplitterPointerDown,
    onTreeSplitterPointerMove,
    endTreeResize,
    setTreePan,
    setTreeScale,
    treeViewRef,
    scheduleTreeViewTransform,
    applyTreeViewTransform,
    treeDir,
    cycleTreeDir,
    treeDragging,
    onTreePointerDown,
    onTreePointerMove,
    endTreeDrag,
    onTreeWheel,
    treeHostRightRef,
    treeHostFloatRef,
    treeViewportRef,
    treeSuppressClickRef,
    treeRender,
    treeFocusMid,
    treeHighlightEdgeKeys,
    treePop,
    setTreePop,
    jumpToMessage,
    onTreeNodeContextMenu,
    closeTreeModal,
  ])

  const composerElement = React.useMemo(
    () => <ComposerSurface {...composerProps} />,
    [composerProps],
  )

  // 设置页内容只依赖稳定入口：数据由各设置面板宿主按自己的刷新地址自订阅。
  // 这里刻意不登记 roles / providers / groups 等实体，避免新增域时漏刷。
  const settingsContent = React.useMemo(() => (
    <PluginSettingsPage
      controller={controller}
      bootstrap={bootstrap}
      releaseViews={releaseViews}
      onReleaseRefresh={onReleaseRefresh}
      tab={settingsTab}
      onTabChange={setSettingsTab}
      dataDirectory={dataDirectory}
      eucliBoxConnection={eucliBoxConnection}
    />
  ), [
    controller,
    bootstrap,
    releaseViews,
    onReleaseRefresh,
    settingsTab,
    setSettingsTab,
    dataDirectory,
    eucliBoxConnection,
  ])

  const overlayImagePicker = React.useMemo(() => ({
    controller,
    loading: !!s.loading,
    activeRole,
    imagePickerEl,
    closeImagePicker,
    onPickDraftImages,
  }), [controller, s.loading, activeRole, imagePickerEl, closeImagePicker, onPickDraftImages])

  const overlayMessageMenus = React.useMemo(() => ({
    controller,
    loading: !!s.loading,
    uiBusy,
    msgMenu,
    closeMsgMenu,
    msgMenuIsToolResponse,
    msgMenuMid,
    msgMenuText,
    copyMessageText,
    toggleExpandedToolMsg,
    expandedToolMsgIds,
    msgMenuCanEdit,
    startEditMessage,
    messageMutationBlocked,
    msgMenuCanRegen,
    msgMenuRegenMid,
    msgMenuRegenRole,
    setRegen,
    regen,
    treeNodeMenu,
    closeTreeNodeMenu,
    confirmDelMsg,
    setConfirmDelMsg,
    confirmDelTree,
    setConfirmDelTree,
    onNodeRemoving,
  }), [
    controller,
    s.loading,
    uiBusy,
    msgMenu,
    closeMsgMenu,
    msgMenuIsToolResponse,
    msgMenuMid,
    msgMenuText,
    copyMessageText,
    toggleExpandedToolMsg,
    expandedToolMsgIds,
    msgMenuCanEdit,
    startEditMessage,
    messageMutationBlocked,
    msgMenuCanRegen,
    msgMenuRegenMid,
    msgMenuRegenRole,
    setRegen,
    regen,
    treeNodeMenu,
    closeTreeNodeMenu,
    confirmDelMsg,
    setConfirmDelMsg,
    confirmDelTree,
    setConfirmDelTree,
    onNodeRemoving,
  ])

  const overlayComposerControls = React.useMemo(() => ({
    controller,
    loading: !!s.loading,
    providers,
    modelGroups,
    roleSessionControlsEnabled,
    tempModelPickerEl,
    closeTempModelPicker,
    tempModelSource,
    onTempModelSourceChanged,
    tempModelProviderId,
    onTempProviderChanged,
    tempModelGroupId,
    onTempModelGroupChanged,
    tempModelPick,
    setTempModelPick,
    tempModelReady,
    roleModelCandidates,
    tempModelHighlightKey,
    onPickRoleModelCandidate,
    clearTempModelOverride,
    hasChatOverride,
    saveTempModelOverride,
    reasoningPickerEl,
    closeReasoningPicker,
    activeEffectiveReasoningEffort,
    activeChatReasoningEffort,
    pickReasoningEffort,
    clearReasoningEffort,
    hasChatReasoningOverride,
    asyncToolTasksEl,
    closeAsyncToolTasks,
    refreshAsyncToolTasks,
    asyncToolTasksLoading,
    asyncToolTasks,
  }), [
    controller,
    s.loading,
    providers,
    modelGroups,
    roleSessionControlsEnabled,
    tempModelPickerEl,
    closeTempModelPicker,
    tempModelSource,
    onTempModelSourceChanged,
    tempModelProviderId,
    onTempProviderChanged,
    tempModelGroupId,
    onTempModelGroupChanged,
    tempModelPick,
    setTempModelPick,
    tempModelReady,
    roleModelCandidates,
    tempModelHighlightKey,
    onPickRoleModelCandidate,
    clearTempModelOverride,
    hasChatOverride,
    saveTempModelOverride,
    reasoningPickerEl,
    closeReasoningPicker,
    activeEffectiveReasoningEffort,
    activeChatReasoningEffort,
    pickReasoningEffort,
    clearReasoningEffort,
    hasChatReasoningOverride,
    asyncToolTasksEl,
    closeAsyncToolTasks,
    refreshAsyncToolTasks,
    asyncToolTasksLoading,
    asyncToolTasks,
    domainVersion,
  ])

  const overlayRolePicker = React.useMemo(() => ({
    controller,
    rolePickerEl,
    closeRolePicker,
    rolePickerView,
    roles,
    workspaceRoles: activeWorkspaceRoles,
    workspaces,
    draftActiveRoleId: String(s.draft?.activeRoleId || ''),
    activeWorkspaceId,
    activeTargetKind,
    formatModelRefText,
    openPluginSettings,
  }), [
    controller,
    rolePickerEl,
    closeRolePicker,
    rolePickerView,
    roles,
    activeWorkspaceRoles,
    workspaces,
    s.draft?.activeRoleId,
    activeWorkspaceId,
    activeTargetKind,
    formatModelRefText,
    openPluginSettings,
    domainVersion,
  ])

  const overlayFavorites = React.useMemo(() => ({
    open: favoritesOpen,
    onClose: () => setFavoritesOpen(false),
    ...favoriteFoldersPanel,
  }), [favoritesOpen, favoriteFoldersPanel])

  const overlayContextMenus = React.useMemo(() => ({
    controller,
    loading: !!s.loading,
    favoriteFolderMenu,
    closeFavoriteFolderMenu,
    openCreateFavoriteFolder,
    setMoveFavoriteFolderDialog,
    openRenameFavoriteFolder,
    setConfirmClearFavoriteFolder,
    openDeleteFavoriteFolderConfirm,
    favoriteChatMenu,
    closeFavoriteChatMenu,
    openFavoriteDialog,
    setEditingChatTitle,
    isSendingThisChat,
    chatMenu,
    closeChatMenu,
    setConfirmDelChat,
  }), [
    controller,
    s.loading,
    favoriteFolderMenu,
    closeFavoriteFolderMenu,
    openCreateFavoriteFolder,
    setMoveFavoriteFolderDialog,
    openRenameFavoriteFolder,
    setConfirmClearFavoriteFolder,
    openDeleteFavoriteFolderConfirm,
    favoriteChatMenu,
    closeFavoriteChatMenu,
    openFavoriteDialog,
    setEditingChatTitle,
    isSendingThisChat,
    chatMenu,
    closeChatMenu,
    setConfirmDelChat,
  ])

  const overlayFavoriteDialogs = React.useMemo(() => ({
    loading: !!s.loading,
    favoriteFolders,
    createFavoriteFolder,
    setCreateFavoriteFolder,
    closeCreateFavoriteFolder,
    submitCreateFavoriteFolder,
    openCreateFavoriteFolder,
    renameFavoriteFolder,
    setRenameFavoriteFolder,
    closeRenameFavoriteFolder,
    submitRenameFavoriteFolder,
    confirmDeleteFavoriteFolder,
    closeDeleteFavoriteFolderConfirm,
    submitDeleteFavoriteFolder,
    moveFavoriteFolderContents,
    setMoveFavoriteFolderContents,
    closeMoveFavoriteFolderContents,
    submitMoveFavoriteFolderContents,
    confirmClearFavoriteFolder,
    closeConfirmClearFavoriteFolder,
    submitClearFavoriteFolder,
    moveFavoriteFolderDialog,
    setMoveFavoriteFolderDialog,
    closeMoveFavoriteFolderDialog,
    submitMoveFavoriteFolder,
    collectFavoriteFolderSubtreeIds,
    favoriteDialog,
    closeFavoriteDialog,
    saveFavoriteDialog,
    renderFavoriteFolderPicker,
    renderFavoriteFolderSinglePicker,
  }), [
    s.loading,
    favoriteFolders,
    createFavoriteFolder,
    setCreateFavoriteFolder,
    closeCreateFavoriteFolder,
    submitCreateFavoriteFolder,
    openCreateFavoriteFolder,
    renameFavoriteFolder,
    setRenameFavoriteFolder,
    closeRenameFavoriteFolder,
    submitRenameFavoriteFolder,
    confirmDeleteFavoriteFolder,
    closeDeleteFavoriteFolderConfirm,
    submitDeleteFavoriteFolder,
    moveFavoriteFolderContents,
    setMoveFavoriteFolderContents,
    closeMoveFavoriteFolderContents,
    submitMoveFavoriteFolderContents,
    confirmClearFavoriteFolder,
    closeConfirmClearFavoriteFolder,
    submitClearFavoriteFolder,
    moveFavoriteFolderDialog,
    setMoveFavoriteFolderDialog,
    closeMoveFavoriteFolderDialog,
    submitMoveFavoriteFolder,
    collectFavoriteFolderSubtreeIds,
    favoriteDialog,
    closeFavoriteDialog,
    saveFavoriteDialog,
    renderFavoriteFolderPicker,
    renderFavoriteFolderSinglePicker,
  ])

  const overlaySessionDialogs = React.useMemo(() => ({
    controller,
    loading: !!s.loading,
    editingChatTitle,
    setEditingChatTitle,
    closeEditingChatTitle,
    saveEditingChatTitle,
    confirmDelChat,
    setConfirmDelChat,
    isSendingThisChat,
  }), [
    controller,
    s.loading,
    editingChatTitle,
    setEditingChatTitle,
    closeEditingChatTitle,
    saveEditingChatTitle,
    confirmDelChat,
    setConfirmDelChat,
    isSendingThisChat,
  ])

  const overlayRunningSessions = React.useMemo(() => ({
    controller,
    open: runningSessionsOpen,
    entries: runningSessions,
    activeKey: activeRunningSessionKey,
    onClose: onCloseRunningSessions,
    onOpen: openRunningSession,
  }), [
    controller,
    runningSessionsOpen,
    runningSessions,
    activeRunningSessionKey,
    onCloseRunningSessions,
    openRunningSession,
  ])

  return (
    <ShellFrame
      theme={theme}
      colorThemeColors={colorThemeColors}
      transparentChatBg={transparentChatBg}
      bgAlpha={bgAlpha}
      chatBgBlur={chatBgBlur}
      chatFontSize={chatFontSize}
      chatFontFamily={chatFontFamily}
      chatLetterSpacing={chatLetterSpacing}
      chatLineHeight={chatLineHeight}
      activeWallpaper={activeWallpaper}
      activeWallpaperSrc={activeWallpaperSrc}
    >
      <TopBarSurface
        page={page}
        topbarOpacity={topbarOpacity}
        topbarBlur={topbarBlur}
        standaloneWindowControls={standaloneWindowControls}
        onTopbarPointerDown={onTopbarPointerDown}
        onCloseSettings={closePluginSettings}
        nav={navControlsProps}
      />

      <Box sx={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'row' }}>
        {sidebarVisible && sidebarLayout.a.side === 'left' ? (
          <SidebarSurface {...sidebarProps} side="left" />
        ) : null}
        {sidebarVisible && sidebarLayout.b.side === 'left' ? (
          <SidebarBPanel {...sidebarBProps} side="left" />
        ) : null}

        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
          <SessionViewport
            frozen={page !== 'chat'}
            visible={page === 'chat'}
            chatPaneRef={chatPaneRef}
            transparentChatBg={transparentChatBg}
            switching={chatSwitch.switching}
            activeKey={sessionPageKey}
            visibleKey={sessionVisibleKey}
            keys={sessionKeepAliveKeys}
            activeScrollRef={chatRootRef}
            onPainted={chatSwitch.notifyPainted}
            activePage={sessionPage}
            emptyOverlay={emptyOverlay}
            extras={treeElement}
            composer={composerElement}
          />

          {/* 全局弹层区：刻意放在页面冻结子树之外。
              弹层是 Portal 浮层、不属于页面内容；一旦被 Freeze 冻结，
              「关闭弹层 + 切页」同批次的更新会被 Freeze 复用旧元素而吞掉，
              弹层 open 会卡在 true、遮罩残留并拦截整页交互
              （典型症状：没有工作区时点「去创建工作区」跳设置页，浮窗不关）。 */}
          <OverlaySurface
            imagePicker={overlayImagePicker}
            messageMenus={overlayMessageMenus}
            composerControls={overlayComposerControls}
            rolePicker={overlayRolePicker}
            favorites={overlayFavorites}
            contextMenus={overlayContextMenus}
            favoriteDialogs={overlayFavoriteDialogs}
            sessionDialogs={overlaySessionDialogs}
            runningSessions={overlayRunningSessions}
          />

          <SettingsSurface
            mounted={settingsMounted}
            visible={page === 'settings'}
            content={settingsContent}
          />
        </Box>

        {sidebarVisible && sidebarLayout.a.side === 'right' ? (
          <SidebarSurface {...sidebarProps} side="right" />
        ) : null}
        {sidebarVisible && sidebarLayout.b.side === 'right' ? (
          <SidebarBPanel {...sidebarBProps} side="right" />
        ) : null}
      </Box>

      <SidebarResizeLine lineRef={sidebarResizeA.lineRef} active={sidebarResizeA.resizing} />
      <SidebarResizeLine lineRef={sidebarResizeB.lineRef} active={sidebarResizeB.resizing} />

      <ProvidersDialog open={s.modal === 'providers'} controller={controller} providers={providers} draft={s.draft} models={s.models} loading={!!s.loading} />
      <RoleDialog open={s.modal === 'role'} controller={controller} providers={providers} modelGroups={modelGroups} draft={s.draft} models={s.models} tools={(s as any).tools} hookPrompts={hookPrompts} placeholders={placeholders} systemPlugins={systemPlugins} />
      <GroupDialog open={s.modal === 'group'} controller={controller} roles={roles} draft={s.draft} />
      <WorkspaceDialog open={s.modal === 'workspace'} controller={controller} draft={s.draft} roles={roles} />
      <ToolWorkDirectoryPromptDialog controller={controller} state={(s as any).toolWorkDirectory} />
      <ConfirmDialog open={s.modal === 'confirm'} controller={controller} draft={s.draft} roles={roles} groups={groups} providers={providers} workspaces={workspaces} />
      <MermaidDialog open={s.modal === 'mermaid'} controller={controller} mermaid={s.mermaid} />
      <ImageDialog open={s.modal === 'image'} controller={controller} viewer={s.imageViewer} />
    </ShellFrame>
  )
}
