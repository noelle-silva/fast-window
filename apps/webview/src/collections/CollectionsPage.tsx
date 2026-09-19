import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Box } from '@mui/material'
import { URL_CATEGORY } from './categoryRegistry'
import { parseClipboardTextTarget } from './clipboardTextTarget'
import { clipboardImageDataUrlFromClipboard, clipboardImageDataUrlFromPasteEvent } from './clipboardImage'
import { CollectionContextMenu } from './CollectionContextMenu'
import { ConfirmDialog } from './ConfirmDialog'
import { ContainerOverlay } from './ContainerOverlay'
import { ContainerDialog } from './DesktopDialogs'
import { DesktopDragHint } from './DesktopDragHint'
import { DesktopWallpaper } from './DesktopWallpaper'
import { GroupDialog } from './GroupDialog'
import { ItemDialog } from './ItemDialog'
import { MainTopbar } from './MainTopbar'
import { SettingsDialog } from './SettingsDialog'
import { StatusNotice } from './StatusNotice'
import { useToast } from './toast'
import { createCollectionsClient } from './collectionsClient'
import { iconAppearanceCandidateFromWebIcon, importedIconCandidateId, upsertIconCandidate, upsertIconCandidates } from './iconAppearanceModel'
import { ScrollArea } from './shared/scroll-area'
import { resolveContainerDropSurface } from './containerDropResolution'
import type { ContainerExtractDragState } from './containerExtractDragState'
import { applyContainerItemDesktopExtractionView, extractedItemIdForContainerView, isContainerSoftClosedForExtractDrag, resolveContainerExtractDragMode, resolveContainerExtractNextDragMode } from './containerExtractDragState'
import type { DesktopDragState } from './desktopDragState'
import { isContainerDropTargetActive, resolveDesktopDragMode, resolveDesktopDropIntent } from './desktopDragState'
import { createDesktopWallpaperPreset, upsertDesktopWallpaperPresetView } from './desktopWallpaperPresets'
import type { ContainerGridApi, ContainerGridPlacement } from './folder-grid/ContainerGridCanvas'
import { FolderGridCanvas, type DesktopGridApi, type DesktopGridDragEvent, type DesktopGridExternalItemDrag, type DesktopGridLayoutPatch } from './folder-grid/FolderGridCanvas'
import { buildDesktopGridEntries, filterDesktopGridEntries } from './folder-grid/desktopEntries'
import { normalizeDesktopIconLayout } from './folder-grid/iconLayout'
import { groupIdForPage } from './groupMembership'
import { resolveGroupSelection } from './groupSelection'
import { assertItemCreationTarget, containerItemCreationTarget, desktopItemCreationTarget, type ItemCreationTarget } from './itemCreationTarget'
import { useCollectionShortcutNavigation } from './useCollectionShortcutNavigation'
import { useWebIconDiscoverySession } from './webIconDiscoverySession'
import type {
  CollectionContainer,
  CollectionGroup,
  CollectionItem,
  ConfirmState,
  ContainerFormState,
  ContextMenuState,
  DataDirStatus,
  DesktopAsset,
  DesktopGridEntry,
  DesktopIcon,
  DesktopIconLayout,
  DirectClient,
  CollectionItemFormState,
  CollectionsHealth,
  BlankContextMenuState,
  IconAppearanceCandidate,
  FwLaunchInfo,
  GroupFormState,
  Phase,
  WebIconDiscoveryResult,
  WorkspaceUiState,
  WorkspaceView,
} from './types'
import {
  DEFAULT_GROUP_ID,
  DEFAULT_LAUNCH_INFO,
  DEFAULT_WORKSPACE_VIEW,
  EMPTY_ITEM_FORM,
  EMPTY_CONTAINER_FORM,
  EMPTY_GROUP_FORM,
  createEmptyItemForm,
  createGroupID,
  createID,
  deriveNameFromTarget,
  errorMessage,
  isInteractiveTarget,
  itemFormFromItem,
  itemTemplate,
} from './utils'

const CONTAINER_HOVER_OPEN_MS = 520

export type CollectionsPageHandle = { openSettings(): void }

