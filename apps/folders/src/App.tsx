import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DriveFolderUploadRoundedIcon from '@mui/icons-material/DriveFolderUploadRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded'
import HorizontalRuleRoundedIcon from '@mui/icons-material/HorizontalRuleRounded'
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded'
import ListRoundedIcon from '@mui/icons-material/ListRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
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
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
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
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material'
import type { SelectChangeEvent } from '@mui/material/Select'
import { createDirectClient } from './backendClient'
import type {
  ConfirmState,
  ContextMenuState,
  DataDirStatus,
  DirectClient,
  FolderFormState,
  FolderGroup,
  FolderItem,
  FoldersDoc,
  FoldersSettings,
  FwLaunchInfo,
  GroupFormState,
  Phase,
} from './types'
import {
  ALL_GROUP_ID,
  DEFAULT_DOC,
  DEFAULT_GROUP_ID,
  DEFAULT_LAUNCH_INFO,
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

export function App() {
  const [launchInfo, setLaunchInfo] = React.useState<FwLaunchInfo>(DEFAULT_LAUNCH_INFO)
  const [status, setStatus] = React.useState<DataDirStatus | null>(null)
  const [client, setClient] = React.useState<DirectClient | null>(null)
  const [doc, setDoc] = React.useState<FoldersDoc>(DEFAULT_DOC)
  const [settings, setSettings] = React.useState<FoldersSettings | null>(null)
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
  const [confirm, setConfirm] = React.useState<ConfirmState>(null)
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState>(null)
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
      const [nextDoc, nextSettings] = await Promise.all([
        nextClient.request<FoldersDoc>('folders.getData'),
        nextClient.request<FoldersSettings>('folders.settings.get'),
      ])
      setClient(nextClient); setDoc(nextDoc); setSettings(nextSettings); setPhase('ready'); await refreshStatus()
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
    const close = () => setContextMenu(null)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true) }
  }, [])

  function handleCommand(command: string) {
    if (command === 'open-settings') setSettingsOpen(true)
    if (command === 'add-folder') openAdd()
    if (command === 'open-folders') { setSettingsOpen(false); setGroupEditorOpen(false); setEditing(null) }
  }

  function openAdd() {
    const selectedGroup = groupId === ALL_GROUP_ID ? DEFAULT_GROUP_ID : groupId
    setEditing(folderTemplate(selectedGroup))
    setForm({ name: '', path: '', groupId: selectedGroup, newGroupName: '' })
  }

  function openEdit(item: FolderItem) {
    setEditing(item); setForm({ name: item.name, path: item.path, groupId: item.groupId, newGroupName: '' }); setContextMenu(null)
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
        createdAt: editing.createdAt || nowText, updatedAt: nowText,
        createdAtMs: editing.createdAtMs || now, updatedAtMs: now,
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

  async function pickDataDir() {
    setBusy(true); setError(null)
    try { const next = await invoke<DataDirStatus | null>('pick_data_dir'); if (next) setStatus(next); await connect() }
    catch (e) { setPhase('failed'); setError(errorMessage(e, '切换数据目录失败')); await refreshStatus() }
    finally { setBusy(false) }
  }

  async function pickFolderPath() {
    setError(null)
    try {
      const path = await invoke<string | null>('pick_folder_path')
      if (path) setForm(current => ({ ...current, path, name: current.name || deriveNameFromPath(path) }))
    } catch (e) { setError(errorMessage(e, '选择文件夹失败')) }
  }

  async function setView(view: 'grid' | 'list') {
    if (!client) return
    setBusy(true); setError(null)
    try { setSettings(await client.request<FoldersSettings>('folders.settings.save', { view })) }
    catch (e) { setError(errorMessage(e, '保存设置失败')) }
    finally { setBusy(false) }
  }

  const filteredItems = doc.items.filter(item => {
    const q = search.trim().toLowerCase()
    if (groupId !== ALL_GROUP_ID && item.groupId !== groupId) return false
    return !q || item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q)
  })
  const selectedGroup = doc.groups.find(group => group.id === groupId)
  const editableGroups = doc.groups.filter(group => group.id !== DEFAULT_GROUP_ID)
  const view = settings?.view || 'grid'

  return (
    <Box
      component="main"
      onClick={() => setContextMenu(null)}
      sx={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: 'background.default',
      }}
    >
      <TopBar
        busy={busy}
        doc={doc}
        groupId={groupId}
        launchInfo={launchInfo}
        phase={phase}
        search={search}
        selectedGroup={selectedGroup}
        view={view}
        onAdd={openAdd}
        onGroupChange={setGroupId}
        onOpenGroupEditor={() => openGroupEditor(selectedGroup?.id === DEFAULT_GROUP_ID ? undefined : selectedGroup)}
        onOpenSettings={() => setSettingsOpen(true)}
        onSearchChange={setSearch}
        onSetView={nextView => void setView(nextView)}
      />

      <StatusNotice
        busy={busy}
        error={error}
        phase={phase}
        status={status}
        onPickDataDir={pickDataDir}
        onRestart={() => void connect({ restartBackend: true })}
      />

      <FoldersList
        doc={doc}
        groupCount={doc.groups.length}
        items={filteredItems}
        phase={phase}
        view={view}
        search={search}
        onAdd={openAdd}
        onOpen={item => void openFolder(item)}
        onContextMenu={setContextMenu}
      />

      {error && phase !== 'failed' ? <Alert severity="error" sx={{ mx: { xs: 1.5, sm: 2 }, mb: 1.5 }}>{error}</Alert> : null}

      <FolderContextMenu
        menu={contextMenu}
        groups={doc.groups}
        doc={doc}
        onClose={() => setContextMenu(null)}
        onOpen={item => void openFolder(item)}
        onEdit={openEdit}
        onMove={(item, nextGroupId) => void moveFolder(item, nextGroupId)}
        onDelete={item => setConfirm({ kind: 'folder', id: item.id, label: item.name })}
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
        settings={settings}
        status={status}
        onClose={() => setSettingsOpen(false)}
        onPickDataDir={pickDataDir}
        onRestart={() => void connect({ restartBackend: true })}
        onSetView={nextView => void setView(nextView)}
      />

      <ConfirmDialog
        busy={busy}
        confirm={confirm}
        doc={doc}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return
          const item = doc.items.find(current => current.id === confirm.id)
          if (confirm.kind === 'group') void removeGroup({ id: confirm.id, name: confirm.label })
          else if (item) void removeFolder(item)
          else setConfirm(null)
        }}
      />
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
  view: 'grid' | 'list'
  onAdd(): void
  onGroupChange(groupId: string): void
  onOpenGroupEditor(): void
  onOpenSettings(): void
  onSearchChange(search: string): void
  onSetView(view: 'grid' | 'list'): void
}) {
  const statusColor = props.phase === 'failed' ? 'error' : 'warning'
  const statusText = props.phase === 'failed' ? '需处理' : '启动中'
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
        borderBottom: theme => `1px solid ${theme.palette.divider}`,
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
        sx={{ flex: '1 1 260px', minWidth: { xs: '100%', sm: 220 } }}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }}
      />
      <FormControl size="small" sx={{ width: { xs: 'calc(50% - 6px)', sm: 180 }, minWidth: 148 }}>
        <InputLabel id="folders-group-filter-label">分组</InputLabel>
        <Select labelId="folders-group-filter-label" value={props.groupId} label="分组" onChange={(event: SelectChangeEvent) => props.onGroupChange(event.target.value)}>
          <MenuItem value={ALL_GROUP_ID}>全部分组</MenuItem>
          {props.doc.groups.map(group => <MenuItem key={group.id} value={group.id}>{group.name}</MenuItem>)}
        </Select>
      </FormControl>
      <ToggleButtonGroup
        value={props.view}
        exclusive
        size="small"
        onChange={(_, next: 'grid' | 'list' | null) => { if (next) props.onSetView(next) }}
        aria-label="切换视图"
        sx={{ flexShrink: 0 }}
      >
        <ToggleButton value="grid" aria-label="宫格视图"><GridViewRoundedIcon fontSize="small" /></ToggleButton>
        <ToggleButton value="list" aria-label="列表视图"><ListRoundedIcon fontSize="small" /></ToggleButton>
      </ToggleButtonGroup>
      {props.phase !== 'ready' ? <Chip color={statusColor} size="small" label={statusText} icon={props.phase === 'starting' ? <CircularProgress size={12} color="inherit" /> : undefined} /> : null}
      <Button variant="outlined" startIcon={<SettingsRoundedIcon />} onClick={props.onOpenSettings}>设置</Button>
      <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={props.onAdd} disabled={!canEdit || props.busy}>新增</Button>
      <Button
        variant="outlined"
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
    return <Alert severity="info" icon={<CircularProgress size={18} />} sx={{ mx: { xs: 1.5, sm: 2 }, mb: 1 }}>正在连接文件夹收藏后台...</Alert>
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
      <Typography fontWeight={900}>后台或数据目录暂不可用</Typography>
      <Typography variant="body2">{props.error || props.status?.error || '请重试或选择新的数据目录。'}</Typography>
    </Alert>
  )
}

