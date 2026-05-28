import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import AppsRoundedIcon from '@mui/icons-material/AppsRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import HorizontalRuleRoundedIcon from '@mui/icons-material/HorizontalRuleRounded'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import SplitscreenRoundedIcon from '@mui/icons-material/SplitscreenRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import WindowRoundedIcon from '@mui/icons-material/WindowRounded'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Dialog,
  Checkbox,
  DialogContent,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  TextField,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  alpha,
} from '@mui/material'
import type { SelectChangeEvent } from '@mui/material/Select'
import { createDirectClient } from './backendClient'
import { ALL_VIEW_CATEGORY_ID, categoryDefinition, orderedViewCategoryDefinitions, viewCategoryDefinition, type CategoryDefinition, type ViewCategoryDefinition } from './categoryRegistry'
import { clipboardImageDataUrlFromClipboard, clipboardImageDataUrlFromPasteEvent } from './clipboardImage'
import { ContainerOverlay } from './ContainerOverlay'
import type { ContainerItemDragEvent } from './ContainerOverlay'
import { ContainerDialog, IconAppearancePanel } from './DesktopDialogs'
import { CollectionContextMenu } from './CollectionContextMenu'
import { DesktopDragHint } from './DesktopDragHint'
import { DesktopWallpaper } from './DesktopWallpaper'
import { DesktopWallpaperSettings } from './DesktopWallpaperSettings'
import { iconAppearanceCandidateFromWebIcon, importedIconCandidateId, systemIconCandidateIdForTarget, upsertIconCandidate, upsertIconCandidates } from './iconAppearanceModel'
import { ScrollArea } from './shared/scroll-area'
import { SortHandleButton, SortModeButton } from './sortable/SortControls'
import { SortableItem, SortableRoot, SortableSection, moveSortableId } from './sortable/SortableDnd'
import { resolveContainerDropSurface } from './containerDropResolution'
import type { ContainerExtractDragState } from './containerExtractDragState'
import { applyContainerItemDesktopExtractionView, extractedItemIdForContainerView, isContainerSoftClosedForExtractDrag, resolveContainerExtractDragMode, resolveContainerExtractNextDragMode } from './containerExtractDragState'
import type { DesktopDragState } from './desktopDragState'
import { wallpaperDeckFromWorkspace, wallpaperDeckWithWorkspace } from './desktopWallpaperDeck'
import { createDesktopWallpaperPreset, upsertDesktopWallpaperPresetView } from './desktopWallpaperPresets'
import { isContainerDropTargetActive, resolveDesktopDragMode, resolveDesktopDropIntent } from './desktopDragState'
import type { ContainerGridApi, ContainerGridPlacement } from './folder-grid/ContainerGridCanvas'
import { buildAllDesktopGridEntries, buildDesktopGridEntries, filterDesktopGridEntries } from './folder-grid/desktopEntries'
import { groupContainerCount, groupIdForPage, groupItemCount } from './groupMembership'
import { rememberGroupSelection, resolveGroupSelection, type GroupSelectionByCategory } from './groupSelection'
import { useGroupShortcutNavigation } from './useGroupShortcutNavigation'
import { useWebIconDiscoverySession } from './webIconDiscoverySession'
import type {
  ConfirmState,
  ContainerFormState,
  ContextMenuState,
  DataDirStatus,
  CollectionCategoryId,
  CollectionViewCategoryId,
  DesktopAsset,
  CategoryWorkspaceView,
  CollectionContainer,
  DesktopGridEntry,
  DesktopIcon,
  DesktopIconLayout,
  DesktopWallpaper as DesktopWallpaperState,
  DesktopWallpaperDeck,
  DesktopWallpaperView,
  DirectClient,
  CollectionItemFormState,
  CollectionGroup,
  CollectionsHealth,
  CollectionItem,
  AllViewItemCandidate,
  IconAppearanceCandidate,
  FwLaunchInfo,
  FoldersUiState,
  GroupFormState,
  Phase,
  WebIconDiscoveryResult,
  WebIconDiscoveryProgress,
} from './types'

type CollectionItemFormPayload = Omit<CollectionItem, 'icon'> & { icon: DesktopIcon | null }
type CategoryWallpaperEntry = DesktopWallpaperDeck['categories'][number]
type AllViewSelectionState = Record<string, boolean>
import { FolderGridCanvas, type DesktopGridApi, type DesktopGridDragEvent, type DesktopGridExternalItemDrag, type DesktopGridLayoutPatch } from './folder-grid/FolderGridCanvas'
import {
  DESKTOP_ICON_GAP_MAX,
  DESKTOP_ICON_GAP_MIN,
  DESKTOP_ICON_GAP_STEP,
  DESKTOP_ICON_SCALE_MAX,
  DESKTOP_ICON_SCALE_MIN,
  DESKTOP_ICON_SCALE_STEP,
  DEFAULT_DESKTOP_ICON_LAYOUT,
  normalizeDesktopIconLayout,
} from './folder-grid/iconLayout'
import {
  DEFAULT_VIEW_CATEGORY_ID,
  DEFAULT_GROUP_ID,
  DEFAULT_WORKSPACE_VIEW,
  EMPTY_ITEM_FORM,
  DEFAULT_LAUNCH_INFO,
  EMPTY_CONTAINER_FORM,
  EMPTY_GROUP_FORM,
  createEmptyItemForm,
  createGroupID,
  createID,
  deriveNameFromTarget,
  errorMessage,
  itemFormFromItem,
  itemTemplate,
  isInteractiveTarget,
} from './utils'

const appWindow = getCurrentWindow()
const ERROR_AUTO_HIDE_MS = 4200
const CONTAINER_HOVER_OPEN_MS = 520

function reorderWallpaperDeckCategories(categories: CategoryWallpaperEntry[], categoryOrder: CollectionViewCategoryId[]): CategoryWallpaperEntry[] {
  const byId = new Map(categories.map(category => [category.categoryId, category]))
  return categoryOrder.map(categoryId => {
    const category = byId.get(categoryId)
    if (!category) throw new Error(`wallpaper category missing: ${categoryId}`)
    return category
  })
}

function allViewSelectionKey(categoryId: CollectionCategoryId, itemId: string): string {
  return `${categoryId}:${itemId}`
}

function sourceCategoryIdForItem(item: CollectionItem): CollectionCategoryId {
  return item.sourceCategoryId || item.target.kind
}

function sourceItemIdForItem(item: CollectionItem): string {
  return item.sourceItemId || item.id
}

type ContainerDropResolution =
  | { kind: 'icon' }
  | { kind: 'grid'; placements: ContainerGridPlacement[] }
  | { kind: 'invalid' }

