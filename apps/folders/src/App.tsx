import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import HorizontalRuleRoundedIcon from '@mui/icons-material/HorizontalRuleRounded'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
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
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material'
import type { SelectChangeEvent } from '@mui/material/Select'
import { createDirectClient } from './backendClient'
import { ContainerFolderOverlay } from './ContainerFolderOverlay'
import { ContainerDialog, IconEditorDialog } from './DesktopDialogs'
import { DesktopWallpaper } from './DesktopWallpaper'
import type { ContainerGridApi, ContainerGridPlacement } from './folder-grid/ContainerGridCanvas'
import { buildDesktopGridEntries, filterDesktopGridEntries } from './folder-grid/desktopEntries'
import type {
  ConfirmState,
  ContainerFormState,
  ContextMenuState,
  DataDirStatus,
  DesktopAsset,
  DesktopContainer,
  DesktopGridEntry,
  DesktopIcon,
  DesktopIconLayout,
  DesktopWallpaper as DesktopWallpaperState,
  DirectClient,
  FolderFormState,
  FolderGroup,
  FoldersHealth,
  FolderItem,
  FoldersDoc,
  FwLaunchInfo,
  GroupFormState,
  IconEditorState,
  Phase,
} from './types'
import { FolderGridCanvas, type DesktopGridDragEvent, type DesktopGridLayoutPatch } from './folder-grid/FolderGridCanvas'
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
  ALL_GROUP_ID,
  DEFAULT_DOC,
  DEFAULT_GROUP_ID,
  DEFAULT_LAUNCH_INFO,
  EMPTY_CONTAINER_FORM,
  EMPTY_GROUP_FORM,
  createID,
  deriveNameFromPath,
  errorMessage,
  folderTemplate,
  groupIdFromName,
  groupName,
  isInteractiveTarget,
} from './utils'

const appWindow = getCurrentWindow()
const ERROR_AUTO_HIDE_MS = 4200
const CONTAINER_HOVER_OPEN_MS = 520

type DesktopDragState = { item: FolderItem; hoverContainerId?: string; targetContainerId?: string } | null