export const CollectionsPage = React.forwardRef<CollectionsPageHandle, object>(function CollectionsPage(_props, ref) {
  const { showToast } = useToast()
  const [launchInfo, setLaunchInfo] = React.useState<FwLaunchInfo>(DEFAULT_LAUNCH_INFO)
  const [status, setStatus] = React.useState<DataDirStatus | null>(null)
  const [client, setClient] = React.useState<DirectClient | null>(null)
  const [doc, setDoc] = React.useState<WorkspaceView>(DEFAULT_WORKSPACE_VIEW)
  const [phase, setPhase] = React.useState<Phase>('starting')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const [groupId, setGroupId] = React.useState(DEFAULT_GROUP_ID)
  const [editing, setEditing] = React.useState<CollectionItem | null>(null)
  const [form, setForm] = React.useState<CollectionItemFormState>(EMPTY_ITEM_FORM)
  const webIconDiscovery = useWebIconDiscoverySession()
  const webIconAutoSelectRef = React.useRef(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [groupEditorOpen, setGroupEditorOpen] = React.useState(false)
  const [groupForm, setGroupForm] = React.useState<GroupFormState>(EMPTY_GROUP_FORM)
  const [containerEditorOpen, setContainerEditorOpen] = React.useState(false)
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

  React.useImperativeHandle(ref, () => ({ openSettings: () => setSettingsOpen(true) }), [])

  const cancelWebIconDiscovery = React.useCallback(() => {
    webIconAutoSelectRef.current = false
    webIconDiscovery.cancel()
  }, [webIconDiscovery])

  const refreshStatus = React.useCallback(async () => {
    const next = await invoke<DataDirStatus>('data_dir_status').catch(() => null)
    setStatus(next)
    return next
  }, [])

  const connect = React.useCallback(async () => {
    cancelWebIconDiscovery()
    setBusy(true); setError(null); setPhase('starting'); client?.close(); setClient(null)
    try {
      const nextClient = await createCollectionsClient()
      const health = await nextClient.request<CollectionsHealth>('collections.health')
      if (!health.data.ok) {
        setClient(nextClient); setPhase('data-error'); setError(health.data.error || '数据文件无法升级到此版本'); await refreshStatus()
        return
      }
      const uiState = await nextClient.request<WorkspaceUiState>('collections.ui-state.get')
      const nextDoc = await nextClient.request<WorkspaceView>('collections.workspace.get')
      const initialGroupId = resolveGroupSelection(nextDoc, uiState.groupId)
      setClient(nextClient); setDoc(nextDoc); setGroupId(initialGroupId); setPhase('ready'); await refreshStatus()
    } catch (e) {
      setPhase('failed'); setError(errorMessage(e, '加载收藏数据失败')); await refreshStatus()
    } finally { setBusy(false) }
  }, [cancelWebIconDiscovery, client, refreshStatus])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const nextLaunchInfo = await invoke<FwLaunchInfo>('fw_launch_info').catch(() => DEFAULT_LAUNCH_INFO)
      if (!cancelled) setLaunchInfo(nextLaunchInfo)
      await connect()
    })()
    return () => { cancelled = true }
  }, [])

  React.useEffect(() => () => client?.close(), [client])
  React.useEffect(() => {
    if (!settingsOpen) setIconLayoutDraft(null)
  }, [settingsOpen])
  React.useEffect(() => {
    const resolvedGroupId = resolveGroupSelection(doc, groupId)
    if (resolvedGroupId === groupId) return
    setGroupId(resolvedGroupId)
    void client?.request('collections.ui-state.save', { uiState: { groupId: resolvedGroupId } }).catch(e => showToast(errorMessage(e, '保存上次分组失败'), 'error'))
  }, [client, doc, groupId])
  React.useEffect(() => {
    if (!editing || !client) return
    const onPaste = (event: ClipboardEvent) => {
      void (async () => {
        const dataUrl = await clipboardImageDataUrlFromPasteEvent(event)
        if (!dataUrl) return
        event.preventDefault()
        setBusy(true)
        try { await importIconDataUrl(dataUrl, '剪贴板图片') }
        catch (e) { showToast(errorMessage(e, '粘贴剪贴板图片失败'), 'error') }
        finally { setBusy(false) }
      })()
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [client, editing])
  React.useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || phase !== 'ready' || busy || !client) return
      if (editing || settingsOpen || groupEditorOpen || containerEditorOpen || confirm || containerView || containerDropView || desktopDrag || containerExtractDrag) return
      if (isInteractiveTarget(event.target)) return
      const text = event.clipboardData?.getData('text/plain') || ''
      if (!text.trim()) return
      event.preventDefault()
      void createItemFromClipboardText(text)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [busy, client, confirm, containerDropView, containerEditorOpen, containerExtractDrag, containerView, desktopDrag, doc, editing, groupEditorOpen, groupId, phase, settingsOpen])
  React.useEffect(() => {
    const close = () => setContextMenu(null)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true) }
  }, [])
  React.useEffect(() => () => clearHoverOpenTimer(), [])

  useCollectionShortcutNavigation({
    enabled: phase === 'ready',
    workspace: doc,
    groupId,
    onSelectGroup: selectGroup,
  })

  function closeItemDialog() {
    cancelWebIconDiscovery()
    setEditing(null)
  }

  function updateItemForm(nextForm: CollectionItemFormState) {
    if (nextForm.target !== form.target) cancelWebIconDiscovery()
    setForm(nextForm)
  }

  function openAdd() {
    openAddFromTarget(() => desktopItemCreationTarget(doc, resolveGroupSelection(doc, groupId)))
  }

  function openAddInContainer(container: CollectionContainer) {
    openAddFromTarget(() => containerItemCreationTarget(doc, container))
  }

  function openAddFromTarget(resolveTarget: () => ItemCreationTarget) {
    cancelWebIconDiscovery()
    try {
      const target = resolveTarget()
      setEditing(itemTemplate(target.groupId, target.containerId))
      setForm(createEmptyItemForm(target.groupId))
    } catch (e) {
      showToast(errorMessage(e, '请先创建分组，再添加收藏项'), 'error')
    }
  }

  function openEdit(item: CollectionItem) {
    cancelWebIconDiscovery()
    setEditing(item); setForm(itemFormFromItem(item)); setContextMenu(null)
  }

  function openAddContainer() {
    if (!resolveGroupSelection(doc, groupId)) { showToast('请先创建分组，再添加收纳夹', 'error'); return }
    setEditingContainer(null)
    setContainerForm({ ...EMPTY_CONTAINER_FORM })
    setContainerEditorOpen(true)
  }

  function openEditContainer(container: CollectionContainer) {
    setEditingContainer(container)
    setContainerForm({ id: container.id, name: container.name })
    setContainerEditorOpen(true)
    setContextMenu(null)
  }

  async function saveItem() {
    if (!client || !editing) return
    const category = URL_CATEGORY
    const targetValue = form.target.trim()
    const targetError = category.validateTarget(targetValue)
    if (targetError) { showToast(targetError, 'error'); return }
    const name = (form.name.trim() || deriveNameFromTarget(targetValue)).trim()
    if (!name) { showToast('名称不能为空', 'error'); return }
    cancelWebIconDiscovery()
    setBusy(true)
    try {
      let targetGroupId = groupIdForPage(form.groupId)
      const newGroupName = form.newGroupName.trim()
      if (editing.containerId) {
        if (newGroupName) { showToast('收纳夹内项目跟随收纳夹分组，不能新建分组', 'error'); return }
        try { assertItemCreationTarget(doc, { groupId: targetGroupId, containerId: editing.containerId }) }
        catch (e) { showToast(errorMessage(e, '收纳夹内项目必须属于收纳夹所在分组'), 'error'); return }
      }
      let targetDoc = doc
      if (newGroupName) {
        const newGroupId = createGroupID()
        const afterGroupAdd = await client.request<WorkspaceView>('collections.groups.add', { group: { id: newGroupId, name: newGroupName } })
        setDoc(afterGroupAdd)
        targetDoc = afterGroupAdd
        targetGroupId = newGroupId
      }
      if (!newGroupName && !doc.groups.some(group => group.id === targetGroupId)) { showToast('请选择有效分组', 'error'); return }
      assertItemCreationTarget(targetDoc, { groupId: targetGroupId, containerId: editing.containerId })
      const now = Date.now()
      const nowText = new Date(now).toISOString()
      const draftIcon = await resolveFormDraftIcon()
      const payload = {
        id: editing.id || createID(),
        name,
        target: category.buildTarget(targetValue),
        groupId: targetGroupId,
        pageOrder: editing.pageOrder,
        containerId: editing.containerId,
        createdAt: editing.createdAt || nowText,
        updatedAt: nowText,
        createdAtMs: editing.createdAtMs || now,
        updatedAtMs: now,
        layout: editing.layout,
        icon: draftIcon,
      }
      const nextDoc = await client.request<WorkspaceView>(editing.id ? 'collections.items.update' : 'collections.items.add', { item: payload })
      setDoc(nextDoc); setEditing(null)
      if (newGroupName) selectResolvedGroup(targetGroupId)
    } catch (e) { showToast(errorMessage(e, `保存${category.singularLabel}失败`), 'error') } finally { setBusy(false) }
  }

  async function createItemFromClipboardText(text: string) {
    if (!client) return
    const parsed = parseClipboardTextTarget(text)
    if (!parsed) {
      showToast('不支持此粘贴内容：仅支持 http/https 网址', 'warning')
      return
    }
    setBusy(true); setContextMenu(null)
    try {
      const targetGroupId = resolveGroupSelection(doc, groupId)
      if (!targetGroupId) throw new Error('请先创建分组，再粘贴创建图标')
      const now = Date.now()
      const itemId = createID()
      let nextDoc = await client.request<WorkspaceView>('collections.items.add', { item: {
        id: itemId,
        name: parsed.name.trim() || deriveNameFromTarget(parsed.target),
        target: URL_CATEGORY.buildTarget(parsed.target),
        groupId: targetGroupId,
        pageOrder: 0,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        createdAtMs: now,
        updatedAtMs: now,
        icon: null,
      } })
      let warning: string | undefined
      try {
        const icon = await firstClipboardIcon(parsed.target)
        nextDoc = await client.request<WorkspaceView>('collections.icon.save', { id: itemId, icon })
      } catch (e) {
        warning = `自动图标获取失败：${errorMessage(e, '未知错误')}`
      }
      setDoc(nextDoc)
      setSearch('')
      showToast(warning ? `已创建网址：${parsed.name}；${warning}` : `已创建网址并应用图标：${parsed.name}`, warning ? 'warning' : 'success')
    } catch (e) {
      showToast(errorMessage(e, '粘贴内容不支持创建图标'), 'warning')
    } finally { setBusy(false) }
  }

  async function firstClipboardIcon(url: string): Promise<DesktopIcon> {
    if (!client) throw new Error('收藏数据通道未连接')
    const result = await client.request<WebIconDiscoveryResult>('collections.web-icons.discover', { url })
    const candidate = result.candidates[0]
    if (!candidate?.assetId) throw new Error('未发现可用网页图标')
    return { kind: 'image', assetId: candidate.assetId }
  }

  async function removeItem(item: CollectionItem) {
    if (!client) return
    setBusy(true)
    try { setDoc(await client.request<WorkspaceView>('collections.items.remove', { id: item.id })); setConfirm(null); setContextMenu(null) }
    catch (e) { showToast(errorMessage(e, `删除${URL_CATEGORY.singularLabel}失败`), 'error') }
    finally { setBusy(false) }
  }

  async function openItem(item: CollectionItem) {
    if (!client) return
    setBusy(true); setContextMenu(null)
    try { await client.request('collections.items.open', { id: item.id }) }
    catch (e) { showToast(errorMessage(e, URL_CATEGORY.openError), 'error') }
    finally { setBusy(false) }
  }

  async function moveItemToGroup(item: CollectionItem, targetGroupId: string) {
    if (!client || item.groupId === targetGroupId) return
    setBusy(true)
    try { setDoc(await client.request<WorkspaceView>('collections.items.move-to-group', { id: item.id, groupId: targetGroupId })); setContextMenu(null) }
    catch (e) { showToast(errorMessage(e, '移动到分组失败'), 'error') }
    finally { setBusy(false) }
  }

  async function copyItemToGroup(item: CollectionItem, targetGroupId: string) {
    if (!client || item.groupId === targetGroupId) return
    setBusy(true)
    try { setDoc(await client.request<WorkspaceView>('collections.items.copy-to-group', { id: item.id, groupId: targetGroupId })); setContextMenu(null) }
    catch (e) { showToast(errorMessage(e, '复制到分组失败'), 'error') }
    finally { setBusy(false) }
  }

  async function saveItemContainer(ids: string[], containerId: string) {
    if (!client || !ids.length) return
    setBusy(true)
    try { setDoc(await client.request<WorkspaceView>('collections.items.container.save', { ids, containerId })); setContextMenu(null) }
    catch (e) { showToast(errorMessage(e, '移动到收纳夹失败'), 'error') }
    finally { setBusy(false) }
  }

  async function createContainerFromItems(sourceItemId: string, targetItemId: string, layout: NonNullable<CollectionItem['layout']>) {
    if (!client) return
    setBusy(true)
    try {
      const nextDoc = await client.request<WorkspaceView>('collections.containers.create-from-items', { sourceItemId, targetItemId, layout })
      setDoc(nextDoc)
      const movedItem = nextDoc.items.find(item => item.id === sourceItemId)
      const nextContainer = movedItem?.containerId ? nextDoc.containers.find(container => container.id === movedItem.containerId) : null
      setContainerDropViewState(null)
      if (nextContainer) setContainerView(nextContainer)
    } catch (e) { showToast(errorMessage(e, '自动创建收纳夹失败'), 'error') }
    finally { setBusy(false) }
  }

  async function placeContainerItems(containerId: string, movedId: string | null, placements: ContainerGridPlacement[]) {
    if (!client || !placements.length) return
    const previousDoc = doc
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
      const nextDoc = await client.request<WorkspaceView>('collections.container.items.place', { containerId, movedId: movedId || undefined, items: placements })
      setDoc(nextDoc)
    } catch (e) {
      setDoc(previousDoc)
      showToast(errorMessage(e, '保存收纳夹布局失败'), 'error')
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

  function openContainerBlankContextMenu(container: CollectionContainer | null, x: number, y: number) {
    if (!container) throw new Error('container blank context menu missing container')
    setContextMenu({ kind: 'container-blank', container, x, y })
  }

  function createItemFromContextMenu(menu: BlankContextMenuState) {
    if (menu.kind === 'container-blank') openAddInContainer(menu.container)
    else openAdd()
  }

  async function saveDesktopLayouts(patches: DesktopGridLayoutPatch[]) {
    if (!client || patches.length === 0) return
    const previousDoc = doc
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
      const nextDoc = await client.request<WorkspaceView>('collections.desktop.layout.save', { groupId, items: patches })
      setDoc(nextDoc)
    } catch (e) {
      setDoc(previousDoc)
      showToast(errorMessage(e, '保存桌面布局失败'), 'error')
    }
  }

  async function extractContainerItemToDesktop(containerId: string, itemId: string, patches: DesktopGridLayoutPatch[]) {
    if (!client || patches.length === 0) return
    const previousDoc = doc
    const previousContainerView = containerView
    let optimisticDoc: WorkspaceView
    try {
      optimisticDoc = applyContainerItemDesktopExtractionView(doc, containerId, itemId, patches)
    } catch (e) {
      showToast(errorMessage(e, '移出到桌面失败'), 'error')
      return
    }
    setContainerDropViewState(null)
    setContainerView(null)
    setDoc(optimisticDoc)
    try {
      const nextDoc = await client.request<WorkspaceView>('collections.container.item.extract-to-desktop', { containerId, itemId, items: patches })
      setDoc(nextDoc)
    } catch (e) {
      setDoc(previousDoc)
      setContainerView(previousContainerView)
      showToast(errorMessage(e, '移出到桌面失败'), 'error')
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

  type ContainerDropResolution =
    | { kind: 'icon' }
    | { kind: 'grid'; placements: ContainerGridPlacement[] }
    | { kind: 'invalid' }

  function resolveContainerDrop(containerId: string, event: DesktopGridDragEvent, movedItemId: string, openContainer: CollectionContainer | null): ContainerDropResolution {
    const containerGrid = latestContainerGridApi(containerId)
    const surface = resolveContainerDropSurface(containerId, openContainer, Boolean(containerGrid))
    if (surface === 'icon') return { kind: 'icon' }
    if (!containerGrid) {
      showToast('收纳夹投放区域尚未就绪，请重新拖入', 'error')
      return { kind: 'invalid' }
    }
    const dropLayout = containerGrid.layoutFromClientPoint(event.clientX, event.clientY, event.offsetX, event.offsetY)
    if (!dropLayout) return { kind: 'invalid' }
    const placements = containerGrid.placementsForDrop(movedItemId, dropLayout)
    if (!placements.some(placement => placement.id === movedItemId)) {
      showToast('收纳夹投放布局缺少当前拖拽图标', 'error')
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

  function handleContainerGridReady(containerId: string, instanceId: string, api: ContainerGridApi | null) {
    const apis = containerGridApiByIdRef.current.get(containerId) || new Map<string, ContainerGridApi>()
    if (api) {
      apis.set(instanceId, api)
      containerGridApiByIdRef.current.set(containerId, apis)
      return
    }
    apis.delete(instanceId)
    if (apis.size) containerGridApiByIdRef.current.set(containerId, apis)
    else containerGridApiByIdRef.current.delete(containerId)
  }

  function handleDesktopGridReady(api: DesktopGridApi | null) {
    desktopGridApiRef.current = api
  }

  function handleDesktopDragCancel() {
    clearHoverOpenTimer()
    setDesktopDragState(null)
  }

  function toDesktopExternalDrag(event: ContainerItemDragEventLike): DesktopGridExternalItemDrag {
    return { item: event.item, clientX: event.clientX, clientY: event.clientY, offsetX: event.offsetX, offsetY: event.offsetY, modifiers: event.modifiers }
  }

  function handleContainerItemDragStart(event: ContainerItemDragEventLike) {
    if (!containerView) return
    if (event.item.containerId !== containerView.id) {
      showToast(`收藏项不在当前收纳夹中：${event.item.name}`, 'error')
      return
    }
    setContainerDropViewState(null)
    setDesktopDragState(null)
    setContainerExtractDragState({ containerId: containerView.id, item: event.item, mode: 'container' })
  }

  function handleContainerItemDragMove(event: ContainerItemDragEventLike) {
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

  function handleContainerItemDragEnd(event: ContainerItemDragEventLike, patches: ContainerGridPlacement[]) {
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
      showToast('桌面投放位置不可用，请重新拖出', 'error')
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
      showToast('桌面投放布局缺少拖出图标，请重新拖出', 'error')
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

  function openGroupEditor(group?: CollectionGroup) {
    setGroupForm(group ? { id: group.id, name: group.name } : EMPTY_GROUP_FORM); setGroupEditorOpen(true)
  }

  async function saveGroup() {
    if (!client) return
    const name = groupForm.name.trim()
    if (!name) { showToast('分组名称不能为空', 'error'); return }
    const id = groupForm.id || createGroupID()
    setBusy(true)
    try {
      const method = groupForm.id ? 'collections.groups.update' : 'collections.groups.add'
      setDoc(await client.request<WorkspaceView>(method, { group: { id, name } }))
      setGroupEditorOpen(false)
    } catch (e) { showToast(errorMessage(e, '保存分组失败'), 'error') } finally { setBusy(false) }
  }

  async function removeGroup(group: CollectionGroup) {
    if (!client) return
    setBusy(true)
    try {
      const nextDoc = await client.request<WorkspaceView>('collections.groups.remove', { id: group.id })
      setDoc(nextDoc); setConfirm(null); setGroupEditorOpen(false)
      if (groupId === group.id) selectResolvedGroup(resolveGroupSelection(nextDoc, ''))
    } catch (e) { showToast(errorMessage(e, '删除分组失败'), 'error') } finally { setBusy(false) }
  }

  async function saveGroupOrder(groupOrder: string[]) {
    if (!client) return
    setBusy(true)
    try {
      const nextDoc = await client.request<WorkspaceView>('collections.groups.order.save', { groupOrder })
      setDoc(nextDoc)
      selectResolvedGroup(resolveGroupSelection(nextDoc, groupId))
    } catch (e) { showToast(errorMessage(e, '保存分组顺序失败'), 'error') } finally { setBusy(false) }
  }

  async function saveContainer() {
    if (!client) return
    const name = containerForm.name.trim()
    if (!name) { showToast('收纳夹名称不能为空', 'error'); return }
    setBusy(true)
    try {
      const id = editingContainer?.id || createID()
      const now = Date.now()
      const nowText = new Date(now).toISOString()
      const targetGroupId = editingContainer?.groupId || resolveGroupSelection(doc, groupId)
      if (!targetGroupId) { showToast('请先创建分组，再添加收纳夹', 'error'); return }
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
      const nextDoc = await client.request<WorkspaceView>(editingContainer ? 'collections.containers.update' : 'collections.containers.add', { container: payload })
      setDoc(nextDoc); setContainerEditorOpen(false); setEditingContainer(null)
    } catch (e) { showToast(errorMessage(e, '保存收纳夹失败'), 'error') } finally { setBusy(false) }
  }

  async function renameContainer(container: CollectionContainer, name: string) {
    if (!client) throw new Error('收藏数据通道未连接')
    const nextName = name.trim()
    if (!nextName) throw new Error('收纳夹名称不能为空')
    if (nextName === container.name) return
    setBusy(true)
    try {
      const now = Date.now()
      const nextDoc = await client.request<WorkspaceView>('collections.containers.update', { container: {
        ...container,
        name: nextName,
        updatedAt: new Date(now).toISOString(),
        updatedAtMs: now,
      } })
      setDoc(nextDoc)
      setContainerView(current => current?.id === container.id ? nextDoc.containers.find(item => item.id === container.id) || null : current)
      setContainerDropViewState(containerDropViewRef.current?.id === container.id ? nextDoc.containers.find(item => item.id === container.id) || null : containerDropViewRef.current)
    } catch (e) {
      const message = errorMessage(e, '重命名收纳夹失败')
      showToast(message, 'error')
      throw new Error(message)
    } finally { setBusy(false) }
  }

  async function removeContainer(container: CollectionContainer) {
    if (!client) return
    setBusy(true)
    try { setDoc(await client.request<WorkspaceView>('collections.containers.remove', { id: container.id })); setConfirm(null); setContainerView(null); setContextMenu(null) }
    catch (e) { showToast(errorMessage(e, '删除收纳夹失败'), 'error') }
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
    if (!client) throw new Error('收藏数据通道未连接，无法保存图标')
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
    setBusy(true)
    try {
      const dataUrl = await clipboardImageDataUrlFromClipboard()
      await importIconDataUrl(dataUrl, '剪贴板图片')
    } catch (e) { showToast(errorMessage(e, '粘贴剪贴板图片失败'), 'error') }
    finally { setBusy(false) }
  }

  async function fetchFormWebIcons() {
    if (!client || !editing) return
    const target = form.target.trim()
    const targetError = URL_CATEGORY.validateTarget(target)
    if (targetError) { showToast(targetError, 'error'); return }
    const session = webIconDiscovery.start()
    webIconAutoSelectRef.current = true
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
      if (webIconDiscovery.isCurrent(session)) showToast(errorMessage(e, '获取网页图标失败'), 'error')
    }
    finally {
      if (webIconDiscovery.finish(session)) webIconAutoSelectRef.current = false
    }
  }

  async function pickFormIconImage() {
    if (!client || !editing) return
    setBusy(true)
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
    } catch (e) { showToast(errorMessage(e, '导入图标图片失败'), 'error') }
    finally { setBusy(false) }
  }

  async function saveDesktopWallpaper(wallpaper: import('./types').DesktopWallpaper | null) {
    if (!client) return
    setBusy(true)
    try { setDoc(await client.request<WorkspaceView>('collections.desktop.wallpaper.save', { wallpaper })) }
    catch (e) { showToast(errorMessage(e, '保存壁纸失败'), 'error') }
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

  async function saveDesktopWallpaperPresetView(presetId: string, view: import('./types').DesktopWallpaperView) {
    const wallpaper = doc.desktop.wallpaper
    if (!wallpaper) return
    await saveDesktopWallpaper(upsertDesktopWallpaperPresetView(wallpaper, presetId, view))
  }

  async function saveDesktopIconLayout(iconLayout: DesktopIconLayout) {
    if (!client) return
    setBusy(true)
    try {
      const nextDoc = await client.request<WorkspaceView>('collections.desktop.icon-layout.save', { iconLayout: normalizeDesktopIconLayout(iconLayout) })
      setDoc(nextDoc)
      setIconLayoutDraft(nextDoc.desktop.iconLayout)
    }
    catch (e) { setIconLayoutDraft(null); showToast(errorMessage(e, '保存图标布局失败'), 'error') }
    finally { setBusy(false) }
  }

  async function pickWallpaperImage() {
    if (!client) return
    setBusy(true)
    try {
      const sourcePath = await invoke<string | null>('pick_image_path')
      if (!sourcePath) return
      const asset = await client.request<DesktopAsset>('collections.assets.import', { kind: 'wallpaper', sourcePath })
      const preset = createDesktopWallpaperPreset({ id: createID(), name: deriveNameFromTarget(sourcePath), assetId: asset.id })
      const presets = [...(doc.desktop.wallpaper?.presets || []), preset]
      setDoc(await client.request<WorkspaceView>('collections.desktop.wallpaper.save', { wallpaper: { activeId: preset.id, presets } }))
    } catch (e) { showToast(errorMessage(e, '导入壁纸失败'), 'error') }
    finally { setBusy(false) }
  }

  async function pickDataDir() {
    setBusy(true); setError(null)
    try { const next = await invoke<DataDirStatus | null>('pick_data_dir'); if (next) setStatus(next); await connect() }
    catch (e) { setPhase('failed'); setError(errorMessage(e, '切换数据目录失败')); await refreshStatus() }
    finally { setBusy(false) }
  }

  function selectGroup(nextGroupId: string) {
    const resolvedGroupId = resolveGroupSelection(doc, nextGroupId)
    setGroupId(resolvedGroupId)
    void client?.request('collections.ui-state.save', { uiState: { groupId: resolvedGroupId } }).catch(e => showToast(errorMessage(e, '保存上次分组失败'), 'error'))
  }

  function selectResolvedGroup(resolvedGroupId: string) {
    setGroupId(resolvedGroupId)
    void client?.request('collections.ui-state.save', { uiState: { groupId: resolvedGroupId } }).catch(e => showToast(errorMessage(e, '保存上次分组失败'), 'error'))
  }

  const allDesktopEntries = React.useMemo(() => buildDesktopGridEntries(doc, groupId), [doc, groupId])
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
      <DesktopWallpaper assetUrl={client?.assetUrl} wallpaper={doc.desktop.wallpaper} />
      <Box sx={{ position: 'relative', zIndex: 1, minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <MainTopbar
          busy={busy}
          doc={doc}
          groupId={groupId}
          launchInfo={launchInfo}
          phase={phase}
          search={search}
          selectedGroup={selectedGroup}
          onAdd={openAdd}
          onAddContainer={openAddContainer}
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
          onPickDataDir={() => void pickDataDir()}
          onRestart={() => void connect()}
        />

        <FolderGridCanvas
          category={URL_CATEGORY}
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

        <CollectionContextMenu
          busy={busy}
          canCreateContainer={Boolean(selectedGroup)}
          canEdit={phase === 'ready'}
          menu={contextMenu}
          groups={doc.groups}
          doc={doc}
          onClose={closeContextMenu}
          onCreateContainer={openAddContainer}
          onCreateGroup={() => openGroupEditor()}
          onCreateItem={createItemFromContextMenu}
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

        <ItemDialog
          busy={busy}
          doc={doc}
          editing={editing}
          form={form}
          webIconDiscovery={webIconDiscovery.progress}
          assetUrl={client?.assetUrl}
          onChange={updateItemForm}
          onChangeIconDraft={updateFormIconDraft}
          onClose={closeItemDialog}
          onFetchWebIcons={() => void fetchFormWebIcons()}
          onPasteIconImage={() => void pasteFormIconImage()}
          onPickIconImage={() => void pickFormIconImage()}
          onResetIcon={() => updateFormIconDraft(null)}
          onSave={() => void saveItem()}
          onSelectIconCandidate={selectFormIconCandidate}
        />

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
          onPickDataDir={() => void pickDataDir()}
          onPickWallpaper={() => void pickWallpaperImage()}
          onPreviewIconLayout={layout => setIconLayoutDraft(normalizeDesktopIconLayout(layout))}
          onRemoveWallpaperPreset={id => void removeDesktopWallpaperPreset(id)}
          onRestart={() => void connect()}
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
          onBlankContextMenu={(container, x, y) => openContainerBlankContextMenu(container, x, y)}
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
          onBlankContextMenu={(container, x, y) => openContainerBlankContextMenu(container, x, y)}
          onContextMenu={(item, x, y) => openContainerItemContextMenu(containerDropView, item, x, y)}
          onOpenItem={item => void openItem(item)}
          onRemoveItem={item => void saveItemContainer([item.id], '')}
          onRename={(container, name) => renameContainer(container, name)}
          softClosed={false}
        />

        <ConfirmDialog
          busy={busy}
          confirm={confirm}
          doc={doc}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            if (!confirm) return
            const item = doc.items.find(current => current.id === confirm.id)
            const container = doc.containers.find(current => current.id === confirm.id)
            if (confirm.kind === 'group') void removeGroup({ id: confirm.id, name: confirm.label })
            else if (confirm.kind === 'container' && container) void removeContainer(container)
            else if (confirm.kind === 'item' && item) void removeItem(item)
            else setConfirm(null)
          }}
        />
      </Box>
    </Box>
  )
})

type ContainerItemDragEventLike = {
  item: CollectionItem
  clientX: number
  clientY: number
  offsetX: number
  offsetY: number
  modifiers: import('./shared/desktop-grid/core/dragTypes').DesktopGridDragModifiers
  boundary: DOMRect | null
}