export function App() {
  const [launchInfo, setLaunchInfo] = React.useState<FwLaunchInfo>(DEFAULT_LAUNCH_INFO)
  const [status, setStatus] = React.useState<DataDirStatus | null>(null)
  const [client, setClient] = React.useState<DirectClient | null>(null)
  const [doc, setDoc] = React.useState<CategoryWorkspaceView>(DEFAULT_WORKSPACE_VIEW)
  const [wallpaperDeck, setWallpaperDeck] = React.useState<DesktopWallpaperDeck | null>(null)
  const [activeCategoryId, setActiveCategoryId] = React.useState<CollectionViewCategoryId>(DEFAULT_VIEW_CATEGORY_ID)
  const [phase, setPhase] = React.useState<Phase>('starting')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const [groupId, setGroupId] = React.useState(resolveGroupSelection(DEFAULT_WORKSPACE_VIEW, DEFAULT_GROUP_ID))
  const [groupIdByCategory, setGroupIdByCategory] = React.useState<GroupSelectionByCategory>({})
  const [editing, setEditing] = React.useState<CollectionItem | null>(null)
  const [form, setForm] = React.useState<CollectionItemFormState>(EMPTY_ITEM_FORM)
  const webIconDiscovery = useWebIconDiscoverySession()
  const webIconAutoSelectRef = React.useRef(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [groupEditorOpen, setGroupEditorOpen] = React.useState(false)
  const [groupForm, setGroupForm] = React.useState<GroupFormState>(EMPTY_GROUP_FORM)
  const [containerEditorOpen, setContainerEditorOpen] = React.useState(false)
  const [allViewSelectorOpen, setAllViewSelectorOpen] = React.useState(false)
  const [allViewCandidates, setAllViewCandidates] = React.useState<AllViewItemCandidate[]>([])
  const [allViewSelection, setAllViewSelection] = React.useState<AllViewSelectionState>({})
  const [containerForm, setContainerForm] = React.useState<ContainerFormState>(EMPTY_CONTAINER_FORM)
  const [editingContainer, setEditingContainer] = React.useState<CollectionContainer | null>(null)
  const [containerView, setContainerView] = React.useState<CollectionContainer | null>(null)
  const [containerDropView, setContainerDropView] = React.useState<CollectionContainer | null>(null)
  const [iconLayoutDraft, setIconLayoutDraft] = React.useState<DesktopIconLayout | null>(null)
  const [confirm, setConfirm] = React.useState<ConfirmState>(null)
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState>(null)
  const [desktopDrag, setDesktopDrag] = React.useState<DesktopDragState>(null)
  const [containerExtractDrag, setContainerExtractDrag] = React.useState<ContainerExtractDragState>(null)
  const desktopDragRef = React.useRef<DesktopDragState>(null)
  const containerGridApiByIdRef = React.useRef<Map<string, Map<string, ContainerGridApi>>>(new Map())
  const desktopGridApiRef = React.useRef<DesktopGridApi | null>(null)
  const containerExtractDragRef = React.useRef<ContainerExtractDragState>(null)
  const containerDropViewRef = React.useRef<CollectionContainer | null>(null)
  const hoverOpenTimerRef = React.useRef<number | null>(null)
  const hoverOpenTargetIdRef = React.useRef<string | null>(null)
  const readyRef = React.useRef(false)
  const activeViewCategory = viewCategoryDefinition(activeCategoryId)
  const activeCategory = activeCategoryId === ALL_VIEW_CATEGORY_ID ? null : categoryDefinition(activeCategoryId)
  const isAllView = activeCategoryId === ALL_VIEW_CATEGORY_ID
  const requestParams = React.useCallback((params?: Record<string, unknown>) => ({ categoryId: activeCategoryId, ...(params || {}) }), [activeCategoryId])

  const cancelWebIconDiscovery = React.useCallback(() => {
    webIconAutoSelectRef.current = false
    webIconDiscovery.cancel()
  }, [webIconDiscovery])

  const refreshWallpaperDeck = React.useCallback(async (nextClient = client) => {
    if (!nextClient) return
    try {
      setWallpaperDeck(await nextClient.request<DesktopWallpaperDeck>('collections.desktop.wallpaper.deck'))
    } catch (e) {
      setError(errorMessage(e, '加载壁纸预设失败'))
    }
  }, [client])

  const updateWallpaperDeckCategory = React.useCallback((workspace: CategoryWorkspaceView) => {
    setWallpaperDeck(current => wallpaperDeckWithWorkspace(current, workspace))
  }, [])

  const saveUIState = React.useCallback(async (nextUIState: FoldersUiState, nextClient = client) => {
    if (!nextClient) return
    await nextClient.request<FoldersUiState>('collections.ui-state.save', { uiState: nextUIState })
  }, [client])

  const uiStateFromSelection = React.useCallback((categoryId: CollectionViewCategoryId, selections: GroupSelectionByCategory): FoldersUiState => ({
    activeCategoryId: categoryId,
    groupIdByCategory: {
      all: selections.all ?? DEFAULT_GROUP_ID,
      folder: selections.folder ?? '',
      url: selections.url ?? '',
      file: selections.file ?? '',
    },
  }), [])

  const loadCategory = React.useCallback(async (categoryId: CollectionViewCategoryId, nextClient = client, preferredGroupId?: string) => {
    if (!nextClient) return null
    cancelWebIconDiscovery()
    setBusy(true); setError(null)
    try {
      const nextDoc = await nextClient.request<CategoryWorkspaceView>('collections.category.get', { categoryId })
      setDoc(nextDoc)
      updateWallpaperDeckCategory(nextDoc)
      setGroupId(resolveGroupSelection(nextDoc, preferredGroupId ?? groupIdByCategory[categoryId] ?? ''))
      setSearch('')
      setEditing(null)
      setContainerView(null)
      setContainerDropViewState(null)
      setContextMenu(null)
      void refreshWallpaperDeck(nextClient)
      return nextDoc
    } catch (e) {
      setError(errorMessage(e, '切换类别失败'))
      return null
    } finally { setBusy(false) }
  }, [client, groupIdByCategory, refreshWallpaperDeck, updateWallpaperDeckCategory])

  const selectGroup = React.useCallback((nextGroupId: string) => {
    const resolvedGroupId = resolveGroupSelection(doc, nextGroupId)
    setGroupId(resolvedGroupId)
    setGroupIdByCategory(current => {
      const nextSelections = rememberGroupSelection(current, activeCategoryId, resolvedGroupId)
      void saveUIState(uiStateFromSelection(activeCategoryId, nextSelections)).catch(e => setError(errorMessage(e, '保存上次分组失败')))
      return nextSelections
    })
  }, [activeCategoryId, doc, saveUIState, uiStateFromSelection])

  const selectResolvedGroup = React.useCallback((resolvedGroupId: string) => {
    setGroupId(resolvedGroupId)
    setGroupIdByCategory(current => {
      const nextSelections = rememberGroupSelection(current, activeCategoryId, resolvedGroupId)
      void saveUIState(uiStateFromSelection(activeCategoryId, nextSelections)).catch(e => setError(errorMessage(e, '保存上次分组失败')))
      return nextSelections
    })
  }, [activeCategoryId, saveUIState, uiStateFromSelection])

  const selectCategory = React.useCallback((categoryId: CollectionViewCategoryId) => {
    if (categoryId === activeCategoryId) return
    const nextSelections = rememberGroupSelection(groupIdByCategory, activeCategoryId, groupId)
    setActiveCategoryId(categoryId)
    setGroupIdByCategory(nextSelections)
    void loadCategory(categoryId, client, nextSelections[categoryId]).then(nextDoc => {
      if (!nextDoc) return
      const resolvedTargetGroupId = resolveGroupSelection(nextDoc, nextSelections[categoryId] ?? '')
      const savedSelections = rememberGroupSelection(nextSelections, categoryId, resolvedTargetGroupId)
      setGroupIdByCategory(savedSelections)
      void saveUIState(uiStateFromSelection(categoryId, savedSelections)).catch(e => setError(errorMessage(e, '保存上次分类失败')))
    })
  }, [activeCategoryId, client, groupId, groupIdByCategory, loadCategory, saveUIState, uiStateFromSelection])

  useGroupShortcutNavigation({
    enabled: !isAllView,
    workspace: doc,
    groupId,
    onSelectGroup: selectGroup,
  })

  const handleContainerGridReady = React.useCallback((containerId: string, instanceId: string, api: ContainerGridApi | null) => {
    const apis = containerGridApiByIdRef.current.get(containerId) || new Map<string, ContainerGridApi>()
    if (api) {
      apis.set(instanceId, api)
      containerGridApiByIdRef.current.set(containerId, apis)
      return
    }
    apis.delete(instanceId)
    if (apis.size) containerGridApiByIdRef.current.set(containerId, apis)
    else containerGridApiByIdRef.current.delete(containerId)
  }, [])

  const handleDesktopGridReady = React.useCallback((api: DesktopGridApi | null) => {
    desktopGridApiRef.current = api
  }, [])

  const refreshStatus = React.useCallback(async () => {
    const next = await invoke<DataDirStatus>('data_dir_status').catch(() => null)
    setStatus(next)
    return next
  }, [])

  const connect = React.useCallback(async (options?: { restartBackend?: boolean }) => {
    cancelWebIconDiscovery()
    setBusy(true); setError(null); setPhase('starting'); client?.close(); setClient(null); setWallpaperDeck(null)
    try {
      if (options?.restartBackend) await invoke('restart_backend')
      const nextClient = await createDirectClient()
      const health = await nextClient.request<CollectionsHealth>('collections.health')
      if (!health.data.ok) {
        setClient(nextClient); setPhase('data-error'); setError(health.data.error || '数据文件无法迁移到当前版本'); await refreshStatus()
        return
      }
      const initialUIState = await nextClient.request<FoldersUiState>('collections.ui-state.get')
      const initialCategoryId = initialUIState.activeCategoryId
      const initialGroupIdByCategory = initialUIState.groupIdByCategory
      const nextDoc = await nextClient.request<CategoryWorkspaceView>('collections.category.get', { categoryId: initialCategoryId })
      const initialGroupId = resolveGroupSelection(nextDoc, initialGroupIdByCategory[initialCategoryId] ?? '')
      setClient(nextClient); setActiveCategoryId(initialCategoryId); setGroupIdByCategory(initialGroupIdByCategory); setDoc(nextDoc); setGroupId(initialGroupId); setWallpaperDeck(wallpaperDeckFromWorkspace(nextDoc)); setPhase('ready'); await refreshStatus(); void refreshWallpaperDeck(nextClient)
    } catch (e) {
      setPhase('failed'); setError(errorMessage(e, '启动收藏集后台失败')); await refreshStatus()
    } finally { setBusy(false) }
  }, [client, refreshStatus, refreshWallpaperDeck])

  React.useEffect(() => {
    if (!readyRef.current) { readyRef.current = true; void invoke('app_ready').catch(() => {}) }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const [nextLaunchInfo, initialCommand] = await Promise.all([
        invoke<FwLaunchInfo>('fw_launch_info').catch(() => DEFAULT_LAUNCH_INFO),
        invoke<string | null>('fw_initial_command').catch(() => null),
      ])
      if (cancelled) return
      setLaunchInfo(nextLaunchInfo); await refreshStatus()
      if (!cancelled) { await connect(); if (initialCommand) handleCommand(initialCommand) }
    })()
    return () => { cancelled = true }
  }, [])

  React.useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false
    void listen<{ command?: string }>('fw-app-command', event => {
      const command = String(event.payload?.command || '').trim()
      if (command) handleCommand(command)
    }).then(nextUnlisten => { if (cancelled) nextUnlisten(); else unlisten = nextUnlisten }).catch(() => {})
    return () => { cancelled = true; unlisten?.() }
  }, [])

  React.useEffect(() => () => client?.close(), [client])
  React.useEffect(() => {
    if (!settingsOpen) setIconLayoutDraft(null)
  }, [settingsOpen])
  React.useEffect(() => {
    if (!error) return
    if (phase === 'data-error') return
    const timer = window.setTimeout(() => setError(null), ERROR_AUTO_HIDE_MS)
    return () => window.clearTimeout(timer)
  }, [error, phase])
  React.useEffect(() => {
    const resolvedGroupId = resolveGroupSelection(doc, groupId)
    if (resolvedGroupId === groupId) return
    setGroupId(resolvedGroupId)
    setGroupIdByCategory(current => {
      const nextSelections = rememberGroupSelection(current, activeCategoryId, resolvedGroupId)
      void saveUIState(uiStateFromSelection(activeCategoryId, nextSelections)).catch(e => setError(errorMessage(e, '保存上次分组失败')))
      return nextSelections
    })
  }, [activeCategoryId, doc, groupId, saveUIState, uiStateFromSelection])
  React.useEffect(() => {
    if (!editing || !client) return
    const onPaste = (event: ClipboardEvent) => {
      void (async () => {
        const dataUrl = await clipboardImageDataUrlFromPasteEvent(event)
        if (!dataUrl) return
        event.preventDefault()
        setBusy(true); setError(null)
        try { await importIconDataUrl(dataUrl, '剪贴板图片') }
        catch (e) { setError(errorMessage(e, '粘贴剪贴板图片失败')) }
        finally { setBusy(false) }
      })()
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [client, editing])
  React.useEffect(() => {
    const close = () => setContextMenu(null)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true) }
  }, [])
  React.useEffect(() => () => clearHoverOpenTimer(), [])
  function handleCommand(command: string) {
    if (command === 'open-settings') setSettingsOpen(true)
    if (command === 'add-folder') openAdd()
    if (command === 'open-folders') { cancelWebIconDiscovery(); setSettingsOpen(false); setGroupEditorOpen(false); setEditing(null); setContainerView(null); setContainerDropViewState(null) }
  }

  function closeItemDialog() {
    cancelWebIconDiscovery()
    setEditing(null)
  }

  function updateItemForm(nextForm: CollectionItemFormState) {
    if (nextForm.target !== form.target) cancelWebIconDiscovery()
    setForm(nextForm)
  }

  function openAdd() {
    if (!activeCategory) return
    cancelWebIconDiscovery()
    const selectedGroupId = resolveGroupSelection(doc, groupId)
    setEditing(itemTemplate(activeCategory.id, selectedGroupId))
    setForm(createEmptyItemForm(selectedGroupId))
  }

  function openEdit(item: CollectionItem) {
    cancelWebIconDiscovery()
    setEditing(item); setForm(itemFormFromItem(item)); setContextMenu(null)
  }

  function openAddContainer() {
    if (isAllView) return
    if (!resolveGroupSelection(doc, groupId)) { setError('请先创建分组，再添加收纳夹'); return }
    setEditingContainer(null)
    setContainerForm({ ...EMPTY_CONTAINER_FORM })
    setContainerEditorOpen(true)
  }

  function openEditContainer(container: CollectionContainer) {
    if (isAllView) return
    setEditingContainer(container)
    setContainerForm({ id: container.id, name: container.name })
    setContainerEditorOpen(true)
    setContextMenu(null)
  }

  async function saveItem() {
    if (!client || !editing || !activeCategory) return
    const targetValue = form.target.trim()
    const targetError = activeCategory.validateTarget(targetValue)
    if (targetError) { setError(targetError); return }
    const name = (form.name.trim() || deriveNameFromTarget(targetValue)).trim()
    if (!name) { setError('名称不能为空'); return }
    cancelWebIconDiscovery()
    setBusy(true); setError(null)
    try {
      let targetGroupId = groupIdForPage(form.groupId)
      const newGroupName = form.newGroupName.trim()
      if (newGroupName) {
        const newGroupId = createGroupID()
        const afterGroupAdd = await client.request<CategoryWorkspaceView>('collections.groups.add', requestParams({ group: { id: newGroupId, name: newGroupName } }))
        setDoc(afterGroupAdd)
        targetGroupId = newGroupId
      }
      if (!newGroupName && !doc.groups.some(group => group.id === targetGroupId)) { setError('请选择有效分类'); return }
      const now = Date.now()
      const nowText = new Date(now).toISOString()
      const draftIcon = await resolveFormDraftIcon()
      const payload: CollectionItemFormPayload = {
        id: editing.id || createID(), name, target: activeCategory.buildTarget(targetValue), groupId: targetGroupId, pageOrder: editing.pageOrder,
        containerId: editing.containerId,
        createdAt: editing.createdAt || nowText, updatedAt: nowText,
        createdAtMs: editing.createdAtMs || now, updatedAtMs: now,
        layout: editing.layout,
        icon: draftIcon,
      }
      const nextDoc = await client.request<CategoryWorkspaceView>(editing.id ? 'collections.items.update' : 'collections.items.add', requestParams({ item: payload }))
      setDoc(nextDoc); setEditing(null)
      if (newGroupName) selectResolvedGroup(targetGroupId)
    } catch (e) { setError(errorMessage(e, `保存${activeCategory.singularLabel}失败`)) } finally { setBusy(false) }
  }

  async function removeItem(item: CollectionItem) {
    if (!client || !activeCategory) return
    setBusy(true); setError(null)
    try { setDoc(await client.request<CategoryWorkspaceView>('collections.items.remove', requestParams({ id: item.id }))); setConfirm(null); setContextMenu(null) }
    catch (e) { setError(errorMessage(e, `删除${activeCategory.singularLabel}失败`)) }
    finally { setBusy(false) }
  }

  async function openItem(item: CollectionItem) {
    if (!client) return
    setBusy(true); setError(null); setContextMenu(null)
    const sourceCategoryId = sourceCategoryIdForItem(item)
    const itemCategory = categoryDefinition(sourceCategoryId)
    try { await client.request('collections.items.open', requestParams({ categoryId: sourceCategoryId, id: sourceItemIdForItem(item) })) }
    catch (e) { setError(errorMessage(e, itemCategory.openError)) }
    finally { setBusy(false) }
  }

  async function moveItemToGroup(item: CollectionItem, targetGroupId: string) {
    if (!client || isAllView || item.groupId === targetGroupId) return
    setBusy(true); setError(null)
    try { setDoc(await client.request<CategoryWorkspaceView>('collections.items.move-to-group', requestParams({ id: item.id, groupId: targetGroupId }))); setContextMenu(null) }
    catch (e) { setError(errorMessage(e, '移动到分类失败')) }
    finally { setBusy(false) }
  }

  async function copyItemToGroup(item: CollectionItem, targetGroupId: string) {
    if (!client || isAllView || item.groupId === targetGroupId) return
    setBusy(true); setError(null)
    try { setDoc(await client.request<CategoryWorkspaceView>('collections.items.copy-to-group', requestParams({ id: item.id, groupId: targetGroupId }))); setContextMenu(null) }
    catch (e) { setError(errorMessage(e, '复制到分类失败')) }
    finally { setBusy(false) }
  }

  async function saveItemContainer(ids: string[], containerId: string) {
    if (!client || isAllView || !ids.length) return
    setBusy(true); setError(null)
    try { setDoc(await client.request<CategoryWorkspaceView>('collections.items.container.save', requestParams({ ids, containerId }))); setContextMenu(null) }
    catch (e) { setError(errorMessage(e, '移动到收纳夹失败')) }
    finally { setBusy(false) }
  }

  async function createContainerFromItems(sourceItemId: string, targetItemId: string, layout: NonNullable<CollectionItem['layout']>) {
    if (!client || isAllView) return
    setBusy(true); setError(null)
    try {
      const nextDoc = await client.request<CategoryWorkspaceView>('collections.containers.create-from-items', requestParams({ sourceItemId, targetItemId, layout }))
      setDoc(nextDoc)
      const movedItem = nextDoc.items.find(item => item.id === sourceItemId)
      const nextContainer = movedItem?.containerId ? nextDoc.containers.find(container => container.id === movedItem.containerId) : null
      setContainerDropViewState(null)
      if (nextContainer) setContainerView(nextContainer)
    } catch (e) { setError(errorMessage(e, '自动创建收纳夹失败')) }
    finally { setBusy(false) }
  }

  async function placeContainerItems(containerId: string, movedId: string | null, placements: ContainerGridPlacement[]) {
    if (!client || !placements.length) return
    const previousDoc = doc
    setError(null)
    setDoc(current => ({
      ...current,
      items: current.items.map(item => {
        const placement = placements.find(currentPlacement => currentPlacement.id === item.id)
        if (!placement && item.id !== movedId) return item
        return {
          ...item,
          containerId: item.id === movedId ? containerId : item.containerId,
          containerLayout: placement?.layout ?? item.containerLayout,
        }
      }),
    }))
    try {
      const nextDoc = await client.request<CategoryWorkspaceView>('collections.container.items.place', requestParams({ containerId, movedId: movedId || undefined, items: placements }))
      setDoc(nextDoc)
    } catch (e) {
      setDoc(previousDoc)
      setError(errorMessage(e, '保存收纳夹布局失败'))
    }
  }

  function openDesktopEntry(entry: DesktopGridEntry) {
    if (entry.kind === 'item' && entry.item) void openItem(entry.item)
    if (entry.kind === 'container' && entry.container) { setContainerDropViewState(null); setContainerView(entry.container); setContextMenu(null) }
  }

  function closeContextMenu() {
    setContextMenu(null)
  }

  function openContainerItemContextMenu(container: CollectionContainer | null, item: CollectionItem, x: number, y: number) {
    if (!container) throw new Error(`container context menu missing container for item: ${item.id}`)
    setContextMenu({ kind: 'container-item', container, item, x, y })
  }

  async function saveDesktopLayouts(patches: DesktopGridLayoutPatch[]) {
    if (!client || patches.length === 0) return
    const previousDoc = doc
    setError(null)
    setDoc(current => ({
      ...current,
      items: current.items.map(item => {
        const patch = patches.find(currentPatch => currentPatch.kind === 'item' && currentPatch.id === item.id)
        return patch ? { ...item, layout: patch.layout } : item
      }),
      containers: current.containers.map(container => {
        const patch = patches.find(currentPatch => currentPatch.kind === 'container' && currentPatch.id === container.id)
        return patch ? { ...container, layout: patch.layout } : container
      }),
    }))
    try {
      const nextDoc = await client.request<CategoryWorkspaceView>('collections.desktop.layout.save', requestParams({ groupId, items: patches }))
      setDoc(nextDoc)
    } catch (e) {
      setDoc(previousDoc)
      setError(errorMessage(e, '保存桌面布局失败'))
    }
  }

  async function extractContainerItemToDesktop(containerId: string, itemId: string, patches: DesktopGridLayoutPatch[]) {
    if (!client || patches.length === 0) return
    const previousDoc = doc
    const previousContainerView = containerView
    setError(null)
    let optimisticDoc: CategoryWorkspaceView
    try {
      optimisticDoc = applyContainerItemDesktopExtractionView(doc, containerId, itemId, patches)
    } catch (e) {
      setError(errorMessage(e, '移出到桌面失败'))
      return
    }
    setContainerDropViewState(null)
    setContainerView(null)
    setDoc(optimisticDoc)
    try {
      const nextDoc = await client.request<CategoryWorkspaceView>('collections.container.item.extract-to-desktop', requestParams({ containerId, itemId, items: patches }))
      setDoc(nextDoc)
    } catch (e) {
      setDoc(previousDoc)
      setContainerView(previousContainerView)
      setError(errorMessage(e, '移出到桌面失败'))
    }
  }

  function clearHoverOpenTimer() {
    if (hoverOpenTimerRef.current == null) return
    window.clearTimeout(hoverOpenTimerRef.current)
    hoverOpenTimerRef.current = null
    hoverOpenTargetIdRef.current = null
  }

  function setDesktopDragState(next: DesktopDragState | ((current: DesktopDragState) => DesktopDragState)) {
    const resolved = typeof next === 'function' ? next(desktopDragRef.current) : next
    desktopDragRef.current = resolved
    setDesktopDrag(resolved)
  }

  function setContainerExtractDragState(next: ContainerExtractDragState | ((current: ContainerExtractDragState) => ContainerExtractDragState)) {
    const resolved = typeof next === 'function' ? next(containerExtractDragRef.current) : next
    containerExtractDragRef.current = resolved
    setContainerExtractDrag(resolved)
  }

  function setContainerDropViewState(next: CollectionContainer | null) {
    containerDropViewRef.current = next
    setContainerDropView(next)
  }

  function handleDesktopDragStart(event: DesktopGridDragEvent) {
    clearHoverOpenTimer()
    if (event.entry.kind !== 'item' || !event.entry.item) return
    setDesktopDragState({ item: event.entry.item, mode: event.dragMode })
  }

  function handleDesktopDragMove(event: DesktopGridDragEvent) {
    if (event.entry.kind !== 'item' || !event.entry.item) return
    updateDesktopDragFromEvent(event)
  }

  function updateDesktopDragFromEvent(event: DesktopGridDragEvent, resolvedDropIntent = resolveDesktopDropIntent(event, desktopDragRef.current, activeDropContainer())) {
    const hoverContainer = event.hoverContainer?.container
    const hoverTarget = event.hoverTarget
    const nextMode = resolveDesktopDragMode(event, resolvedDropIntent)
    setDesktopDragState(current => {
      if (current && current.item.id === event.entry.id) {
        return {
          ...current,
          mode: nextMode,
          hoverTargetId: hoverTarget?.entry.id,
          hoverTargetKind: hoverTarget?.entry.kind,
          dropIntent: resolvedDropIntent,
        }
      }
      return event.entry.kind === 'item' && event.entry.item ? {
        item: event.entry.item,
        mode: nextMode,
        hoverTargetId: hoverTarget?.entry.id,
        hoverTargetKind: hoverTarget?.entry.kind,
        dropIntent: resolvedDropIntent,
      } : current
    })
    if (event.dragMode !== 'overlay' || !hoverContainer) {
      clearHoverOpenTimer()
      return
    }
    if (activeDropContainer()?.id === hoverContainer.id) {
      clearHoverOpenTimer()
      setDesktopDragState(current => current && current.item.id === event.entry.id ? { ...current, dropIntent: { kind: 'container', containerId: hoverContainer.id } } : current)
      return
    }
    if (hoverOpenTargetIdRef.current === hoverContainer.id) return
    clearHoverOpenTimer()
    hoverOpenTargetIdRef.current = hoverContainer.id
    hoverOpenTimerRef.current = window.setTimeout(() => {
      hoverOpenTimerRef.current = null
      hoverOpenTargetIdRef.current = null
      openDropContainer(hoverContainer)
      setDesktopDragState(current => current && current.item.id === event.entry.id ? { ...current, dropIntent: { kind: 'container', containerId: hoverContainer.id } } : current)
    }, CONTAINER_HOVER_OPEN_MS)
  }

  function activeDropContainer(): CollectionContainer | null {
    return containerExtractDragRef.current?.mode === 'desktop' ? containerDropViewRef.current : containerView
  }

  function openDropContainer(container: CollectionContainer) {
    if (containerExtractDragRef.current?.mode === 'desktop') setContainerDropViewState(container)
    else setContainerView(container)
  }

  function handleDesktopDragEnd(event: DesktopGridDragEvent, patches: DesktopGridLayoutPatch[]) {
    clearHoverOpenTimer()
    const drag = desktopDragRef.current
    const dropIntent = resolveDesktopDropIntent(event, drag, activeDropContainer())
    if (dropIntent?.kind === 'container' && drag && event.entry.kind === 'item') {
      if (!commitItemContainerDrop(dropIntent.containerId, event, drag.item.id, activeDropContainer())) {
        setDesktopDragState(null)
        return { handled: true, clearReleaseLayouts: true }
      }
      setDesktopDragState(null)
      return { handled: true, clearReleaseLayouts: true }
    }
    if (dropIntent?.kind === 'new-container' && drag && event.entry.kind === 'item') {
      void createContainerFromItems(drag.item.id, dropIntent.targetItemId, dropIntent.layout)
      setDesktopDragState(null)
      return { handled: true, clearReleaseLayouts: true }
    }
    if (event.dragMode === 'overlay') {
      setDesktopDragState(null)
      return { handled: true, clearReleaseLayouts: true }
    }
    setDesktopDragState(null)
    if (patches.length) void saveDesktopLayouts(patches)
    return true
  }

  function commitItemContainerDrop(containerId: string, event: DesktopGridDragEvent, movedItemId: string, openContainer: CollectionContainer | null): boolean {
    const resolution = resolveContainerDrop(containerId, event, movedItemId, openContainer)
    if (resolution.kind === 'invalid') return false
    if (resolution.kind === 'icon') {
      void saveItemContainer([movedItemId], containerId)
      return true
    }
    void placeContainerItems(containerId, movedItemId, resolution.placements)
    return true
  }

  function resolveContainerDrop(containerId: string, event: DesktopGridDragEvent, movedItemId: string, openContainer: CollectionContainer | null): ContainerDropResolution {
    const containerGrid = latestContainerGridApi(containerId)
    const surface = resolveContainerDropSurface(containerId, openContainer, Boolean(containerGrid))
    if (surface === 'icon') return { kind: 'icon' }
    if (!containerGrid) {
      setError('收纳夹投放区域尚未就绪，请重新拖入')
      return { kind: 'invalid' }
    }
    const dropLayout = containerGrid.layoutFromClientPoint(event.clientX, event.clientY, event.offsetX, event.offsetY)
    if (!dropLayout) return { kind: 'invalid' }
    const placements = containerGrid.placementsForDrop(movedItemId, dropLayout)
    if (!placements.some(placement => placement.id === movedItemId)) {
      setError('收纳夹投放布局缺少当前拖拽图标')
      return { kind: 'invalid' }
    }
    return { kind: 'grid', placements }
  }

  function latestContainerGridApi(containerId: string): ContainerGridApi | null {
    const apis = containerGridApiByIdRef.current.get(containerId)
    if (!apis?.size) return null
    const orderedApis = Array.from(apis.values())
    return orderedApis[orderedApis.length - 1] || null
  }

  function handleDesktopDragCancel() {
    clearHoverOpenTimer()
    setDesktopDragState(null)
  }

  function handleContainerItemDragStart(event: ContainerItemDragEvent) {
    if (!containerView) return
    if (event.item.containerId !== containerView.id) {
      setError(`收藏项不在当前收纳夹中：${event.item.name}`)
      return
    }
    setContainerDropViewState(null)
    setDesktopDragState(null)
    setContainerExtractDragState({ containerId: containerView.id, item: event.item, mode: 'container' })
  }

  function handleContainerItemDragMove(event: ContainerItemDragEvent) {
    if (!containerView) return
    const previousDrag = containerExtractDragRef.current
    const mode = resolveContainerExtractNextDragMode(previousDrag?.mode, event, event.boundary)
    const desktopDrag = mode === 'desktop' ? toDesktopExternalDrag(event) : undefined
    const projection = desktopDrag ? desktopGridApiRef.current?.projectExternalItemDrag(desktopDrag, desktopDragRef.current, activeDropContainer()) : null
    setContainerExtractDragState(current => current && current.item.id === event.item.id ? {
      ...current,
      desktopDrag,
      mode,
    } : current)
    if (mode === 'desktop' && projection) {
      updateDesktopDragFromEvent(projection.event, projection.dropIntent)
    } else if (mode === 'desktop') {
      clearHoverOpenTimer()
      setContainerDropViewState(null)
      setDesktopDragState(null)
    } else if (mode === 'container') {
      clearHoverOpenTimer()
      setContainerDropViewState(null)
      setDesktopDragState(null)
    }
  }

  function handleContainerItemDragEnd(event: ContainerItemDragEvent, patches: ContainerGridPlacement[]) {
    const drag = containerExtractDragRef.current
    if (!drag || !containerView || drag.item.id !== event.item.id) {
      setContainerExtractDragState(null)
      return undefined
    }
    const mode = resolveContainerExtractNextDragMode(drag.mode, event, event.boundary)
    if (mode !== 'desktop') {
      setContainerExtractDragState(null)
      setContainerDropViewState(null)
      setDesktopDragState(null)
      return undefined
    }
    const projection = desktopGridApiRef.current?.projectExternalItemDrag(toDesktopExternalDrag(event), desktopDragRef.current, activeDropContainer())
    if (!projection) {
      setError('桌面投放位置不可用，请重新拖出')
      setContainerExtractDragState(null)
      setContainerDropViewState(null)
      setDesktopDragState(null)
      return { handled: true, clearReleaseLayouts: true }
    }
    if (projection.dropIntent?.kind === 'container') {
      const targetContainerId = projection.dropIntent.containerId
      if (!commitItemContainerDrop(targetContainerId, projection.event, drag.item.id, activeDropContainer())) {
        setContainerExtractDragState(null)
        setContainerDropViewState(null)
        setDesktopDragState(null)
        return { handled: true, clearReleaseLayouts: true }
      }
      const targetContainer = doc.containers.find(container => container.id === targetContainerId) || null
      setContainerView(targetContainer)
      setContainerDropViewState(null)
      setContainerExtractDragState(null)
      setDesktopDragState(null)
      return { handled: true, clearReleaseLayouts: true }
    }
    if (projection.dropIntent?.kind === 'new-container') {
      void createContainerFromItems(drag.item.id, projection.dropIntent.targetItemId, projection.dropIntent.layout)
      setContainerView(null)
      setContainerDropViewState(null)
      setContainerExtractDragState(null)
      setDesktopDragState(null)
      return { handled: true, clearReleaseLayouts: true }
    }
    if (projection.event.dragMode === 'overlay') {
      setContainerExtractDragState(null)
      setContainerDropViewState(null)
      setDesktopDragState(null)
      return { handled: true, clearReleaseLayouts: true }
    }
    if (!projection.patches.length) {
      setError('桌面投放布局缺少拖出图标，请重新拖出')
      setContainerExtractDragState(null)
      setContainerDropViewState(null)
      setDesktopDragState(null)
      return { handled: true, clearReleaseLayouts: true }
    }
    void extractContainerItemToDesktop(drag.containerId, drag.item.id, projection.patches)
    setContainerExtractDragState(null)
    setContainerDropViewState(null)
    setDesktopDragState(null)
    return { handled: true, clearReleaseLayouts: true }
  }

  function handleContainerItemDragCancel() {
    clearHoverOpenTimer()
    setContainerExtractDragState(null)
    setContainerDropViewState(null)
    setDesktopDragState(null)
  }

  function toDesktopExternalDrag(event: ContainerItemDragEvent): DesktopGridExternalItemDrag {
    return { item: event.item, clientX: event.clientX, clientY: event.clientY, offsetX: event.offsetX, offsetY: event.offsetY, modifiers: event.modifiers }
  }

  function openGroupEditor(group?: CollectionGroup) {
    setGroupForm(group ? { id: group.id, name: group.name } : EMPTY_GROUP_FORM); setGroupEditorOpen(true)
  }

  async function saveGroup() {
    if (!client || isAllView) return
    const name = groupForm.name.trim()
    if (!name) { setError('分组名称不能为空'); return }
    const id = groupForm.id || createGroupID()
    setBusy(true); setError(null)
    try {
      const method = groupForm.id ? 'collections.groups.update' : 'collections.groups.add'
      setDoc(await client.request<CategoryWorkspaceView>(method, requestParams({ group: { id, name } })))
      setGroupEditorOpen(false)
    } catch (e) { setError(errorMessage(e, '保存分组失败')) } finally { setBusy(false) }
  }

  async function removeGroup(group: CollectionGroup) {
    if (!client || isAllView) return
    setBusy(true); setError(null)
    try {
      const nextDoc = await client.request<CategoryWorkspaceView>('collections.groups.remove', requestParams({ id: group.id }))
      setDoc(nextDoc); setConfirm(null); setGroupEditorOpen(false)
      if (groupId === group.id) selectResolvedGroup(resolveGroupSelection(nextDoc, ''))
    } catch (e) { setError(errorMessage(e, '删除分组失败')) } finally { setBusy(false) }
  }

  async function saveGroupOrder(groupOrder: string[]) {
    if (!client || isAllView) return
    setBusy(true); setError(null)
    try {
      const nextDoc = await client.request<CategoryWorkspaceView>('collections.groups.order.save', requestParams({ groupOrder }))
      setDoc(nextDoc)
      selectResolvedGroup(resolveGroupSelection(nextDoc, groupId))
    } catch (e) { setError(errorMessage(e, '保存分组顺序失败')) } finally { setBusy(false) }
  }

  async function saveContainer() {
    if (!client || isAllView) return
    const name = containerForm.name.trim()
    if (!name) { setError('收纳夹名称不能为空'); return }
    setBusy(true); setError(null)
    try {
      const id = editingContainer?.id || createID()
      const now = Date.now()
      const nowText = new Date(now).toISOString()
      const targetGroupId = editingContainer?.groupId || resolveGroupSelection(doc, groupId)
      if (!targetGroupId) { setError('请先创建分组，再添加收纳夹'); return }
      const payload: CollectionContainer = {
        id,
        name,
        groupId: targetGroupId,
        pageOrder: editingContainer?.pageOrder || 0,
        createdAt: editingContainer?.createdAt || nowText,
        updatedAt: nowText,
        createdAtMs: editingContainer?.createdAtMs || now,
        updatedAtMs: now,
        layout: editingContainer?.layout,
      }
      const nextDoc = await client.request<CategoryWorkspaceView>(editingContainer ? 'collections.containers.update' : 'collections.containers.add', requestParams({ container: payload }))
      setDoc(nextDoc); setContainerEditorOpen(false); setEditingContainer(null)
    } catch (e) { setError(errorMessage(e, '保存收纳夹失败')) } finally { setBusy(false) }
  }

  async function renameContainer(container: CollectionContainer, name: string) {
    if (!client || isAllView) throw new Error('当前视图不支持重命名收纳夹')
    const nextName = name.trim()
    if (!nextName) throw new Error('收纳夹名称不能为空')
    if (nextName === container.name) return
    setBusy(true); setError(null)
    try {
      const now = Date.now()
      const nextDoc = await client.request<CategoryWorkspaceView>('collections.containers.update', requestParams({ container: {
        ...container,
        name: nextName,
        updatedAt: new Date(now).toISOString(),
        updatedAtMs: now,
      } }))
      setDoc(nextDoc)
      setContainerView(current => current?.id === container.id ? nextDoc.containers.find(item => item.id === container.id) || null : current)
      setContainerDropViewState(containerDropViewRef.current?.id === container.id ? nextDoc.containers.find(item => item.id === container.id) || null : containerDropViewRef.current)
    } catch (e) {
      const message = errorMessage(e, '重命名收纳夹失败')
      setError(message)
      throw new Error(message)
    } finally { setBusy(false) }
  }

  async function removeContainer(container: CollectionContainer) {
    if (!client || isAllView) return
    setBusy(true); setError(null)
    try { setDoc(await client.request<CategoryWorkspaceView>('collections.containers.remove', requestParams({ id: container.id }))); setConfirm(null); setContainerView(null); setContextMenu(null) }
    catch (e) { setError(errorMessage(e, '删除收纳夹失败')) }
    finally { setBusy(false) }
  }

  function updateFormIconDraft(icon: DesktopIcon | null) {
    webIconAutoSelectRef.current = false
    setForm(current => ({ ...current, icon: { ...current.icon, draftIcon: icon, draftCandidateId: undefined, draftDataUrl: undefined } }))
  }

  function selectFormIconCandidate(candidate: IconAppearanceCandidate) {
    webIconAutoSelectRef.current = false
    setForm(current => ({
      ...current,
      icon: {
        ...current.icon,
        draftIcon: candidate.icon || null,
        draftCandidateId: candidate.id,
        draftDataUrl: candidate.dataUrl,
      },
    }))
  }

  async function resolveFormDraftIcon(): Promise<DesktopIcon | null> {
    if (!form.icon.draftDataUrl) return form.icon.draftIcon
    if (!client) throw new Error('后台未连接，无法保存图标')
    const asset = await client.request<DesktopAsset>('collections.assets.import', { kind: 'icon', dataUrl: form.icon.draftDataUrl })
    return { kind: 'image', assetId: asset.id }
  }

  async function importIconDataUrl(dataUrl: string, label: string) {
    if (!client || !editing) return
    webIconAutoSelectRef.current = false
    const asset = await client.request<DesktopAsset>('collections.assets.import', { kind: 'icon', dataUrl })
    const icon: DesktopIcon = { kind: 'image', assetId: asset.id }
    setForm(current => ({
      ...current,
      icon: {
        draftIcon: icon,
        candidates: upsertIconCandidate(current.icon.candidates, { id: importedIconCandidateId(asset.id), label, icon }),
      },
    }))
  }

  async function pasteFormIconImage() {
    if (!client || !editing) return
    setBusy(true); setError(null)
    try {
      const dataUrl = await clipboardImageDataUrlFromClipboard()
      await importIconDataUrl(dataUrl, '剪贴板图片')
    } catch (e) { setError(errorMessage(e, '粘贴剪贴板图片失败')) }
    finally { setBusy(false) }
  }

  async function fetchFormSystemIcon() {
    if (!client || !editing || !activeCategory) return
    const target = form.target.trim()
    const targetError = activeCategory.validateTarget(target)
    if (targetError) { setError(targetError); return }
    setBusy(true); setError(null)
    try {
      const dataUrl = await invoke<string>('system_icon_data_url', { path: target })
      const asset = await client.request<DesktopAsset>('collections.assets.import', { kind: 'icon', dataUrl })
      const icon: DesktopIcon = { kind: 'image', assetId: asset.id }
      setForm(current => ({
        ...current,
        icon: {
          draftIcon: icon,
          candidates: upsertIconCandidate(current.icon.candidates, { id: systemIconCandidateIdForTarget(target), label: '系统图标', icon }),
        },
      }))
    } catch (e) { setError(errorMessage(e, '获取系统图标失败')) }
    finally { setBusy(false) }
  }

  async function fetchFormWebIcons() {
    if (!client || !editing || !activeCategory) return
    const target = form.target.trim()
    const targetError = activeCategory.validateTarget(target)
    if (targetError) { setError(targetError); return }
    const session = webIconDiscovery.start()
    webIconAutoSelectRef.current = true
    setError(null)
    try {
      const result = await client.request<WebIconDiscoveryResult>('collections.web-icons.discover', { url: target }, {
        signal: session.abortController.signal,
        onProgress: (event, payload) => {
          if (event !== 'candidate') throw new Error(`未知网页图标进度事件: ${event}`)
          if (!webIconDiscovery.isCurrent(session)) return
          const iconCandidate = iconAppearanceCandidateFromWebIcon(payload)
          setForm(current => {
            const candidates = upsertIconCandidate(current.icon.candidates, iconCandidate)
            const shouldSelectCandidate = webIconAutoSelectRef.current
            if (shouldSelectCandidate) webIconAutoSelectRef.current = false
            return {
              ...current,
              icon: {
                ...current.icon,
                draftIcon: shouldSelectCandidate ? iconCandidate.icon || null : current.icon.draftIcon,
                draftCandidateId: shouldSelectCandidate ? iconCandidate.id : current.icon.draftCandidateId,
                draftDataUrl: shouldSelectCandidate ? iconCandidate.dataUrl : current.icon.draftDataUrl,
                candidates,
              },
            }
          })
          webIconDiscovery.reportCandidate(session)
        },
      })
      if (!webIconDiscovery.isCurrent(session)) return
      if (!result.candidates.length) throw new Error('未发现可用网页图标')
      const iconCandidates = result.candidates.map(iconAppearanceCandidateFromWebIcon)
      setForm(current => {
        const candidates = upsertIconCandidates(current.icon.candidates, iconCandidates)
        const selectedCandidate = iconCandidates.find(candidate => candidate.id === current.icon.draftCandidateId) || (webIconAutoSelectRef.current ? iconCandidates[0] : null)
        if (selectedCandidate && webIconAutoSelectRef.current) webIconAutoSelectRef.current = false
        if (!selectedCandidate) return { ...current, icon: { ...current.icon, candidates } }
        return { ...current, icon: { ...current.icon, draftIcon: selectedCandidate.icon || null, draftCandidateId: selectedCandidate.id, draftDataUrl: selectedCandidate.dataUrl, candidates } }
      })
    } catch (e) {
      if (webIconDiscovery.isCurrent(session)) setError(errorMessage(e, '获取网页图标失败'))
    }
    finally {
      if (webIconDiscovery.finish(session)) webIconAutoSelectRef.current = false
    }
  }

  async function pickFormIconImage() {
    if (!client || !editing) return
    setBusy(true); setError(null)
    try {
      const sourcePath = await invoke<string | null>('pick_image_path')
      if (!sourcePath) return
      const asset = await client.request<DesktopAsset>('collections.assets.import', { kind: 'icon', sourcePath })
      const icon: DesktopIcon = { kind: 'image', assetId: asset.id }
      setForm(current => ({
        ...current,
        icon: {
          draftIcon: icon,
          candidates: upsertIconCandidate(current.icon.candidates, { id: importedIconCandidateId(asset.id), label: '导入图片', icon }),
        },
      }))
    } catch (e) { setError(errorMessage(e, '导入图标图片失败')) }
    finally { setBusy(false) }
  }

  async function saveDesktopWallpaper(wallpaper: DesktopWallpaperState | null) {
    if (!client) return
    setBusy(true); setError(null)
    try {
      const nextDoc = await client.request<CategoryWorkspaceView>('collections.desktop.wallpaper.save', requestParams({ wallpaper }))
      setDoc(nextDoc)
      updateWallpaperDeckCategory(nextDoc)
    }
    catch (e) { setError(errorMessage(e, '保存壁纸失败')) }
    finally { setBusy(false) }
  }

  async function selectDesktopWallpaperPreset(presetId: string) {
    if (!doc.desktop.wallpaper || doc.desktop.wallpaper.activeId === presetId) return
    await saveDesktopWallpaper({ ...doc.desktop.wallpaper, activeId: presetId })
  }

  async function removeDesktopWallpaperPreset(presetId: string) {
    const wallpaper = doc.desktop.wallpaper
    if (!wallpaper) return
    const presets = wallpaper.presets.filter(preset => preset.id !== presetId)
    const activeId = wallpaper.activeId === presetId ? presets[0]?.id || '' : wallpaper.activeId
    await saveDesktopWallpaper(presets.length ? { activeId, presets } : null)
  }

  async function saveDesktopWallpaperPresetView(presetId: string, view: DesktopWallpaperView) {
    const wallpaper = doc.desktop.wallpaper
    if (!wallpaper) return
    await saveDesktopWallpaper(upsertDesktopWallpaperPresetView(wallpaper, presetId, view))
  }

  async function saveDesktopIconLayout(iconLayout: DesktopIconLayout) {
    if (!client) return
    setBusy(true); setError(null)
    try {
      const nextDoc = await client.request<CategoryWorkspaceView>('collections.desktop.icon-layout.save', requestParams({ iconLayout: normalizeDesktopIconLayout(iconLayout) }))
      setDoc(nextDoc)
      setIconLayoutDraft(nextDoc.desktop.iconLayout)
    }
    catch (e) { setIconLayoutDraft(null); setError(errorMessage(e, '保存图标布局失败')) }
    finally { setBusy(false) }
  }

  async function saveCategoryOrder(categoryOrder: CollectionViewCategoryId[]) {
    if (!client) return
    setBusy(true); setError(null)
    try {
      const nextDoc = await client.request<CategoryWorkspaceView>('collections.category-order.save', { categoryOrder })
      setDoc(nextDoc)
      setWallpaperDeck(current => current ? { ...current, schemaVersion: nextDoc.schemaVersion, dataVersion: nextDoc.dataVersion, categories: reorderWallpaperDeckCategories(current.categories, nextDoc.categoryOrder) } : wallpaperDeckFromWorkspace(nextDoc))
    }
    catch (e) { setError(errorMessage(e, '保存分类顺序失败')) }
    finally { setBusy(false) }
  }

  async function openAllViewSelector() {
    if (!client) return
    setBusy(true); setError(null)
    try {
      const candidates = await client.request<AllViewItemCandidate[]>('collections.all-view.candidates')
      setAllViewCandidates(candidates)
      setAllViewSelection(Object.fromEntries(doc.items.map(item => [allViewSelectionKey(sourceCategoryIdForItem(item), sourceItemIdForItem(item)), true])))
      setAllViewSelectorOpen(true)
    } catch (e) { setError(errorMessage(e, '加载可选图标失败')) }
    finally { setBusy(false) }
  }

  async function saveAllViewSelection() {
    if (!client) return
    const items = allViewCandidates
      .filter(candidate => allViewSelection[allViewSelectionKey(candidate.categoryId, candidate.item.id)])
      .map(candidate => ({ categoryId: candidate.categoryId, itemId: candidate.item.id }))
    setBusy(true); setError(null)
    try {
      setDoc(await client.request<CategoryWorkspaceView>('collections.all-view.selection.save', { items }))
      setAllViewSelectorOpen(false)
    } catch (e) { setError(errorMessage(e, '保存全部图标选择失败')) }
    finally { setBusy(false) }
  }

  async function removeItemFromAllView(item: CollectionItem) {
    if (!client) return
    const sourceKey = allViewSelectionKey(sourceCategoryIdForItem(item), sourceItemIdForItem(item))
    const items = doc.items
      .filter(current => allViewSelectionKey(sourceCategoryIdForItem(current), sourceItemIdForItem(current)) !== sourceKey)
      .map(current => ({ categoryId: sourceCategoryIdForItem(current), itemId: sourceItemIdForItem(current) }))
    setBusy(true); setError(null)
    try { setDoc(await client.request<CategoryWorkspaceView>('collections.all-view.selection.save', { items })); setConfirm(null); setContextMenu(null) }
    catch (e) { setError(errorMessage(e, '从全部中移除图标失败')) }
    finally { setBusy(false) }
  }

  async function pickWallpaperImage() {
    if (!client) return
    setBusy(true); setError(null)
    try {
      const sourcePath = await invoke<string | null>('pick_image_path')
      if (!sourcePath) return
      const asset = await client.request<DesktopAsset>('collections.assets.import', { kind: 'wallpaper', sourcePath })
      const preset = createDesktopWallpaperPreset({ id: createID(), name: deriveNameFromTarget(sourcePath), assetId: asset.id })
      const presets = [...(doc.desktop.wallpaper?.presets || []), preset]
      const nextDoc = await client.request<CategoryWorkspaceView>('collections.desktop.wallpaper.save', requestParams({ wallpaper: { activeId: preset.id, presets } }))
      setDoc(nextDoc)
      updateWallpaperDeckCategory(nextDoc)
    } catch (e) { setError(errorMessage(e, '导入壁纸失败')) }
    finally { setBusy(false) }
  }

  async function pickDataDir() {
    setBusy(true); setError(null)
    try { const next = await invoke<DataDirStatus | null>('pick_data_dir'); if (next) setStatus(next); await connect() }
    catch (e) { setPhase('failed'); setError(errorMessage(e, '切换数据目录失败')); await refreshStatus() }
    finally { setBusy(false) }
  }

  async function pickItemTarget() {
    if (!activeCategory) return
    const pickCommand = activeCategory.pickCommand
    if (!pickCommand) return
    setError(null)
    try {
      const target = await invoke<string | null>(pickCommand)
      if (target) setForm(current => ({ ...current, target, name: current.name || deriveNameFromTarget(target) }))
    } catch (e) { setError(errorMessage(e, activeCategory.pickError)) }
  }

  const allDesktopEntries = React.useMemo(() => isAllView ? buildAllDesktopGridEntries(doc) : buildDesktopGridEntries(doc, groupId), [doc, groupId, isAllView])
  const filteredEntries = React.useMemo(() => filterDesktopGridEntries(doc, allDesktopEntries, groupId, search), [allDesktopEntries, doc, groupId, search])
  const visibleIconLayout = iconLayoutDraft || doc.desktop.iconLayout
  const externalDesktopDragPreview = containerExtractDrag?.mode === 'desktop' ? containerExtractDrag.desktopDrag : null
  const containerSoftClosed = isContainerSoftClosedForExtractDrag(containerExtractDrag, containerView)
  const dropContainerHiddenItemId = extractedItemIdForContainerView(containerExtractDrag, containerDropView)
  const selectedGroup = doc.groups.find(group => group.id === groupId)

  return (
    <Box
      component="main"
      onClick={closeContextMenu}
      sx={{
        position: 'relative',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: 'background.default',
      }}
    >
      <DesktopWallpaper activeCategoryId={activeCategoryId} assetUrl={client?.assetUrl} deck={wallpaperDeck} />
      <Box sx={{ position: 'relative', zIndex: 1, minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TopBar
        activeCategoryId={activeCategoryId}
        busy={busy}
        categories={orderedViewCategoryDefinitions(doc.categoryOrder)}
        doc={doc}
        groupId={groupId}
        launchInfo={launchInfo}
        phase={phase}
        search={search}
        selectedGroup={selectedGroup}
        onCategoryChange={selectCategory}
        onAdd={openAdd}
        onAddContainer={openAddContainer}
        onOpenAllViewSelector={() => void openAllViewSelector()}
        onGroupChange={selectGroup}
        onOpenGroupEditor={() => openGroupEditor(selectedGroup)}
        onOpenSettings={() => setSettingsOpen(true)}
        onSearchChange={setSearch}
      />

      <StatusNotice
        busy={busy}
        error={error}
        phase={phase}
        status={status}
        onPickDataDir={pickDataDir}
        onRestart={() => void connect({ restartBackend: true })}
      />

      <FolderGridCanvas
        category={activeViewCategory}
        workspace={doc}
        allEntries={allDesktopEntries}
        assetUrl={client?.assetUrl}
        iconLayout={visibleIconLayout}
        entries={filteredEntries}
        externalDragPreview={externalDesktopDragPreview}
        externalDragState={desktopDrag}
        openContainer={activeDropContainer()}
        phase={phase}
        search={search}
        onAdd={openAdd}
        onOpen={openDesktopEntry}
        onContextMenu={setContextMenu}
        onLayoutCommit={patches => void saveDesktopLayouts(patches)}
        onDragCancel={handleDesktopDragCancel}
        onDragEnd={handleDesktopDragEnd}
        onDragMove={handleDesktopDragMove}
        onDragStart={handleDesktopDragStart}
        onReady={handleDesktopGridReady}
      />

      <DesktopDragHint containerExtractDrag={containerExtractDrag} drag={desktopDrag} />

      {error && phase === 'ready' ? <Alert severity="error" sx={{ mx: { xs: 1.5, sm: 2 }, mb: 1.5 }}>{error}</Alert> : null}

      <CollectionContextMenu
        busy={busy}
        canCreateContainer={!isAllView && Boolean(selectedGroup)}
        canEdit={phase === 'ready'}
        menu={contextMenu}
        groups={doc.groups}
        doc={doc}
        onClose={closeContextMenu}
        onCreateContainer={openAddContainer}
        onCreateGroup={() => openGroupEditor()}
        onCreateItem={openAdd}
        onOpen={openDesktopEntry}
        onEdit={openEdit}
        onEditContainer={openEditContainer}
        onMoveToContainer={(item, containerId) => void saveItemContainer([item.id], containerId)}
        onCopyToGroup={(item, targetGroupId) => void copyItemToGroup(item, targetGroupId)}
        onMoveToGroup={(item, targetGroupId) => void moveItemToGroup(item, targetGroupId)}
        onOpenItem={item => void openItem(item)}
        onRemoveFromContainer={item => void saveItemContainer([item.id], '')}
        onDelete={entry => setConfirm({ kind: entry.kind, id: entry.id, label: entry.name })}
      />

      {activeCategory ? <ItemDialog
        category={activeCategory}
        busy={busy}
        doc={doc}
        editing={editing}
        form={form}
        webIconDiscovery={webIconDiscovery.progress}
        assetUrl={client?.assetUrl}
        onChange={updateItemForm}
        onChangeIconDraft={updateFormIconDraft}
        onClose={closeItemDialog}
        onFetchSystemIcon={() => void fetchFormSystemIcon()}
        onFetchWebIcons={() => void fetchFormWebIcons()}
        onPasteIconImage={() => void pasteFormIconImage()}
        onPickIconImage={() => void pickFormIconImage()}
        onPickTarget={() => void pickItemTarget()}
        onResetIcon={() => updateFormIconDraft(null)}
        onSave={() => void saveItem()}
        onSelectIconCandidate={selectFormIconCandidate}
      /> : null}

      <GroupDialog
        busy={busy}
        doc={doc}
        editableGroups={doc.groups}
        open={groupEditorOpen}
        form={groupForm}
        onChange={setGroupForm}
        onClose={() => setGroupEditorOpen(false)}
        onDelete={group => setConfirm({ kind: 'group', id: group.id, label: group.name })}
        onMoveGroup={groupOrder => void saveGroupOrder(groupOrder)}
        onNew={() => setGroupForm(EMPTY_GROUP_FORM)}
        onSave={() => void saveGroup()}
      />

      <SettingsDialog
        busy={busy}
        doc={doc}
        open={settingsOpen}
        status={status}
        iconLayout={visibleIconLayout}
        assetUrl={client?.assetUrl}
        onClearWallpaper={() => void saveDesktopWallpaper(null)}
        onClose={() => setSettingsOpen(false)}
        onPickDataDir={pickDataDir}
        onPickWallpaper={() => void pickWallpaperImage()}
        onPreviewIconLayout={layout => setIconLayoutDraft(normalizeDesktopIconLayout(layout))}
        onRemoveWallpaperPreset={id => void removeDesktopWallpaperPreset(id)}
        onRestart={() => void connect({ restartBackend: true })}
        onSaveCategoryOrder={categoryOrder => void saveCategoryOrder(categoryOrder)}
        onSaveIconLayout={layout => void saveDesktopIconLayout(layout)}
        onSaveWallpaperPresetView={(id, view) => void saveDesktopWallpaperPresetView(id, view)}
        onSelectWallpaperPreset={id => void selectDesktopWallpaperPreset(id)}
      />

      <ContainerDialog
        busy={busy}
        open={containerEditorOpen}
        form={containerForm}
        editing={editingContainer}
        onChange={setContainerForm}
        onClose={() => { setContainerEditorOpen(false); setEditingContainer(null) }}
        onSave={() => void saveContainer()}
      />

      <AllViewSelectorDialog
        busy={busy}
        candidates={allViewCandidates}
        open={allViewSelectorOpen}
        selection={allViewSelection}
        onChange={setAllViewSelection}
        onClose={() => setAllViewSelectorOpen(false)}
        onSave={() => void saveAllViewSelection()}
      />

      <ContainerOverlay
        assetUrl={client?.assetUrl}
        closeDisabled={Boolean(containerExtractDrag)}
        container={containerView}
        dropTargetActive={isContainerDropTargetActive(desktopDrag, containerView)}
        doc={doc}
        onClose={() => setContainerView(null)}
        onDismissContextMenu={closeContextMenu}
        onGridReady={handleContainerGridReady}
        onItemDragCancel={handleContainerItemDragCancel}
        onItemDragEnd={handleContainerItemDragEnd}
        onItemDragMove={handleContainerItemDragMove}
        onItemDragStart={handleContainerItemDragStart}
        onLayoutCommit={patches => containerView ? void placeContainerItems(containerView.id, null, patches) : undefined}
        onContextMenu={(item, x, y) => openContainerItemContextMenu(containerView, item, x, y)}
        onOpenItem={item => void openItem(item)}
        onRemoveItem={item => void saveItemContainer([item.id], '')}
        onRename={(container, name) => renameContainer(container, name)}
        softClosed={containerSoftClosed}
      />

      <ContainerOverlay
        assetUrl={client?.assetUrl}
        closeDisabled={Boolean(containerExtractDrag)}
        container={containerDropView}
        dropTargetActive={isContainerDropTargetActive(desktopDrag, containerDropView)}
        doc={doc}
        hiddenItemId={dropContainerHiddenItemId}
        onClose={() => setContainerDropViewState(null)}
        onDismissContextMenu={closeContextMenu}
        onGridReady={handleContainerGridReady}
        onItemDragCancel={undefined}
        onItemDragEnd={undefined}
        onItemDragMove={undefined}
        onItemDragStart={undefined}
        onLayoutCommit={patches => containerDropView ? void placeContainerItems(containerDropView.id, null, patches) : undefined}
        onContextMenu={(item, x, y) => openContainerItemContextMenu(containerDropView, item, x, y)}
        onOpenItem={item => void openItem(item)}
        onRemoveItem={item => void saveItemContainer([item.id], '')}
        onRename={(container, name) => renameContainer(container, name)}
        softClosed={false}
      />

      <ConfirmDialog
        busy={busy}
        category={activeViewCategory}
        confirm={confirm}
        doc={doc}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return
          const item = doc.items.find(current => current.id === confirm.id)
          const container = doc.containers.find(current => current.id === confirm.id)
          if (confirm.kind === 'group') void removeGroup({ id: confirm.id, name: confirm.label })
          else if (confirm.kind === 'container' && container) void removeContainer(container)
          else if (confirm.kind === 'item' && item) void (isAllView ? removeItemFromAllView(item) : removeItem(item))
          else setConfirm(null)
        }}
      />
      </Box>
    </Box>
  )
}