function FoldersList(props: {
  doc: FoldersDoc
  groupCount: number
  items: FolderItem[]
  phase: Phase
  view: 'grid' | 'list'
  search: string
  onAdd(): void
  onOpen(item: FolderItem): void
  onContextMenu(menu: ContextMenuState): void
}) {
  if (!props.items.length) {
    return (
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: { xs: 1.5, sm: 2 }, pt: 1 }}>
        <EmptyState phase={props.phase} search={props.search} onAdd={props.onAdd} />
      </Box>
    )
  }

  return (
    <Box
      component="section"
      aria-label="收藏文件夹列表"
      sx={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        p: { xs: 1.5, sm: 2 },
        pt: 1,
        display: 'grid',
        gridTemplateColumns: props.view === 'list' ? '1fr' : 'repeat(auto-fill, minmax(132px, 1fr))',
        alignContent: 'start',
        gap: 1.5,
      }}
    >
      {props.items.map(item => (
        <FolderCard
          key={item.id}
          doc={props.doc}
          groupCount={props.groupCount}
          item={item}
          view={props.view}
          onOpen={() => props.onOpen(item)}
          onContextMenu={(x, y) => props.onContextMenu({ item, x, y })}
        />
      ))}
    </Box>
  )
}

function FolderCard(props: { doc: FoldersDoc; groupCount: number; item: FolderItem; view: 'grid' | 'list'; onOpen(): void; onContextMenu(x: number, y: number): void }) {
  const isList = props.view === 'list'
  return (
    <Card
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); props.onContextMenu(event.clientX, event.clientY) }}
      sx={{
        position: 'relative',
        overflow: 'visible',
        borderRadius: 3,
        transition: 'transform .16s ease, box-shadow .16s ease, border-color .16s ease',
        '&:hover': {
          transform: 'translateY(-1px)',
          borderColor: 'primary.light',
          boxShadow: '0 18px 42px rgba(37, 99, 235, 0.14)',
        },
      }}
    >
      <Button
        color="inherit"
        onClick={props.onOpen}
        aria-label={`打开文件夹：${props.item.name}`}
        sx={{
          width: '100%',
          minHeight: isList ? 70 : 136,
          p: isList ? 1.25 : 1.5,
          pr: isList ? 5 : 1.5,
          display: 'flex',
          flexDirection: isList ? 'row' : 'column',
          justifyContent: isList ? 'flex-start' : 'center',
          alignItems: 'center',
          gap: isList ? 1.25 : 1,
          textAlign: isList ? 'left' : 'center',
          borderRadius: 3,
        }}
        title={props.item.path}
      >
        <Box sx={{ width: 54, height: 54, borderRadius: 3, display: 'grid', placeItems: 'center', color: 'primary.main', bgcolor: theme => alpha(theme.palette.primary.main, 0.1), border: theme => `1px solid ${alpha(theme.palette.primary.main, 0.16)}`, flexShrink: 0 }}>
          <FolderRoundedIcon />
        </Box>
        <Box sx={{ minWidth: 0, width: isList ? 'auto' : '100%', flex: isList ? 1 : 'none' }}>
          <Typography fontWeight={900} noWrap>{props.item.name}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="div">{props.item.path}</Typography>
          {props.groupCount > 1 ? <Chip size="small" label={groupName(props.doc, props.item.groupId)} sx={{ mt: 0.75, maxWidth: '100%' }} /> : null}
        </Box>
      </Button>
      <IconButton
        aria-label={`更多操作：${props.item.name}`}
        onClick={event => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); props.onContextMenu(rect.left, rect.bottom + 4) }}
        sx={{ position: 'absolute', top: 6, right: 6, bgcolor: theme => alpha(theme.palette.background.paper, 0.86), backdropFilter: 'blur(8px)' }}
      >
        <MoreVertRoundedIcon fontSize="small" />
      </IconButton>
    </Card>
  )
}