export function App() {
  const [launchInfo, setLaunchInfo] = React.useState<FwLaunchInfo>(DEFAULT_LAUNCH_INFO)
  const [status, setStatus] = React.useState<DataDirStatus | null>(null)
  const [client, setClient] = React.useState<DirectClient | null>(null)
  const [doc, setDoc] = React.useState<FoldersDoc>(DEFAULT_DOC)
  const [phase, setPhase] = React.useState<Phase>('starting')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const [groupId, setGroupId] = React.useState(ALL_GROUP_ID)
  const [editing, setEditing] = React.useState<FolderItem | null>(null)
  const [form, setForm] = React.useState<FolderFormState>({ name: '', path: '', groupId: DEFAULT_GROUP_ID, newGroupName: '' })
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [groupEditorOpen, setGroupEditorOpen] = React.useState(false)
  const [groupForm, setGroupForm] = React.useState<GroupFormState>(EMPTY_GROUP_FORM)
  const [containerEditorOpen, setContainerEditorOpen] = React.useState(false)
  const [containerForm, setContainerForm] = React.useState<ContainerFormState>(EMPTY_CONTAINER_FORM)
  const [editingContainer, setEditingContainer] = React.useState<DesktopContainer | null>(null)
  const [containerView, setContainerView] = React.useState<DesktopContainer | null>(null)
  const [iconEditor, setIconEditor] = React.useState<IconEditorState>(null)
  const [iconLayoutDraft, setIconLayoutDraft] = React.useState<DesktopIconLayout | null>(null)
  const [confirm, setConfirm] = React.useState<ConfirmState>(null)
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState>(null)
  const [desktopDrag, setDesktopDrag] = React.useState<DesktopDragState>(null)
  const desktopDragRef = React.useRef<DesktopDragState>(null)
  const containerGridApiRef = React.useRef<ContainerGridApi | null>(null)
  const hoverOpenTimerRef = React.useRef<number | null>(null)
  const hoverOpenTargetIdRef = React.useRef<string | null>(null)
  const readyRef = React.useRef(false)

  const refreshStatus = React.useCallback(async () => {
    const next = await invoke<DataDirStatus>('data_dir_status').catch(() => null)
    setStatus(next)
    return next
  }, [])

  const connect = React.useCallback(async (options?: { restartBackend?: boolean }) => {
    setBusy(true); setError(null); setPhase('starting'); client?.close(); setClient(null)
    try {
      if (options?.restartBackend) await invoke('restart_backend')
      const nextClient = await createDirectClient()
      const health = await nextClient.request<FoldersHealth>('folders.health')
      if (!health.data.ok) {
        setClient(nextClient); setPhase('data-error'); setError(health.data.error || '数据文件不符合当前开发基线'); await refreshStatus()
        return
      }
      const nextDoc = await nextClient.request<FoldersDoc>('folders.getData')
      setClient(nextClient); setDoc(nextDoc); setPhase('ready'); await refreshStatus()
    } catch (e) {
      setPhase('failed'); setError(errorMessage(e, '启动文件夹收藏后台失败')); await refreshStatus()
    } finally { setBusy(false) }
  }, [client, refreshStatus])

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
    const close = () => setContextMenu(null)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true) }
  }, [])
  React.useEffect(() => () => clearHoverOpenTimer(), [])

  function handleCommand(command: string) {
    if (command === 'open-settings') setSettingsOpen(true)
    if (command === 'add-folder') openAdd()
    if (command === 'open-folders') { setSettingsOpen(false); setGroupEditorOpen(false); setEditing(null); setContainerView(null) }
  }

  function openAdd() {
    const selectedGroup = groupId === ALL_GROUP_ID ? DEFAULT_GROUP_ID : groupId
    setEditing(folderTemplate(selectedGroup))
    setForm({ name: '', path: '', groupId: selectedGroup, newGroupName: '' })
  }

  function openEdit(item: FolderItem) {
    setEditing(item); setForm({ name: item.name, path: item.path, groupId: item.groupId, newGroupName: '' }); setContextMenu(null)
  }

  function openAddContainer() {
    setEditingContainer(null)
    setContainerForm({ ...EMPTY_CONTAINER_FORM })
    setContainerEditorOpen(true)
  }

  function openEditContainer(container: DesktopContainer) {
    setEditingContainer(container)
    setContainerForm({ id: container.id, name: container.name })
    setContainerEditorOpen(true)
    setContextMenu(null)
  }

  async function saveFolder() {
    if (!client || !editing) return
    const path = form.path.trim()
    const name = (form.name.trim() || deriveNameFromPath(path)).trim()
    if (!name || !path) { setError('名称和路径都不能为空'); return }
    setBusy(true); setError(null)
    try {
      let targetGroupId = form.groupId || DEFAULT_GROUP_ID
      const newGroupName = form.newGroupName.trim()
      if (newGroupName) {
        const newGroupId = groupIdFromName(newGroupName)
        if (!newGroupId) throw new Error('新分组名不合法')
        if (!doc.groups.some(group => group.id === newGroupId)) {
          const afterGroupAdd = await client.request<FoldersDoc>('folders.groups.add', { id: newGroupId, name: newGroupName })
          setDoc(afterGroupAdd)
        }
        targetGroupId = newGroupId
      }
      const now = Date.now()
      const nowText = new Date(now).toISOString()
      const payload: FolderItem = {
        id: editing.id || createID(), name, path, groupId: targetGroupId,
        containerId: editing.containerId,
        createdAt: editing.createdAt || nowText, updatedAt: nowText,
        createdAtMs: editing.createdAtMs || now, updatedAtMs: now,
        layout: editing.layout,
        icon: editing.icon,
      }
      const nextDoc = await client.request<FoldersDoc>(editing.id ? 'folders.update' : 'folders.add', payload)
      setDoc(nextDoc); setEditing(null)
    } catch (e) { setError(errorMessage(e, '保存文件夹失败')) } finally { setBusy(false) }
  }

  async function removeFolder(item: FolderItem) {
    if (!client) return
    setBusy(true); setError(null)
    try { setDoc(await client.request<FoldersDoc>('folders.remove', { id: item.id })); setConfirm(null); setContextMenu(null) }
    catch (e) { setError(errorMessage(e, '删除文件夹失败')) }
    finally { setBusy(false) }
  }

  async function openFolder(item: FolderItem) {
    if (!client) return
    setBusy(true); setError(null); setContextMenu(null)
    try { await client.request('folders.open-folder', { id: item.id }) }
    catch (e) { setError(errorMessage(e, '打开文件夹失败')) }
    finally { setBusy(false) }
  }

  async function moveFolder(item: FolderItem, nextGroupId: string) {
    if (!client || item.groupId === nextGroupId) return
    setBusy(true); setError(null)
    try { setDoc(await client.request<FoldersDoc>('folders.move', { id: item.id, groupId: nextGroupId })); setContextMenu(null) }
    catch (e) { setError(errorMessage(e, '移动文件夹失败')) }
    finally { setBusy(false) }
  }

  async function saveItemContainer(ids: string[], containerId: string) {
    if (!client || !ids.length) return
    setBusy(true); setError(null)
    try { setDoc(await client.request<FoldersDoc>('folders.items.container.save', { ids, containerId })); setContextMenu(null) }
    catch (e) { setError(errorMessage(e, '移动到收纳夹失败')) }
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
      const nextDoc = await client.request<FoldersDoc>('folders.container.items.place', { containerId, movedId: movedId || undefined, items: placements })
      setDoc(nextDoc)
    } catch (e) {
      setDoc(previousDoc)
      setError(errorMessage(e, '保存收纳夹布局失败'))
    }
  }

  function openDesktopEntry(entry: DesktopGridEntry) {
    if (entry.kind === 'folder' && entry.item) void openFolder(entry.item)
    if (entry.kind === 'container' && entry.container) { setContainerView(entry.container); setContextMenu(null) }
  }

  async function saveDesktopLayouts(patches: DesktopGridLayoutPatch[]) {
    if (!client || patches.length === 0) return
    const previousDoc = doc
    setError(null)
    setDoc(current => ({
      ...current,
      items: current.items.map(item => {
        const patch = patches.find(currentPatch => currentPatch.kind === 'folder' && currentPatch.id === item.id)
        return patch ? { ...item, layout: patch.layout } : item
      }),
      containers: current.containers.map(container => {
        const patch = patches.find(currentPatch => currentPatch.kind === 'container' && currentPatch.id === container.id)
        return patch ? { ...container, layout: patch.layout } : container
      }),
    }))
    try {
      const nextDoc = await client.request<FoldersDoc>('folders.desktop.layout.save', { items: patches })
      setDoc(nextDoc)
    } catch (e) {
      setDoc(previousDoc)
      setError(errorMessage(e, '保存桌面布局失败'))
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

  function handleDesktopDragStart(event: DesktopGridDragEvent) {
    clearHoverOpenTimer()
    if (event.entry.kind !== 'folder' || !event.entry.item) return
    setDesktopDragState({ item: event.entry.item })
  }

  function handleDesktopDragMove(event: DesktopGridDragEvent) {
    if (event.entry.kind !== 'folder' || !event.entry.item) return
    const hoverContainer = event.hoverContainer?.container
    setDesktopDragState(current => current && current.item.id === event.entry.id ? { ...current, hoverContainerId: hoverContainer?.id } : current)
    if (!hoverContainer) {
      clearHoverOpenTimer()
      return
    }
    if (containerView?.id === hoverContainer.id) {
      clearHoverOpenTimer()
      setDesktopDragState(current => current && current.item.id === event.entry.id ? { ...current, targetContainerId: hoverContainer.id } : current)
      return
    }
    if (hoverOpenTargetIdRef.current === hoverContainer.id) return
    clearHoverOpenTimer()
    hoverOpenTargetIdRef.current = hoverContainer.id
    hoverOpenTimerRef.current = window.setTimeout(() => {
      hoverOpenTimerRef.current = null
      hoverOpenTargetIdRef.current = null
      setContainerView(hoverContainer)
      setDesktopDragState(current => current && current.item.id === event.entry.id ? { ...current, targetContainerId: hoverContainer.id } : current)
    }, CONTAINER_HOVER_OPEN_MS)
  }

  function handleDesktopDragEnd(event: DesktopGridDragEvent, patches: DesktopGridLayoutPatch[]) {
    clearHoverOpenTimer()
    const drag = desktopDragRef.current
    const targetContainerId = drag?.targetContainerId
    const dropLayout = targetContainerId ? containerGridApiRef.current?.layoutFromClientPoint(event.clientX, event.clientY, event.offsetX, event.offsetY) : null
    if (targetContainerId && drag && dropLayout && event.entry.kind === 'folder') {
      const nextPlacements = containerGridApiRef.current?.placementsForDrop(drag.item.id, dropLayout) || []
      void placeContainerItems(targetContainerId, drag.item.id, nextPlacements)
      setDesktopDragState(null)
      return true
    }
    setDesktopDragState(null)
    if (patches.length) void saveDesktopLayouts(patches)
    return true
  }

  function handleDesktopDragCancel() {
    clearHoverOpenTimer()
    setDesktopDragState(null)
  }

  function openGroupEditor(group?: FolderGroup) {
    setGroupForm(group ? { id: group.id, name: group.name } : EMPTY_GROUP_FORM); setGroupEditorOpen(true)
  }

  async function saveGroup() {
    if (!client) return
    const name = groupForm.name.trim()
    if (!name) { setError('分组名称不能为空'); return }
    const id = groupForm.id || groupIdFromName(name)
    if (!id) { setError('分组名称不合法'); return }
    setBusy(true); setError(null)
    try {
      const method = groupForm.id ? 'folders.groups.update' : 'folders.groups.add'
      setDoc(await client.request<FoldersDoc>(method, { id, name }))
      setGroupEditorOpen(false)
    } catch (e) { setError(errorMessage(e, '保存分组失败')) } finally { setBusy(false) }
  }

  async function removeGroup(group: FolderGroup) {
    if (!client) return
    setBusy(true); setError(null)
    try {
      const nextDoc = await client.request<FoldersDoc>('folders.groups.remove', { id: group.id })
      setDoc(nextDoc); setConfirm(null); setGroupEditorOpen(false)
      if (groupId === group.id) setGroupId(ALL_GROUP_ID)
    } catch (e) { setError(errorMessage(e, '删除分组失败')) } finally { setBusy(false) }
  }

  async function saveContainer() {
    if (!client) return
    const name = containerForm.name.trim()
    if (!name) { setError('收纳夹名称不能为空'); return }
    setBusy(true); setError(null)
    try {
      const id = editingContainer?.id || createID()
      const now = Date.now()
      const nowText = new Date(now).toISOString()
      const payload: DesktopContainer = {
        id,
        name,
        createdAt: editingContainer?.createdAt || nowText,
        updatedAt: nowText,
        createdAtMs: editingContainer?.createdAtMs || now,
        updatedAtMs: now,
        layout: editingContainer?.layout,
      }
      const nextDoc = await client.request<FoldersDoc>(editingContainer ? 'folders.containers.update' : 'folders.containers.add', payload)
      setDoc(nextDoc); setContainerEditorOpen(false); setEditingContainer(null)
    } catch (e) { setError(errorMessage(e, '保存收纳夹失败')) } finally { setBusy(false) }
  }

  async function removeContainer(container: DesktopContainer) {
    if (!client) return
    setBusy(true); setError(null)
    try { setDoc(await client.request<FoldersDoc>('folders.containers.remove', { id: container.id })); setConfirm(null); setContainerView(null); setContextMenu(null) }
    catch (e) { setError(errorMessage(e, '删除收纳夹失败')) }
    finally { setBusy(false) }
  }

  async function saveFolderIcon(id: string, icon: DesktopIcon | null) {
    if (!client) return
    setBusy(true); setError(null)
    try { setDoc(await client.request<FoldersDoc>('folders.icon.save', { kind: 'folder', id, icon })); setIconEditor(null); setContextMenu(null) }
    catch (e) { setError(errorMessage(e, '保存图标失败')) }
    finally { setBusy(false) }
  }

  async function pickIconImage() {
    if (!client || !iconEditor) return
    setBusy(true); setError(null)
    try {
      const sourcePath = await invoke<string | null>('pick_image_path')
      if (!sourcePath) return
      const asset = await client.request<DesktopAsset>('folders.assets.import', { kind: 'icon', sourcePath })
      setDoc(await client.request<FoldersDoc>('folders.icon.save', { kind: 'folder', id: iconEditor.id, icon: { kind: 'image', assetId: asset.id } }))
      setIconEditor(null)
    } catch (e) { setError(errorMessage(e, '导入图标图片失败')) }
    finally { setBusy(false) }
  }

  async function saveDesktopWallpaper(wallpaper: DesktopWallpaperState | null) {
    if (!client) return
    setBusy(true); setError(null)
    try { setDoc(await client.request<FoldersDoc>('folders.desktop.wallpaper.save', { wallpaper })) }
    catch (e) { setError(errorMessage(e, '保存壁纸失败')) }
    finally { setBusy(false) }
  }

  async function saveDesktopIconLayout(iconLayout: DesktopIconLayout) {
    if (!client) return
    setBusy(true); setError(null)
    try {
      const nextDoc = await client.request<FoldersDoc>('folders.desktop.icon-layout.save', { iconLayout: normalizeDesktopIconLayout(iconLayout) })
      setDoc(nextDoc)
      setIconLayoutDraft(nextDoc.desktop.iconLayout)
    }
    catch (e) { setIconLayoutDraft(null); setError(errorMessage(e, '保存图标布局失败')) }
    finally { setBusy(false) }
  }

  async function pickWallpaperImage() {
    if (!client) return
    setBusy(true); setError(null)
    try {
      const sourcePath = await invoke<string | null>('pick_image_path')
      if (!sourcePath) return
      const asset = await client.request<DesktopAsset>('folders.assets.import', { kind: 'wallpaper', sourcePath })
      setDoc(await client.request<FoldersDoc>('folders.desktop.wallpaper.save', { wallpaper: { assetId: asset.id } }))
    } catch (e) { setError(errorMessage(e, '导入壁纸失败')) }
    finally { setBusy(false) }
  }

  async function pickDataDir() {
    setBusy(true); setError(null)
    try { const next = await invoke<DataDirStatus | null>('pick_data_dir'); if (next) setStatus(next); await connect() }
    catch (e) { setPhase('failed'); setError(errorMessage(e, '切换数据目录失败')); await refreshStatus() }
    finally { setBusy(false) }
  }

  async function resetData() {
    if (!client) return
    setBusy(true); setError(null)
    try {
      const nextDoc = await client.request<FoldersDoc>('folders.data.reset')
      setDoc(nextDoc); setPhase('ready'); setConfirm(null); await refreshStatus()
    } catch (e) { setError(errorMessage(e, '重置数据失败')) }
    finally { setBusy(false) }
  }

  async function pickFolderPath() {
    setError(null)
    try {
      const path = await invoke<string | null>('pick_folder_path')
      if (path) setForm(current => ({ ...current, path, name: current.name || deriveNameFromPath(path) }))
    } catch (e) { setError(errorMessage(e, '选择文件夹失败')) }
  }

  const allDesktopEntries = React.useMemo(() => buildDesktopGridEntries(doc), [doc])
  const filteredEntries = React.useMemo(() => filterDesktopGridEntries(doc, allDesktopEntries, groupId, search), [allDesktopEntries, doc, groupId, search])
  const visibleIconLayout = iconLayoutDraft || doc.desktop.iconLayout
  const selectedGroup = doc.groups.find(group => group.id === groupId)
  const editableGroups = doc.groups.filter(group => group.id !== DEFAULT_GROUP_ID)

  return (
    <Box
      component="main"
      onClick={() => setContextMenu(null)}
      sx={{
        position: 'relative',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: 'background.default',
      }}
    >
      <DesktopWallpaper wallpaper={doc.desktop.wallpaper} assetUrl={client?.assetUrl} />
      <Box sx={{ position: 'relative', zIndex: 1, minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TopBar
        busy={busy}
        doc={doc}
        groupId={groupId}
        launchInfo={launchInfo}
        phase={phase}
        search={search}
        selectedGroup={selectedGroup}
        onAdd={openAdd}
        onAddContainer={openAddContainer}
        onGroupChange={setGroupId}
        onOpenGroupEditor={() => openGroupEditor(selectedGroup?.id === DEFAULT_GROUP_ID ? undefined : selectedGroup)}
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
        onResetData={() => setConfirm({ kind: 'data-reset', id: 'data-reset', label: '当前数据' })}
      />

      <FolderGridCanvas
        doc={doc}
        allEntries={allDesktopEntries}
        assetUrl={client?.assetUrl}
        groupCount={doc.groups.length}
        iconLayout={visibleIconLayout}
        entries={filteredEntries}
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
      />

      {error && phase === 'ready' ? <Alert severity="error" sx={{ mx: { xs: 1.5, sm: 2 }, mb: 1.5 }}>{error}</Alert> : null}

      <FolderContextMenu
        menu={contextMenu}
        groups={doc.groups}
        doc={doc}
        onClose={() => setContextMenu(null)}
        onOpen={openDesktopEntry}
        onEdit={openEdit}
        onEditContainer={openEditContainer}
        onEditIcon={entry => entry.item ? setIconEditor({ id: entry.item.id, label: entry.item.name, icon: entry.item.icon }) : undefined}
        onMoveToContainer={(item, containerId) => void saveItemContainer([item.id], containerId)}
        onMove={(item, nextGroupId) => void moveFolder(item, nextGroupId)}
        onDelete={entry => setConfirm({ kind: entry.kind, id: entry.id, label: entry.name })}
      />

      <FolderDialog
        busy={busy}
        doc={doc}
        editing={editing}
        form={form}
        onChange={setForm}
        onClose={() => setEditing(null)}
        onPickPath={() => void pickFolderPath()}
        onSave={() => void saveFolder()}
      />

      <GroupDialog
        busy={busy}
        doc={doc}
        editableGroups={editableGroups}
        open={groupEditorOpen}
        form={groupForm}
        onChange={setGroupForm}
        onClose={() => setGroupEditorOpen(false)}
        onDelete={group => setConfirm({ kind: 'group', id: group.id, label: group.name })}
        onNew={() => setGroupForm(EMPTY_GROUP_FORM)}
        onSave={() => void saveGroup()}
      />

      <SettingsDialog
        busy={busy}
        doc={doc}
        open={settingsOpen}
        status={status}
        hasWallpaper={Boolean(doc.desktop.wallpaper)}
        iconLayout={visibleIconLayout}
        onClearWallpaper={() => void saveDesktopWallpaper(null)}
        onClose={() => setSettingsOpen(false)}
        onPickDataDir={pickDataDir}
        onPickWallpaper={() => void pickWallpaperImage()}
        onPreviewIconLayout={layout => setIconLayoutDraft(normalizeDesktopIconLayout(layout))}
        onRestart={() => void connect({ restartBackend: true })}
        onSaveIconLayout={layout => void saveDesktopIconLayout(layout)}
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

      <ContainerFolderOverlay
        assetUrl={client?.assetUrl}
        container={containerView}
        dropTargetActive={Boolean(desktopDrag?.targetContainerId && desktopDrag.targetContainerId === containerView?.id)}
        doc={doc}
        onClose={() => setContainerView(null)}
        onEdit={container => { setContainerView(null); openEditContainer(container) }}
        onGridReady={api => { containerGridApiRef.current = api }}
        onLayoutCommit={patches => containerView ? void placeContainerItems(containerView.id, null, patches) : undefined}
        onOpenFolder={item => void openFolder(item)}
        onRemoveItem={item => void saveItemContainer([item.id], '')}
      />

      <IconEditorDialog
        busy={busy}
        state={iconEditor}
        onClose={() => setIconEditor(null)}
        onPickImage={() => void pickIconImage()}
        onReset={() => iconEditor ? void saveFolderIcon(iconEditor.id, null) : undefined}
        onSaveColor={color => iconEditor ? void saveFolderIcon(iconEditor.id, { kind: 'color', color }) : undefined}
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
          else if (confirm.kind === 'data-reset') void resetData()
          else if (confirm.kind === 'folder' && item) void removeFolder(item)
          else setConfirm(null)
        }}
      />
      </Box>
    </Box>
  )
}

function TopBar(props: {
  busy: boolean
  doc: FoldersDoc
  groupId: string
  launchInfo: FwLaunchInfo
  phase: Phase
  search: string
  selectedGroup: FolderGroup | undefined
  onAdd(): void
  onAddContainer(): void
  onGroupChange(groupId: string): void
  onOpenGroupEditor(): void
  onOpenSettings(): void
  onSearchChange(search: string): void
}) {
  const statusColor = props.phase === 'failed' ? 'error' : 'warning'
  const statusText = props.phase === 'data-error' ? '数据异常' : props.phase === 'failed' ? '需处理' : '启动中'
  const canEdit = props.phase === 'ready'
  const groupActionLabel = props.selectedGroup && props.selectedGroup.id !== DEFAULT_GROUP_ID ? '编辑分组' : '新分组'

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
        bgcolor: 'rgba(255, 255, 255, 0.72)',
        backdropFilter: 'blur(18px) saturate(1.18)',
        WebkitBackdropFilter: 'blur(18px) saturate(1.18)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.46)',
        boxShadow: '0 12px 30px rgba(15, 23, 42, 0.1)',
        userSelect: 'none',
        flexShrink: 0,
        flexWrap: { xs: 'wrap', md: 'nowrap' },
        py: { xs: 1, md: 0.75 },
      }}
    >
      <TextField
        value={props.search}
        onChange={event => props.onSearchChange(event.target.value)}
        placeholder="按名称或路径搜索"
        size="small"
        sx={{ flex: { xs: '1 1 100%', sm: '0 1 130px' }, minWidth: { xs: '100%', sm: 110 }, maxWidth: { xs: '100%', sm: 130 } }}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }}
      />
      <GroupFilterSelect doc={props.doc} groupId={props.groupId} onGroupChange={props.onGroupChange} />
      {props.phase !== 'ready' ? <Chip color={statusColor} size="small" label={statusText} icon={props.phase === 'starting' ? <CircularProgress size={12} color="inherit" /> : undefined} /> : null}
      <Button variant="text" startIcon={<SettingsRoundedIcon />} onClick={props.onOpenSettings}>设置</Button>
      <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={props.onAdd} disabled={!canEdit || props.busy}>新增</Button>
      <Button variant="text" startIcon={<Inventory2RoundedIcon />} onClick={props.onAddContainer} disabled={!canEdit || props.busy}>收纳夹</Button>
      <Button
        variant="text"
        startIcon={props.selectedGroup && props.selectedGroup.id !== DEFAULT_GROUP_ID ? <EditRoundedIcon /> : <CreateNewFolderRoundedIcon />}
        onClick={props.onOpenGroupEditor}
        disabled={!canEdit}
        sx={{ minWidth: 108 }}
      >
        {groupActionLabel}
      </Button>
      {props.launchInfo.standalone ? <WindowControls /> : null}
    </Paper>
  )
}