function TopBar(props: {
  activeCategoryId: CollectionViewCategoryId
  busy: boolean
  categories: ViewCategoryDefinition[]
  doc: CategoryWorkspaceView
  groupId: string
  launchInfo: FwLaunchInfo
  phase: Phase
  search: string
  selectedGroup: CollectionGroup | undefined
  onCategoryChange(categoryId: CollectionViewCategoryId): void
  onAdd(): void
  onAddContainer(): void
  onGroupChange(groupId: string): void
  onOpenGroupEditor(): void
  onOpenAllViewSelector(): void
  onOpenSettings(): void
  onSearchChange(search: string): void
}) {
  const statusColor = props.phase === 'failed' ? 'error' : 'warning'
  const statusText = props.phase === 'data-error' ? '数据异常' : props.phase === 'failed' ? '需处理' : '启动中'
  const canEdit = props.phase === 'ready'
  const isAllView = props.activeCategoryId === ALL_VIEW_CATEGORY_ID
  const groupActionLabel = props.selectedGroup ? '编辑分组' : '新分组'

  return (
    <Paper
      square
      elevation={0}
      onPointerDown={event => { if (event.button === 0 && !isInteractiveTarget(event.target)) void appWindow.startDragging() }}
      sx={{
        minHeight: 56,
        px: { xs: 1.25, sm: 1.5 },
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        bgcolor: 'transparent',
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none',
        borderBottom: '1px solid transparent',
        boxShadow: 'none',
        userSelect: 'none',
        flexShrink: 0,
        flexWrap: { xs: 'wrap', md: 'nowrap' },
        py: { xs: 1, md: 0.75 },
      }}
    >
      <TopBarTools
        activeCategoryId={props.activeCategoryId}
        busy={props.busy}
        canEdit={canEdit}
        categories={props.categories}
        doc={props.doc}
        groupActionLabel={groupActionLabel}
        groupId={props.groupId}
        isAllView={isAllView}
        phase={props.phase}
        search={props.search}
        selectedGroup={props.selectedGroup}
        statusColor={statusColor}
        statusText={statusText}
        onAdd={props.onAdd}
        onAddContainer={props.onAddContainer}
        onCategoryChange={props.onCategoryChange}
        onGroupChange={props.onGroupChange}
        onOpenGroupEditor={props.onOpenGroupEditor}
        onOpenAllViewSelector={props.onOpenAllViewSelector}
        onOpenSettings={props.onOpenSettings}
        onSearchChange={props.onSearchChange}
      />
      <WindowControlsDock standalone={props.launchInfo.standalone} />
    </Paper>
  )
}