function EmptyState(props: { phase: Phase; search: string; onAdd(): void }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        minHeight: '100%',
        p: { xs: 3, sm: 5 },
        borderRadius: 4,
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
        bgcolor: 'background.paper',
      }}
    >
      <Stack spacing={1.5} alignItems="center" sx={{ maxWidth: 420 }}>
        <Box sx={{ width: 72, height: 72, borderRadius: 4, display: 'grid', placeItems: 'center', color: 'primary.main', bgcolor: theme => alpha(theme.palette.primary.main, 0.1) }}>
          <DriveFolderUploadRoundedIcon fontSize="large" />
        </Box>
        <Typography variant="h2">{props.search ? '未找到匹配的文件夹' : '暂无收藏文件夹'}</Typography>
        <Typography color="text.secondary">{props.search ? '换个关键词试试，或者把这个目录添加到收藏。' : '添加常用目录后，可以从这里一键打开、分组管理和快速搜索。'}</Typography>
        <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={props.onAdd} disabled={props.phase !== 'ready'}>添加文件夹</Button>
      </Stack>
    </Paper>
  )
}

function FolderContextMenu(props: {
  menu: ContextMenuState
  groups: FolderGroup[]
  doc: FoldersDoc
  onClose(): void
  onOpen(item: FolderItem): void
  onEdit(item: FolderItem): void
  onMove(item: FolderItem, groupId: string): void
  onDelete(item: FolderItem): void
}) {
  return (
    <Menu
      open={Boolean(props.menu)}
      onClose={props.onClose}
      anchorReference="anchorPosition"
      anchorPosition={props.menu ? { left: props.menu.x, top: props.menu.y } : undefined}
      onClick={event => event.stopPropagation()}
    >
      {props.menu ? [
        <MenuItem key="open" onClick={() => props.onOpen(props.menu!.item)}>
          <ListItemIcon><OpenInNewRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>打开</ListItemText>
        </MenuItem>,
        <MenuItem key="edit" onClick={() => props.onEdit(props.menu!.item)}>
          <ListItemIcon><EditRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>编辑</ListItemText>
        </MenuItem>,
        <Box key="move" sx={{ px: 2, py: 1, minWidth: 220 }}>
          <FormControl fullWidth size="small">
            <InputLabel id="context-move-label">移动到</InputLabel>
            <Select
              labelId="context-move-label"
              label="移动到"
              value={props.menu.item.groupId}
              onChange={event => props.onMove(props.menu!.item, event.target.value)}
            >
              {props.groups.map(group => <MenuItem key={group.id} value={group.id}>{group.name}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>,
        <Divider key="divider" />,
        <MenuItem key="delete" onClick={() => props.onDelete(props.menu!.item)} sx={{ color: 'error.main' }}>
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
      <DialogTitle>{props.editing?.id ? '编辑文件夹' : '添加文件夹'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
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
            <Button variant="outlined" startIcon={<LaunchRoundedIcon />} onClick={props.onPickPath} sx={{ minWidth: 96 }}>选择</Button>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
            <FormControl size="small" fullWidth>
              <InputLabel id="folder-form-group-label">分组</InputLabel>
              <Select labelId="folder-form-group-label" label="分组" value={props.form.groupId} onChange={(event: SelectChangeEvent) => props.onChange({ ...props.form, groupId: event.target.value })}>
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
          <Typography variant="caption" color="text.secondary">右键或点更多菜单可打开、编辑、移动或删除；删除会二次确认。</Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>取消</Button>
        <Button variant="contained" onClick={props.onSave} disabled={props.busy}>{props.editing?.id ? '保存' : '添加'}</Button>
      </DialogActions>
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
      <DialogTitle>{props.form.id ? '编辑分组' : '创建分组'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
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
                    variant={group.id === props.form.id ? 'contained' : 'outlined'}
                    onClick={() => props.onChange({ id: group.id, name: group.name })}
                    sx={{ justifyContent: 'space-between' }}
                  >
                    <span>{group.name}</span>
                    <Chip size="small" label={`${props.doc.items.filter(item => item.groupId === group.id).length} 个文件夹`} />
                  </Button>
                ))}
              </Stack>
            </Stack>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        {selected ? <Button color="error" startIcon={<DeleteOutlineRoundedIcon />} onClick={() => props.onDelete(selected)} disabled={props.busy}>删除分组</Button> : null}
        <Box sx={{ flex: 1 }} />
        <Button onClick={props.onNew}>新建</Button>
        <Button variant="contained" onClick={props.onSave} disabled={props.busy}>保存</Button>
      </DialogActions>
    </Dialog>
  )
}

function SettingsDialog(props: {
  busy: boolean
  doc: FoldersDoc
  open: boolean
  settings: FoldersSettings | null
  status: DataDirStatus | null
  onClose(): void
  onPickDataDir(): void
  onRestart(): void
  onSetView(view: 'grid' | 'list'): void
}) {
  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="md">
      <DialogTitle>设置</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
          <InfoBlock label="当前数据目录" value={props.status?.dataDir || '读取中'} mono />
          <InfoBlock label="默认数据目录" value={props.status?.defaultDataDir || '读取中'} mono />
          <InfoBlock label="数据版本" value={`${props.doc.schemaVersion} / ${props.doc.dataVersion}`} />
          <InfoBlock label="可写状态" value={props.status?.writable ? '可写' : '不可写或未知'} />
        </Box>
        {props.status?.error ? <Alert severity="error" sx={{ mt: 2 }}>{props.status.error}</Alert> : null}
        <Divider sx={{ my: 2 }} />
        <Stack spacing={1}>
          <Typography variant="h3">显示方式</Typography>
          <ToggleButtonGroup value={props.settings?.view || 'grid'} exclusive size="small" onChange={(_, next: 'grid' | 'list' | null) => { if (next) props.onSetView(next) }} aria-label="设置显示方式">
            <ToggleButton value="grid" aria-label="宫格视图"><GridViewRoundedIcon fontSize="small" sx={{ mr: 0.75 }} />宫格视图</ToggleButton>
            <ToggleButton value="list" aria-label="列表视图"><ListRoundedIcon fontSize="small" sx={{ mr: 0.75 }} />列表视图</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button startIcon={<SplitscreenRoundedIcon />} onClick={props.onPickDataDir} disabled={props.busy}>选择数据目录</Button>
        <Button startIcon={<RestartAltRoundedIcon />} onClick={props.onRestart} disabled={props.busy}>重启后台</Button>
        <Button variant="contained" onClick={props.onClose}>完成</Button>
      </DialogActions>
    </Dialog>
  )
}

function InfoBlock(props: { label: string; value: string; mono?: boolean }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2.5, minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary">{props.label}</Typography>
      <Typography sx={{ mt: 0.5, overflowWrap: 'anywhere', fontFamily: props.mono ? 'ui-monospace, SFMono-Regular, Consolas, monospace' : undefined }}>{props.value}</Typography>
    </Paper>
  )
}

function ConfirmDialog(props: { busy: boolean; confirm: ConfirmState; doc: FoldersDoc; onClose(): void; onConfirm(): void }) {
  const groupItemCount = props.confirm?.kind === 'group' ? props.doc.items.filter(item => item.groupId === props.confirm?.id).length : 0
  return (
    <Dialog open={Boolean(props.confirm)} onClose={props.onClose} fullWidth maxWidth="xs">
      <DialogTitle>确认删除</DialogTitle>
      <DialogContent dividers>
        <Typography>
          {props.confirm?.kind === 'group'
            ? `删除分组“${props.confirm.label}”？组内 ${groupItemCount} 个文件夹会移回默认分组。`
            : `删除文件夹“${props.confirm?.label || ''}”？`}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>取消</Button>
        <Button color="error" variant="contained" onClick={props.onConfirm} disabled={props.busy}>确认删除</Button>
      </DialogActions>
    </Dialog>
  )
}