function GroupFilterSelect(props: { doc: FoldersDoc; groupId: string; onGroupChange(groupId: string): void }) {
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
        <MenuItem value={ALL_GROUP_ID}>全部分组</MenuItem>
        {props.doc.groups.map(group => <MenuItem key={group.id} value={group.id}>{group.name}</MenuItem>)}
      </Select>
    </FormControl>
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

function StatusNotice(props: { busy: boolean; error: string | null; phase: Phase; status: DataDirStatus | null; onPickDataDir(): void; onRestart(): void; onResetData(): void }) {
  if (props.phase === 'starting') {
    return <Alert severity="info" icon={<CircularProgress size={18} />} sx={{ mx: { xs: 1.5, sm: 2 }, mb: 1 }}>正在连接文件夹收藏后台...</Alert>
  }
  if (props.phase === 'data-error') {
    return (
      <Alert
        severity="warning"
        icon={<WarningAmberRoundedIcon />}
        sx={{ mx: { xs: 1.5, sm: 2 }, mb: 1, alignItems: 'flex-start' }}
        action={
          <Stack direction="row" spacing={1}>
            <Button color="inherit" size="small" onClick={props.onResetData} disabled={props.busy}>重置数据</Button>
            <Button color="inherit" size="small" onClick={props.onPickDataDir} disabled={props.busy}>数据目录</Button>
          </Stack>
        }
      >
        <Typography fontWeight={900}>数据文件不符合当前开发基线</Typography>
        <Typography variant="body2">{props.error || '当前数据结构与开发基线不一致。请确认是否重置为新的空白基线。'}</Typography>
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

function FolderContextMenu(props: {
  menu: ContextMenuState
  groups: FolderGroup[]
  doc: FoldersDoc
  onClose(): void
  onOpen(entry: DesktopGridEntry): void
  onEdit(item: FolderItem): void
  onEditContainer(container: DesktopContainer): void
  onEditIcon(entry: DesktopGridEntry): void
  onMove(item: FolderItem, groupId: string): void
  onMoveToContainer(item: FolderItem, containerId: string): void
  onDelete(entry: DesktopGridEntry): void
}) {
  const entry = props.menu?.entry
  const folder = entry?.kind === 'folder' ? entry.item : null
  const container = entry?.kind === 'container' ? entry.container : null
  return (
    <Menu
      open={Boolean(props.menu)}
      onClose={props.onClose}
      anchorReference="anchorPosition"
      anchorPosition={props.menu ? { left: props.menu.x, top: props.menu.y } : undefined}
      onClick={event => event.stopPropagation()}
    >
      {entry ? [
        <MenuItem key="open" onClick={() => props.onOpen(entry)}>
          <ListItemIcon><OpenInNewRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>打开</ListItemText>
        </MenuItem>,
        folder ? <MenuItem key="edit" onClick={() => props.onEdit(folder)}>
          <ListItemIcon><EditRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>编辑</ListItemText>
        </MenuItem> : null,
        container ? <MenuItem key="edit-container" onClick={() => props.onEditContainer(container)}>
          <ListItemIcon><Inventory2RoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>编辑收纳夹</ListItemText>
        </MenuItem> : null,
        folder ? <MenuItem key="icon" onClick={() => props.onEditIcon(entry)}>
          <ListItemIcon><ImageRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>图标外观</ListItemText>
        </MenuItem> : null,
        folder ? <Box key="move" sx={{ px: 2, py: 1, minWidth: 220 }}>
          <FormControl variant="filled" fullWidth size="small">
            <InputLabel id="context-move-label">移动到</InputLabel>
            <Select
              variant="filled"
              labelId="context-move-label"
              label="移动到"
              value={folder.groupId}
              onChange={event => props.onMove(folder, event.target.value)}
            >
              {props.groups.map(group => <MenuItem key={group.id} value={group.id}>{group.name}</MenuItem>)}
            </Select>
          </FormControl>
        </Box> : null,
        folder ? <Box key="container" sx={{ px: 2, py: 1, minWidth: 220 }}>
          <FormControl variant="filled" fullWidth size="small">
            <InputLabel id="context-container-label">收纳夹</InputLabel>
            <Select
              variant="filled"
              labelId="context-container-label"
              label="收纳夹"
              value={folder.containerId || ''}
              onChange={event => props.onMoveToContainer(folder, event.target.value)}
            >
              <MenuItem value="">桌面</MenuItem>
              {props.doc.containers.map(current => <MenuItem key={current.id} value={current.id}>{current.name}</MenuItem>)}
            </Select>
          </FormControl>
        </Box> : null,
        <MenuItem key="delete" onClick={() => props.onDelete(entry)} sx={{ color: 'error.main' }}>
          <ListItemIcon><DeleteOutlineRoundedIcon fontSize="small" color="error" /></ListItemIcon>
          <ListItemText>删除</ListItemText>
        </MenuItem>,
      ] : null}
    </Menu>
  )
}

function FolderDialog(props: {
  busy: boolean
  doc: FoldersDoc
  editing: FolderItem | null
  form: FolderFormState
  onChange(form: FolderFormState): void
  onClose(): void
  onPickPath(): void
  onSave(): void
}) {
  const open = Boolean(props.editing)
  return (
    <Dialog open={open} onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogContent sx={{ p: 3 }}>
        <Stack spacing={2.25}>
          <Box>
            <Typography variant="h2">{props.editing?.id ? '编辑文件夹' : '添加文件夹'}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>保存常用目录，之后可以一键打开。</Typography>
          </Box>
          <TextField
            label="名称"
            value={props.form.name}
            onChange={event => props.onChange({ ...props.form, name: event.target.value })}
            placeholder="例如：项目目录"
            autoFocus
            fullWidth
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              label="路径"
              value={props.form.path}
              onChange={event => props.onChange({ ...props.form, path: event.target.value })}
              placeholder="选择或粘贴文件夹绝对路径"
              fullWidth
            />
            <Button variant="text" startIcon={<LaunchRoundedIcon />} onClick={props.onPickPath} sx={{ minWidth: 96 }}>选择</Button>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
            <FormControl variant="filled" size="small" fullWidth>
              <InputLabel id="folder-form-group-label">分组</InputLabel>
              <Select variant="filled" labelId="folder-form-group-label" label="分组" value={props.form.groupId} onChange={(event: SelectChangeEvent) => props.onChange({ ...props.form, groupId: event.target.value })}>
                {props.doc.groups.map(group => <MenuItem key={group.id} value={group.id}>{group.name}</MenuItem>)}
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
          <Typography variant="caption" color="text.secondary">图标布局会自动吸附格子；右键或点更多菜单可打开、编辑、移动或删除。</Typography>
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
  doc: FoldersDoc
  editableGroups: FolderGroup[]
  open: boolean
  form: GroupFormState
  onChange(form: GroupFormState): void
  onClose(): void
  onDelete(group: FolderGroup): void
  onNew(): void
  onSave(): void
}) {
  const selected = props.editableGroups.find(group => group.id === props.form.id)
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
              <Typography variant="caption" color="text.secondary">已有分组</Typography>
              <Stack spacing={1} sx={{ maxHeight: 240, overflow: 'auto' }}>
                {props.editableGroups.map(group => (
                  <Button
                    key={group.id}
                    variant={group.id === props.form.id ? 'contained' : 'text'}
                    onClick={() => props.onChange({ id: group.id, name: group.name })}
                    sx={{ justifyContent: 'space-between', bgcolor: group.id === props.form.id ? undefined : theme => alpha(theme.palette.primary.main, 0.06) }}
                  >
                    <span>{group.name}</span>
                    <Chip size="small" label={`${props.doc.items.filter(item => item.groupId === group.id).length} 个文件夹`} />
                  </Button>
                ))}
              </Stack>
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
  busy: boolean
  doc: FoldersDoc
  hasWallpaper: boolean
  iconLayout: DesktopIconLayout
  open: boolean
  status: DataDirStatus | null
  onClearWallpaper(): void
  onClose(): void
  onPickDataDir(): void
  onPickWallpaper(): void
  onPreviewIconLayout(layout: DesktopIconLayout): void
  onRestart(): void
  onSaveIconLayout(layout: DesktopIconLayout): void
}) {
  const iconLayout = normalizeDesktopIconLayout(props.iconLayout)
  const updateDraftIconLayout = (patch: Partial<DesktopIconLayout>) => props.onPreviewIconLayout(normalizeDesktopIconLayout({ ...iconLayout, ...patch }))
  const saveDraftIconLayout = (patch: Partial<DesktopIconLayout>) => props.onSaveIconLayout(normalizeDesktopIconLayout({ ...iconLayout, ...patch }))

  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="md">
      <DialogContent sx={{ p: 3 }}>
        <Stack spacing={2.25}>
          <Box>
            <Typography variant="h2">设置</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>管理桌面图标、壁纸、数据目录和后台状态。</Typography>
          </Box>
          <Paper elevation={0} sx={{ p: 2, borderRadius: 3, bgcolor: theme => alpha(theme.palette.primary.main, 0.06) }}>
            <Stack spacing={1.75}>
              <Box>
                <Typography fontWeight={900}>桌面图标布局</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>控制桌面图标之间的行列间距，以及图标整体显示大小。</Typography>
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
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
                      { value: DEFAULT_DESKTOP_ICON_LAYOUT.rowGap, label: `${DEFAULT_DESKTOP_ICON_LAYOUT.rowGap}px` },
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
                      { value: DEFAULT_DESKTOP_ICON_LAYOUT.columnGap, label: `${DEFAULT_DESKTOP_ICON_LAYOUT.columnGap}px` },
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
          <Paper elevation={0} sx={{ p: 2, borderRadius: 3, bgcolor: theme => alpha(theme.palette.primary.main, 0.06) }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography fontWeight={900}>桌面壁纸</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>选择一张图片作为桌面背景；不会叠加灰色蒙版。</Typography>
              </Box>
              <Button startIcon={<ImageRoundedIcon />} onClick={props.onPickWallpaper} disabled={props.busy}>选择壁纸</Button>
              <Button startIcon={<RestartAltRoundedIcon />} onClick={props.onClearWallpaper} disabled={props.busy || !props.hasWallpaper}>清除壁纸</Button>
            </Stack>
          </Paper>
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

function ConfirmDialog(props: { busy: boolean; confirm: ConfirmState; doc: FoldersDoc; onClose(): void; onConfirm(): void }) {
  const groupItemCount = props.confirm?.kind === 'group' ? props.doc.items.filter(item => item.groupId === props.confirm?.id).length : 0
  const containerItemCount = props.confirm?.kind === 'container' ? props.doc.items.filter(item => item.containerId === props.confirm?.id).length : 0
  const message = props.confirm?.kind === 'group'
    ? `删除分组“${props.confirm.label}”？组内 ${groupItemCount} 个文件夹会移回默认分组。`
    : props.confirm?.kind === 'container'
      ? `删除收纳夹“${props.confirm.label}”？夹内 ${containerItemCount} 个文件夹会移回桌面。`
      : props.confirm?.kind === 'data-reset'
        ? '重置会把当前数据目录的 data.json 写成新的空白开发基线；这不是自动修复，请确认旧数据可以丢弃。'
        : `删除文件夹“${props.confirm?.label || ''}”？`
  const title = props.confirm?.kind === 'data-reset' ? '确认重置数据' : '确认删除'
  const confirmLabel = props.confirm?.kind === 'data-reset' ? '确认重置' : '确认删除'
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
            <Button color="error" variant="contained" onClick={props.onConfirm} disabled={props.busy}>{confirmLabel}</Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