function TopBarTools(props: {
  activeCategoryId: CollectionViewCategoryId
  busy: boolean
  canEdit: boolean
  categories: ViewCategoryDefinition[]
  doc: CategoryWorkspaceView
  groupActionLabel: string
  groupId: string
  isAllView: boolean
  phase: Phase
  search: string
  selectedGroup: CollectionGroup | undefined
  statusColor: 'error' | 'warning'
  statusText: string
  onAdd(): void
  onAddContainer(): void
  onCategoryChange(categoryId: CollectionViewCategoryId): void
  onGroupChange(groupId: string): void
  onOpenGroupEditor(): void
  onOpenAllViewSelector(): void
  onOpenSettings(): void
  onSearchChange(search: string): void
}) {
  return (
    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ flex: '1 1 auto', minWidth: 0, flexWrap: { xs: 'wrap', md: 'nowrap' } }}>
      <TextField
        value={props.search}
        onChange={event => props.onSearchChange(event.target.value)}
        placeholder="按名称或路径搜索"
        size="small"
        sx={{ flex: { xs: '1 1 100%', sm: '0 1 130px' }, minWidth: { xs: '100%', sm: 110 }, maxWidth: { xs: '100%', sm: 130 } }}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }}
      />
      <ToggleButtonGroup
        exclusive
        size="small"
        value={props.activeCategoryId}
        onChange={(_, value: CollectionViewCategoryId | null) => { if (value) props.onCategoryChange(value) }}
        aria-label="收藏类别"
        sx={{
          bgcolor: 'rgba(255,255,255,0.64)',
          borderRadius: 3,
          p: 0.35,
          '& .MuiToggleButton-root': { border: 0, borderRadius: 2.5, px: 1.35, fontWeight: 900 },
        }}
      >
        {props.categories.map(category => {
          const CategoryIcon = category.icon
          return <ToggleButton key={category.id} value={category.id} aria-label={category.label}><CategoryIcon fontSize="small" sx={{ mr: 0.6 }} />{category.label}</ToggleButton>
        })}
      </ToggleButtonGroup>
      {props.isAllView ? null : <GroupFilterSelect doc={props.doc} groupId={props.groupId} onGroupChange={props.onGroupChange} />}
      {props.phase !== 'ready' ? <Chip color={props.statusColor} size="small" label={props.statusText} icon={props.phase === 'starting' ? <CircularProgress size={12} color="inherit" /> : undefined} /> : null}
      <TopBarActions
        busy={props.busy}
        canEdit={props.canEdit}
        canCreateContainer={!props.isAllView && Boolean(props.selectedGroup)}
        isAllView={props.isAllView}
        groupActionLabel={props.groupActionLabel}
        selectedGroup={props.selectedGroup}
        onAdd={props.onAdd}
        onAddContainer={props.onAddContainer}
        onOpenAllViewSelector={props.onOpenAllViewSelector}
        onOpenGroupEditor={props.onOpenGroupEditor}
        onOpenSettings={props.onOpenSettings}
      />
    </Stack>
  )
}

function TopBarActions(props: {
  busy: boolean
  canEdit: boolean
  canCreateContainer: boolean
  groupActionLabel: string
  isAllView: boolean
  selectedGroup: CollectionGroup | undefined
  onAdd(): void
  onAddContainer(): void
  onOpenAllViewSelector(): void
  onOpenGroupEditor(): void
  onOpenSettings(): void
}) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: '0 0 auto' }}>
      <Button variant="text" startIcon={<SettingsRoundedIcon />} onClick={props.onOpenSettings}>设置</Button>
      {props.isAllView ? <Button variant="contained" startIcon={<AppsRoundedIcon />} onClick={props.onOpenAllViewSelector} disabled={!props.canEdit || props.busy}>选择图标</Button> : null}
      {!props.isAllView ? <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={props.onAdd} disabled={!props.canEdit || props.busy}>新增</Button> : null}
      {!props.isAllView ? <Button variant="text" startIcon={<Inventory2RoundedIcon />} onClick={props.onAddContainer} disabled={!props.canEdit || props.busy || !props.canCreateContainer}>收纳夹</Button> : null}
      {!props.isAllView ? <Button
        variant="text"
        startIcon={props.selectedGroup ? <EditRoundedIcon /> : <CreateNewFolderRoundedIcon />}
        onClick={props.onOpenGroupEditor}
        disabled={!props.canEdit}
        sx={{ minWidth: 108 }}
      >
        {props.groupActionLabel}
      </Button> : null}
    </Stack>
  )
}

function WindowControlsDock(props: { standalone: boolean }) {
  if (!props.standalone) return null
  return (
    <Box sx={{ ml: 'auto', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', flex: '0 0 auto' }}>
      <WindowControls />
    </Box>
  )
}

function GroupFilterSelect(props: { doc: CategoryWorkspaceView; groupId: string; onGroupChange(groupId: string): void }) {
  const [open, setOpen] = React.useState(false)

  return (
    <FormControl variant="filled" size="small" sx={{ width: { xs: 'calc(50% - 6px)', sm: 180 }, minWidth: 148 }}>
      <InputLabel id="folders-group-filter-label">分组</InputLabel>
      <Select
        variant="filled"
        labelId="folders-group-filter-label"
        value={props.groupId}
        label="分组"
        open={open}
        onClose={() => setOpen(false)}
        onOpen={() => setOpen(true)}
        onMouseDown={event => {
          if (!open) return
          event.preventDefault()
          setOpen(false)
        }}
        onChange={(event: SelectChangeEvent) => {
          props.onGroupChange(event.target.value)
          setOpen(false)
        }}
      >
        {props.doc.groups.length ? props.doc.groups.map(group => <MenuItem key={group.id} value={group.id}>{group.name}</MenuItem>) : <MenuItem value="" disabled>暂无分组</MenuItem>}
      </Select>
    </FormControl>
  )
}

function AllViewSelectorDialog(props: {
  busy: boolean
  candidates: AllViewItemCandidate[]
  open: boolean
  selection: AllViewSelectionState
  onChange(selection: AllViewSelectionState): void
  onClose(): void
  onSave(): void
}) {
  const selectedCount = Object.values(props.selection).filter(Boolean).length
  const setSelected = (candidate: AllViewItemCandidate, selected: boolean) => {
    const key = allViewSelectionKey(candidate.categoryId, candidate.item.id)
    props.onChange({ ...props.selection, [key]: selected })
  }
  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="md">
      <DialogContent sx={{ p: 3 }}>
        <Stack spacing={2.25}>
          <Box>
            <Typography variant="h2">选择全部图标</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>从已建立的文件夹、网址和文件图标中选择要显示在“全部”里的项目。</Typography>
          </Box>
          <Paper elevation={0} sx={{ p: 1.25, borderRadius: 3, bgcolor: theme => alpha(theme.palette.primary.main, 0.06) }}>
            <ScrollArea sx={{ maxHeight: 420 }} viewportSx={{ display: 'grid', gap: 1 }}>
              {props.candidates.length ? props.candidates.map(candidate => {
                const category = categoryDefinition(candidate.categoryId)
                const CategoryIcon = category.icon
                const key = allViewSelectionKey(candidate.categoryId, candidate.item.id)
                const checked = Boolean(props.selection[key])
                return (
                  <Paper key={key} elevation={0} sx={{ p: 1.15, borderRadius: 2.5, display: 'flex', alignItems: 'center', gap: 1.25, bgcolor: checked ? 'rgba(37, 99, 235, 0.11)' : 'rgba(255,255,255,0.72)' }}>
                    <Checkbox checked={checked} onChange={event => setSelected(candidate, event.target.checked)} disabled={props.busy} inputProps={{ 'aria-label': `选择${candidate.item.name}` }} />
                    <Box sx={{ width: 32, height: 32, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: theme => alpha(theme.palette.primary.main, 0.12), color: 'primary.main', flex: '0 0 auto' }}>
                      <CategoryIcon fontSize="small" />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography fontWeight={900} noWrap>{candidate.item.name}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>{category.label} · {category.targetValue(candidate.item)}</Typography>
                    </Box>
                    <Chip size="small" label={category.label} />
                  </Paper>
                )
              }) : <Typography color="text.secondary" sx={{ p: 2 }}>还没有可选择的图标，请先在文件夹、网址或文件分类里新增项目。</Typography>}
            </ScrollArea>
          </Paper>
          <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center">
            <Chip size="small" label={`已选择 ${selectedCount} 个`} />
            <Stack direction="row" spacing={1}>
              <Button onClick={props.onClose}>取消</Button>
              <Button variant="contained" onClick={props.onSave} disabled={props.busy}>保存选择</Button>
            </Stack>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

function WindowControls() {
  return (
    <Stack direction="row" spacing={0.5} data-window-control>
      <Tooltip title="最小化"><IconButton aria-label="最小化" onClick={() => appWindow.minimize()}><HorizontalRuleRoundedIcon fontSize="small" /></IconButton></Tooltip>
      <Tooltip title="最大化或还原"><IconButton aria-label="最大化或还原" onClick={() => appWindow.toggleMaximize()}><WindowRoundedIcon fontSize="small" /></IconButton></Tooltip>
      <Tooltip title="隐藏到托盘"><IconButton aria-label="隐藏到托盘" onClick={() => invoke('hide_to_tray')}><CloseRoundedIcon fontSize="small" /></IconButton></Tooltip>
    </Stack>
  )
}

function StatusNotice(props: { busy: boolean; error: string | null; phase: Phase; status: DataDirStatus | null; onPickDataDir(): void; onRestart(): void }) {
  if (props.phase === 'starting') {
    return <Alert severity="info" icon={<CircularProgress size={18} />} sx={{ mx: { xs: 1.5, sm: 2 }, mb: 1 }}>正在连接收藏集后台...</Alert>
  }
  if (props.phase === 'data-error') {
    return (
      <Alert
        severity="warning"
        icon={<WarningAmberRoundedIcon />}
        sx={{ mx: { xs: 1.5, sm: 2 }, mb: 1, alignItems: 'flex-start' }}
        action={
          <Stack direction="row" spacing={1}>
            <Button color="inherit" size="small" onClick={props.onPickDataDir} disabled={props.busy}>数据目录</Button>
          </Stack>
        }
      >
        <Typography fontWeight={900}>数据文件需要处理</Typography>
        <Typography variant="body2">{props.error || '当前数据无法迁移到此版本。请检查数据目录，或选择其它数据目录。'}</Typography>
      </Alert>
    )
  }
  if (props.phase !== 'failed') return null
  return (
    <Alert
      severity="error"
      icon={<WarningAmberRoundedIcon />}
      sx={{ mx: { xs: 1.5, sm: 2 }, mb: 1, alignItems: 'flex-start' }}
      action={
        <Stack direction="row" spacing={1}>
          <Button color="inherit" size="small" onClick={props.onRestart} disabled={props.busy}>重试</Button>
          <Button color="inherit" size="small" onClick={props.onPickDataDir} disabled={props.busy}>数据目录</Button>
        </Stack>
      }
    >
      <Typography fontWeight={900}>后台暂不可用</Typography>
      <Typography variant="body2">{props.error || props.status?.error || '请重试或选择新的数据目录。'}</Typography>
    </Alert>
  )
}

function ItemDialog(props: {
  assetUrl?(assetId: string): string
  busy: boolean
  category: CategoryDefinition
  doc: CategoryWorkspaceView
  editing: CollectionItem | null
  form: CollectionItemFormState
  webIconDiscovery: WebIconDiscoveryProgress
  onChangeIconDraft(icon: DesktopIcon | null): void
  onChange(form: CollectionItemFormState): void
  onClose(): void
  onFetchWebIcons(): void
  onFetchSystemIcon(): void
  onPasteIconImage(): void
  onPickIconImage(): void
  onPickTarget(): void
  onResetIcon(): void
  onSave(): void
  onSelectIconCandidate(candidate: IconAppearanceCandidate): void
}) {
  const open = Boolean(props.editing)
  const targetValue = props.form.target.trim()
  const canFetchIcon = Boolean(targetValue) && !props.category.validateTarget(targetValue)
  const iconDisabledText = props.category.id === 'url' ? '请先填写有效网址' : '请先填写有效路径'
  return (
    <Dialog open={open} onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogContent sx={{ p: 3 }}>
        <Stack spacing={2.25}>
          <Box>
            <Typography variant="h2">{props.editing?.id ? `编辑${props.category.singularLabel}` : props.category.addLabel}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>保存常用{props.category.singularLabel}，之后可以一键打开。</Typography>
          </Box>
          <TextField
            label="名称"
            value={props.form.name}
            onChange={event => props.onChange({ ...props.form, name: event.target.value })}
            placeholder="例如：项目目录"
            fullWidth
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              label={props.category.targetLabel}
              value={props.form.target}
              onChange={event => props.onChange({ ...props.form, target: event.target.value })}
              placeholder={props.category.targetPlaceholder}
              autoFocus
              fullWidth
            />
            {props.category.pickCommand ? <Button variant="text" startIcon={<LaunchRoundedIcon />} onClick={props.onPickTarget} sx={{ minWidth: 96 }}>选择</Button> : null}
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems="flex-start">
            <FormControl variant="filled" fullWidth size="small" disabled={props.busy}>
              <InputLabel id="folder-dialog-group-label">所属分类页</InputLabel>
              <Select
                variant="filled"
                labelId="folder-dialog-group-label"
                label="所属分类页"
                value={props.form.groupId}
                onChange={event => props.onChange({ ...props.form, groupId: event.target.value })}
              >
                {props.doc.groups.length ? props.doc.groups.map(group => <MenuItem key={group.id} value={group.id}>{group.name}</MenuItem>) : <MenuItem value="" disabled>请先创建分组或填写新分组</MenuItem>}
              </Select>
            </FormControl>
            <TextField
              label="新分组（可选）"
              value={props.form.newGroupName}
              onChange={event => props.onChange({ ...props.form, newGroupName: event.target.value })}
              placeholder="输入新分组名"
              fullWidth
            />
          </Stack>
          <IconAppearancePanel
            assetUrl={props.assetUrl}
            busy={props.busy}
            icon={props.form.icon}
            seed={props.editing?.id || props.form.target || props.form.name || 'item-icon'}
            systemIconDisabledText={iconDisabledText}
            systemIconEnabled={canFetchIcon}
            targetKind={props.category.id}
            webIconDiscovery={props.webIconDiscovery}
            onChangeDraft={props.onChangeIconDraft}
            onFetchSystemIcon={props.onFetchSystemIcon}
            onFetchWebIcons={props.onFetchWebIcons}
            onPasteImage={props.onPasteIconImage}
            onPickImage={props.onPickIconImage}
            onReset={props.onResetIcon}
            onSelectCandidate={props.onSelectIconCandidate}
          />
          <Typography variant="caption" color="text.secondary">每个{props.category.singularLabel}只属于一个分组页；右键可打开、编辑、移动、复制或删除。</Typography>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button onClick={props.onClose}>取消</Button>
            <Button variant="contained" onClick={props.onSave} disabled={props.busy}>{props.editing?.id ? '保存' : '添加'}</Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

function GroupDialog(props: {
  busy: boolean
  doc: CategoryWorkspaceView
  editableGroups: CollectionGroup[]
  open: boolean
  form: GroupFormState
  onChange(form: GroupFormState): void
  onClose(): void
  onDelete(group: CollectionGroup): void
  onMoveGroup(groupOrder: string[]): void
  onNew(): void
  onSave(): void
}) {
  const selected = props.editableGroups.find(group => group.id === props.form.id)
  const [groupSortMode, setGroupSortMode] = React.useState(false)
  const groupIds = props.editableGroups.map(group => group.id)
  const moveGroup = (activeId: string, overId: string) => props.onMoveGroup(moveSortableId(groupIds, activeId, overId))

  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogContent sx={{ p: 3 }}>
        <Stack spacing={2.25}>
          <Box>
            <Typography variant="h2">{props.form.id ? '编辑分组' : '创建分组'}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>用分组把常用目录按场景收纳。</Typography>
          </Box>
          <TextField
            label="分组名称"
            value={props.form.name}
            onChange={event => props.onChange({ ...props.form, name: event.target.value })}
            placeholder="例如：工作"
            autoFocus
            fullWidth
          />
          {props.editableGroups.length ? (
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>已有分组</Typography>
                <SortModeButton enabled={groupSortMode} onClick={() => setGroupSortMode(current => !current)} disabled={props.busy || groupIds.length <= 1} />
              </Stack>
              <ScrollArea sx={{ maxHeight: 240 }} viewportSx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <SortableRoot onMove={moveGroup}>
                  <SortableSection items={groupIds}>
                    {props.editableGroups.map(group => {
                      const active = group.id === props.form.id
                      return (
                        <SortableItem key={group.id} id={group.id} disabled={!groupSortMode || props.busy}>
                          {({ setNodeRef, setHandleRef, handleProps, isDragging, style }) => (
                            <Paper
                              ref={setNodeRef}
                              elevation={active ? 1 : 0}
                              sx={{
                                borderRadius: 2,
                                bgcolor: active ? 'primary.main' : theme => alpha(theme.palette.primary.main, 0.06),
                                color: active ? 'primary.contrastText' : 'text.primary',
                                opacity: isDragging ? 0.55 : 1,
                                overflow: 'hidden',
                              }}
                              style={style}
                            >
                              <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minHeight: 42, px: 0.75 }}>
                                <SortHandleButton
                                  enabled={groupSortMode}
                                  label={`拖拽排序分组 ${group.name}`}
                                  handleRef={setHandleRef}
                                  handleProps={handleProps}
                                  isDragging={isDragging}
                                />
                                <ButtonBase
                                  onClick={() => props.onChange({ id: group.id, name: group.name })}
                                  sx={{
                                    flex: 1,
                                    minWidth: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 1,
                                    py: 0.75,
                                    textAlign: 'left',
                                  }}
                                >
                                  <Typography noWrap fontWeight={900}>{group.name}</Typography>
                                  <Chip size="small" label={`${groupItemCount(props.doc, group.id)} 个项目 · ${groupContainerCount(props.doc, group.id)} 个收纳夹`} />
                                </ButtonBase>
                              </Stack>
                            </Paper>
                          )}
                        </SortableItem>
                      )
                    })}
                  </SortableSection>
                </SortableRoot>
              </ScrollArea>
            </Stack>
          ) : null}
          <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap">
            {selected ? <Button color="error" startIcon={<DeleteOutlineRoundedIcon />} onClick={() => props.onDelete(selected)} disabled={props.busy}>删除分组</Button> : null}
            <Box sx={{ flex: 1 }} />
            <Button onClick={props.onNew}>新建</Button>
            <Button variant="contained" onClick={props.onSave} disabled={props.busy}>保存</Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

function SettingsDialog(props: {
  assetUrl?(assetId: string): string
  busy: boolean
  doc: CategoryWorkspaceView
  iconLayout: DesktopIconLayout
  open: boolean
  status: DataDirStatus | null
  onClearWallpaper(): void
  onClose(): void
  onPickDataDir(): void
  onPickWallpaper(): void
  onPreviewIconLayout(layout: DesktopIconLayout): void
  onRemoveWallpaperPreset(id: string): void
  onRestart(): void
  onSaveCategoryOrder(categoryOrder: CollectionViewCategoryId[]): void
  onSaveIconLayout(layout: DesktopIconLayout): void
  onSaveWallpaperPresetView(id: string, view: DesktopWallpaperView): void
  onSelectWallpaperPreset(id: string): void
}) {
  const iconLayout = normalizeDesktopIconLayout(props.iconLayout)
  const categories = orderedViewCategoryDefinitions(props.doc.categoryOrder)
  const [categorySortMode, setCategorySortMode] = React.useState(false)
  const updateDraftIconLayout = (patch: Partial<DesktopIconLayout>) => props.onPreviewIconLayout(normalizeDesktopIconLayout({ ...iconLayout, ...patch }))
  const saveDraftIconLayout = (patch: Partial<DesktopIconLayout>) => props.onSaveIconLayout(normalizeDesktopIconLayout({ ...iconLayout, ...patch }))
  const moveCategory = (activeId: string, overId: string) => props.onSaveCategoryOrder(moveSortableId(props.doc.categoryOrder, activeId as CollectionViewCategoryId, overId as CollectionViewCategoryId))

  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="md">
      <DialogContent sx={{ p: 3 }}>
        <Stack spacing={2.25}>
          <Box>
            <Typography variant="h2">设置</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>管理桌面图标、壁纸、数据目录和后台状态。</Typography>
          </Box>
          <Paper elevation={0} sx={{ p: 2, borderRadius: 3, bgcolor: theme => alpha(theme.palette.primary.main, 0.06) }}>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} alignItems="flex-start">
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography fontWeight={900}>分类顺序</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>调整顶部收藏类别的展示顺序，保存后会立即同步到主界面。</Typography>
                </Box>
                <SortModeButton enabled={categorySortMode} onClick={() => setCategorySortMode(current => !current)} disabled={props.busy || categories.length <= 1} />
              </Stack>
              <SortableRoot onMove={moveCategory}>
                <SortableSection items={props.doc.categoryOrder}>
                  <Stack spacing={1}>
                    {categories.map((category, index) => {
                      const CategoryIcon = category.icon
                      return (
                        <SortableItem key={category.id} id={category.id} disabled={!categorySortMode || props.busy}>
                          {({ setNodeRef, setHandleRef, handleProps, isDragging, style }) => (
                            <Paper
                              ref={setNodeRef}
                              elevation={0}
                              sx={{
                                p: 1.25,
                                borderRadius: 2.5,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1.25,
                                bgcolor: 'rgba(255,255,255,0.72)',
                                opacity: isDragging ? 0.55 : 1,
                              }}
                              style={style}
                            >
                              <SortHandleButton
                                enabled={categorySortMode}
                                label={`拖拽排序分类 ${category.label}`}
                                handleRef={setHandleRef}
                                handleProps={handleProps}
                                isDragging={isDragging}
                              />
                              <Box sx={{ width: 28, height: 28, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: theme => alpha(theme.palette.primary.main, 0.12), color: 'primary.main' }}>
                                <CategoryIcon fontSize="small" />
                              </Box>
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography fontWeight={900}>{category.label}</Typography>
                                <Typography variant="caption" color="text.secondary">第 {index + 1} 位</Typography>
                              </Box>
                            </Paper>
                          )}
                        </SortableItem>
                      )
                    })}
                  </Stack>
                </SortableSection>
              </SortableRoot>
            </Stack>
          </Paper>
          <Paper elevation={0} sx={{ p: 2, borderRadius: 3, bgcolor: theme => alpha(theme.palette.primary.main, 0.06) }}>
            <Stack spacing={1.75}>
              <Box>
                <Typography fontWeight={900}>桌面图标布局</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>控制桌面图标之间的行列间距，以及图标整体显示大小。</Typography>
              </Box>
              <Box sx={{ display: 'grid', gap: 2 }}>
                <Box>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                    <Typography fontWeight={800}>图标行间距</Typography>
                    <Chip size="small" label={`${iconLayout.rowGap}px`} />
                  </Stack>
                  <Slider
                    aria-label="图标行间距"
                    value={iconLayout.rowGap}
                    min={DESKTOP_ICON_GAP_MIN}
                    max={DESKTOP_ICON_GAP_MAX}
                    step={DESKTOP_ICON_GAP_STEP}
                    marks={[
                      { value: DESKTOP_ICON_GAP_MIN, label: `${DESKTOP_ICON_GAP_MIN}px` },
                      { value: DESKTOP_ICON_GAP_MAX, label: `${DESKTOP_ICON_GAP_MAX}px` },
                    ]}
                    valueLabelDisplay="auto"
                    valueLabelFormat={value => `${value}px`}
                    disabled={props.busy}
                    onChange={(_, value) => updateDraftIconLayout({ rowGap: Array.isArray(value) ? value[0] : value })}
                    onChangeCommitted={(_, value) => saveDraftIconLayout({ rowGap: Array.isArray(value) ? value[0] : value })}
                  />
                </Box>
                <Box>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                    <Typography fontWeight={800}>图标列间距</Typography>
                    <Chip size="small" label={`${iconLayout.columnGap}px`} />
                  </Stack>
                  <Slider
                    aria-label="图标列间距"
                    value={iconLayout.columnGap}
                    min={DESKTOP_ICON_GAP_MIN}
                    max={DESKTOP_ICON_GAP_MAX}
                    step={DESKTOP_ICON_GAP_STEP}
                    marks={[
                      { value: DESKTOP_ICON_GAP_MIN, label: `${DESKTOP_ICON_GAP_MIN}px` },
                      { value: DESKTOP_ICON_GAP_MAX, label: `${DESKTOP_ICON_GAP_MAX}px` },
                    ]}
                    valueLabelDisplay="auto"
                    valueLabelFormat={value => `${value}px`}
                    disabled={props.busy}
                    onChange={(_, value) => updateDraftIconLayout({ columnGap: Array.isArray(value) ? value[0] : value })}
                    onChangeCommitted={(_, value) => saveDraftIconLayout({ columnGap: Array.isArray(value) ? value[0] : value })}
                  />
                </Box>
                <Box>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                    <Typography fontWeight={800}>图标大小缩放</Typography>
                    <Chip size="small" label={`${Math.round(iconLayout.iconScale * 100)}%`} />
                  </Stack>
                  <Slider
                    aria-label="图标大小缩放"
                    value={iconLayout.iconScale}
                    min={DESKTOP_ICON_SCALE_MIN}
                    max={DESKTOP_ICON_SCALE_MAX}
                    step={DESKTOP_ICON_SCALE_STEP}
                    marks={[
                      { value: DESKTOP_ICON_SCALE_MIN, label: `${Math.round(DESKTOP_ICON_SCALE_MIN * 100)}%` },
                      { value: 1, label: '100%' },
                      { value: DESKTOP_ICON_SCALE_MAX, label: `${Math.round(DESKTOP_ICON_SCALE_MAX * 100)}%` },
                    ]}
                    valueLabelDisplay="auto"
                    valueLabelFormat={value => `${Math.round(value * 100)}%`}
                    disabled={props.busy}
                    onChange={(_, value) => updateDraftIconLayout({ iconScale: Array.isArray(value) ? value[0] : value })}
                    onChangeCommitted={(_, value) => saveDraftIconLayout({ iconScale: Array.isArray(value) ? value[0] : value })}
                  />
                </Box>
              </Box>
              <Stack direction="row" justifyContent="flex-end">
                <Button
                  startIcon={<RestartAltRoundedIcon />}
                  onClick={() => {
                    props.onPreviewIconLayout(DEFAULT_DESKTOP_ICON_LAYOUT)
                    props.onSaveIconLayout(DEFAULT_DESKTOP_ICON_LAYOUT)
                  }}
                  disabled={props.busy}
                >
                  恢复默认图标布局
                </Button>
              </Stack>
            </Stack>
          </Paper>
          <DesktopWallpaperSettings
            assetUrl={props.assetUrl}
            busy={props.busy}
            wallpaper={props.doc.desktop.wallpaper}
            onAddWallpaper={props.onPickWallpaper}
            onClearWallpaper={props.onClearWallpaper}
            onRemovePreset={props.onRemoveWallpaperPreset}
            onSavePresetView={props.onSaveWallpaperPresetView}
            onSelectPreset={props.onSelectWallpaperPreset}
          />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
            <InfoBlock label="当前数据目录" value={props.status?.dataDir || '读取中'} mono />
            <InfoBlock label="默认数据目录" value={props.status?.defaultDataDir || '读取中'} mono />
            <InfoBlock label="数据版本" value={`${props.doc.schemaVersion} / ${props.doc.dataVersion}`} />
            <InfoBlock label="可写状态" value={props.status?.writable ? '可写' : '不可写或未知'} />
          </Box>
          {props.status?.error ? <Alert severity="error" sx={{ mt: 2 }}>{props.status.error}</Alert> : null}
          <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap">
            <Button startIcon={<SplitscreenRoundedIcon />} onClick={props.onPickDataDir} disabled={props.busy}>选择数据目录</Button>
            <Button startIcon={<RestartAltRoundedIcon />} onClick={props.onRestart} disabled={props.busy}>重启后台</Button>
            <Button variant="contained" onClick={props.onClose}>完成</Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

function InfoBlock(props: { label: string; value: string; mono?: boolean }) {
  return (
    <Paper elevation={0} sx={{ p: 1.5, borderRadius: 2.5, minWidth: 0, bgcolor: theme => alpha(theme.palette.primary.main, 0.06) }}>
      <Typography variant="caption" color="text.secondary">{props.label}</Typography>
      <Typography sx={{ mt: 0.5, overflowWrap: 'anywhere', fontFamily: props.mono ? 'ui-monospace, SFMono-Regular, Consolas, monospace' : undefined }}>{props.value}</Typography>
    </Paper>
  )
}

function ConfirmDialog(props: { busy: boolean; category: ViewCategoryDefinition; confirm: ConfirmState; doc: CategoryWorkspaceView; onClose(): void; onConfirm(): void }) {
  const matchingGroupItemCount = props.confirm?.kind === 'group' ? groupItemCount(props.doc, props.confirm.id) : 0
  const matchingGroupContainerCount = props.confirm?.kind === 'group' ? groupContainerCount(props.doc, props.confirm.id) : 0
  const remainingGroups = props.confirm?.kind === 'group' ? props.doc.groups.filter(group => group.id !== props.confirm?.id) : []
  const groupObjectCount = matchingGroupItemCount + matchingGroupContainerCount
  const groupCannotBeRemoved = props.confirm?.kind === 'group' && groupObjectCount > 0 && remainingGroups.length === 0
  const containerItemCount = props.confirm?.kind === 'container' ? props.doc.items.filter(item => item.containerId === props.confirm?.id).length : 0
  const message = props.confirm?.kind === 'group'
    ? groupCannotBeRemoved
      ? `分组“${props.confirm.label}”是最后一个有内容的分组。请先创建另一个分组，或清空里面的 ${matchingGroupItemCount} 个${props.category.singularLabel}和 ${matchingGroupContainerCount} 个收纳夹。`
      : remainingGroups.length
        ? `删除分组“${props.confirm.label}”？其中 ${matchingGroupItemCount} 个${props.category.singularLabel}和 ${matchingGroupContainerCount} 个收纳夹会移动到“${remainingGroups[0].name}”。`
        : `删除空分组“${props.confirm.label}”？删除后当前分类会暂时没有分组。`
    : props.confirm?.kind === 'container'
      ? `删除收纳夹“${props.confirm.label}”？夹内 ${containerItemCount} 个项目会移回桌面。`
      : `删除${props.category.singularLabel}“${props.confirm?.label || ''}”？`
  const title = '确认删除'
  const confirmLabel = '确认删除'
  return (
    <Dialog open={Boolean(props.confirm)} onClose={props.onClose} fullWidth maxWidth="xs">
      <DialogContent sx={{ p: 3 }}>
        <Stack spacing={2.25}>
          <Box>
            <Typography variant="h2">{title}</Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {message}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button onClick={props.onClose}>取消</Button>
            <Button color="error" variant="contained" onClick={props.onConfirm} disabled={props.busy || groupCannotBeRemoved}>{confirmLabel}</Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
