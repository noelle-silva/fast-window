import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Alert, Box } from '@mui/material'
import { showToast } from '../fw-app-sdk/windowPolicy'
import { type DesktopGridLayoutPatch } from '../shared/desktop-grid'
import { BookmarkGridCanvas } from './BookmarkGridCanvas'
import { BookmarkContextMenu } from './components/BookmarkContextMenu'
import { BookmarkDialog, ConfirmDialog, GroupDialog, SettingsDialog } from './components/Dialogs'
import { DesktopBackdrop } from './components/DesktopBackdrop'
import { StatusNotice } from './components/StatusNotice'
import { TopBar } from './components/TopBar'
import { createDirectBackgroundClient, type DirectBackgroundClient } from './directClient'
import type { BookmarkData, BookmarkFormState, BookmarkGridEntry, BookmarkGroup, BookmarkItem, ConfirmState, ContextMenuState, DataDirStatus, FwLaunchInfo, GroupFormState, Phase } from './types'
import { ALL_GROUP_ID, DEFAULT_GROUP_ID, DEFAULT_LAUNCH_INFO, EMPTY_DATA, bookmarkDetail, bookmarkTitle, errorMessage, sortedGroups } from './utils'

const ERROR_AUTO_HIDE_MS = 4200
const EMPTY_BOOKMARK_FORM: BookmarkFormState = { title: '', url: '', groupId: DEFAULT_GROUP_ID, iconUrl: '' }
const EMPTY_GROUP_FORM: GroupFormState = { id: '', name: '' }

export function App(): React.ReactNode {
  const [launchInfo, setLaunchInfo] = React.useState<FwLaunchInfo>(DEFAULT_LAUNCH_INFO)
  const [client, setClient] = React.useState<DirectBackgroundClient | null>(null)
  const [data, setData] = React.useState<BookmarkData>(EMPTY_DATA)
  const [phase, setPhase] = React.useState<Phase>('starting')
  const [status, setStatus] = React.useState<DataDirStatus | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const [groupId, setGroupId] = React.useState(ALL_GROUP_ID)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [bookmarkDialogOpen, setBookmarkDialogOpen] = React.useState(false)
  const [editingBookmark, setEditingBookmark] = React.useState<BookmarkItem | null>(null)
  const [bookmarkForm, setBookmarkForm] = React.useState<BookmarkFormState>(EMPTY_BOOKMARK_FORM)
  const [groupDialogOpen, setGroupDialogOpen] = React.useState(false)
  const [groupForm, setGroupForm] = React.useState<GroupFormState>(EMPTY_GROUP_FORM)
  const [confirm, setConfirm] = React.useState<ConfirmState>(null)
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState>(null)
  const readyRef = React.useRef(false)

  const refreshStatus = React.useCallback(async () => {
    const next = await invoke<DataDirStatus>('data_dir_status').catch(() => null)
    setStatus(next)
    return next
  }, [])

  const connect = React.useCallback(async () => {
    setBusy(true)
    setError(null)
    setPhase('starting')
    client?.close()
    setClient(null)
    try {
      const nextClient = await createDirectBackgroundClient(() => invoke<{ url: string; token: string }>('backend_endpoint'))
      const nextData = await nextClient.invoke<BookmarkData>('bookmarks.list')
      setClient(nextClient)
      setData(nextData)
      setPhase('ready')
      await refreshStatus()
    } catch (err) {
      setPhase('failed')
      setError(errorMessage(err, '启动网站收藏后台失败'))
      await refreshStatus()
    } finally {
      setBusy(false)
    }
  }, [client, refreshStatus])

  React.useEffect(() => {
    if (!readyRef.current) {
      readyRef.current = true
      void invoke('app_ready').catch(() => {})
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const [nextLaunchInfo, initialCommand] = await Promise.all([
        invoke<FwLaunchInfo>('fw_launch_info').catch(() => DEFAULT_LAUNCH_INFO),
        invoke<string | null>('fw_initial_command').catch(() => null),
      ])
      if (cancelled) return
      setLaunchInfo(nextLaunchInfo)
      await refreshStatus()
      if (!cancelled) {
        await connect()
        if (initialCommand) handleCommand(initialCommand)
      }
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
    if (!error || phase === 'failed') return
    const timer = window.setTimeout(() => setError(null), ERROR_AUTO_HIDE_MS)
    return () => window.clearTimeout(timer)
  }, [error, phase])
  React.useEffect(() => {
    const close = () => setContextMenu(null)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true) }
  }, [])

  function handleCommand(command: string) {
    if (command === 'add' || command === 'new' || command === 'new-bookmark') openAddBookmark()
    if (command === 'open-settings') setSettingsOpen(true)
  }

  async function request<T>(method: string, params?: unknown): Promise<T> {
    if (!client) throw new Error('网站收藏后台未连接')
    return client.invoke<T>(method, params)
  }

  async function reload() {
    setData(await request<BookmarkData>('bookmarks.list'))
  }

  function openAddBookmark() {
    const selectedGroup = groupId === ALL_GROUP_ID ? DEFAULT_GROUP_ID : groupId
    setEditingBookmark(null)
    setBookmarkForm({ ...EMPTY_BOOKMARK_FORM, groupId: selectedGroup })
    setBookmarkDialogOpen(true)
    setContextMenu(null)
  }

  function openEditBookmark(item: BookmarkItem) {
    setEditingBookmark(item)
    setBookmarkForm({ title: item.title || '', url: item.url || '', groupId: data.groups.some(group => group.id === item.groupId) ? item.groupId : DEFAULT_GROUP_ID, iconUrl: item.iconUrl || '' })
    setBookmarkDialogOpen(true)
    setContextMenu(null)
  }

  function openGroupEditor(group?: BookmarkGroup) {
    setGroupForm(group && group.id !== DEFAULT_GROUP_ID ? { id: group.id, name: group.name } : EMPTY_GROUP_FORM)
    setGroupDialogOpen(true)
  }

  async function saveBookmark() {
    if (!client) return
    const url = bookmarkForm.url.trim()
    if (!url) { setError('URL 不能为空'); return }
    setBusy(true); setError(null)
    try {
      const payload = { title: bookmarkForm.title, url, groupId: bookmarkForm.groupId || DEFAULT_GROUP_ID, iconUrl: bookmarkForm.iconUrl }
      const nextData = editingBookmark
        ? await request<BookmarkData>('bookmarks.update', { id: editingBookmark.id, ...payload })
        : await request<BookmarkData>('bookmarks.add', payload)
      setData(nextData)
      setBookmarkDialogOpen(false)
      setEditingBookmark(null)
      showToast(editingBookmark ? '已保存收藏' : '已添加收藏')
    } catch (err) {
      setError(errorMessage(err, '保存收藏失败'))
    } finally {
      setBusy(false)
    }
  }

  async function inferIcon() {
    setBusy(true); setError(null)
    try {
      const result = await request<{ iconUrl: string }>('bookmarks.inferIcon', { url: bookmarkForm.url })
      setBookmarkForm(current => ({ ...current, iconUrl: result.iconUrl || '' }))
    } catch (err) {
      setError(errorMessage(err, '推断图标失败'))
    } finally {
      setBusy(false)
    }
  }

  async function openBookmark(item: BookmarkItem) {
    setBusy(true); setError(null); setContextMenu(null)
    try {
      setData(await request<BookmarkData>('bookmarks.open', { id: item.id }))
    } catch (err) {
      setError(errorMessage(err, '打开收藏失败'))
    } finally {
      setBusy(false)
    }
  }

  async function refreshIcon(item: BookmarkItem) {
    setBusy(true); setError(null); setContextMenu(null)
    try {
      setData(await request<BookmarkData>('bookmarks.refreshIcon', { id: item.id }))
      showToast('图标已刷新')
    } catch (err) {
      setError(errorMessage(err, '刷新图标失败'))
    } finally {
      setBusy(false)
    }
  }

  async function deleteBookmark(item: BookmarkItem) {
    setBusy(true); setError(null)
    try {
      setData(await request<BookmarkData>('bookmarks.delete', { id: item.id }))
      setConfirm(null)
      setContextMenu(null)
    } catch (err) {
      setError(errorMessage(err, '删除收藏失败'))
    } finally {
      setBusy(false)
    }
  }

  async function saveGroup() {
    if (!client) return
    const name = groupForm.name.trim()
    if (!name) { setError('分组名称不能为空'); return }
    setBusy(true); setError(null)
    try {
      const nextData = groupForm.id
        ? await request<BookmarkData>('bookmarks.renameGroup', { groupId: groupForm.id, name })
        : await request<BookmarkData>('bookmarks.addGroup', { name })
      setData(nextData)
      setGroupDialogOpen(false)
      setGroupForm(EMPTY_GROUP_FORM)
    } catch (err) {
      setError(errorMessage(err, '保存分组失败'))
    } finally {
      setBusy(false)
    }
  }

  async function deleteGroup(group: BookmarkGroup) {
    setBusy(true); setError(null)
    try {
      setData(await request<BookmarkData>('bookmarks.deleteGroup', { groupId: group.id }))
      if (groupId === group.id) setGroupId(ALL_GROUP_ID)
      setConfirm(null)
      setGroupDialogOpen(false)
      setGroupForm(EMPTY_GROUP_FORM)
    } catch (err) {
      setError(errorMessage(err, '删除分组失败'))
    } finally {
      setBusy(false)
    }
  }

  async function saveLayouts(patches: DesktopGridLayoutPatch[]) {
    if (!client || patches.length === 0) return
    const previousData = data
    setError(null)
    setData(current => ({
      ...current,
      items: current.items.map(item => {
        const patch = patches.find(currentPatch => currentPatch.id === item.id)
        return patch ? { ...item, layout: patch.layout } : item
      }),
    }))
    try {
      setData(await request<BookmarkData>('bookmarks.layout.save', { items: patches }))
    } catch (err) {
      setData(previousData)
      setError(errorMessage(err, '保存桌面布局失败'))
    }
  }

  async function pickDataDir() {
    setBusy(true); setError(null)
    try {
      const next = await invoke<DataDirStatus | null>('pick_data_dir')
      if (next) setStatus(next)
      await connect()
    } catch (err) {
      setPhase('failed')
      setError(errorMessage(err, '切换数据目录失败'))
      await refreshStatus()
    } finally {
      setBusy(false)
    }
  }

  const groups = React.useMemo(() => sortedGroups(data.groups), [data.groups])
  const allEntries = React.useMemo<BookmarkGridEntry[]>(() => data.items.map(item => ({ id: item.id, kind: 'item', name: bookmarkTitle(item), layout: item.layout, item })), [data.items])
  const filteredEntries = React.useMemo(() => filterEntries(allEntries, groupId, search), [allEntries, groupId, search])
  const selectedGroup = groups.find(group => group.id === groupId)
  const editableGroups = groups.filter(group => group.id !== DEFAULT_GROUP_ID)

  return (
    <Box
      component="main"
      onClick={() => setContextMenu(null)}
      sx={{ position: 'relative', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.default' }}
    >
      <DesktopBackdrop />
      <Box sx={{ position: 'relative', zIndex: 1, minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <TopBar
          busy={busy}
          data={data}
          groupId={groupId}
          launchInfo={launchInfo}
          phase={phase}
          search={search}
          selectedGroup={selectedGroup}
          onAdd={openAddBookmark}
          onGroupChange={setGroupId}
          onOpenGroupEditor={() => openGroupEditor(selectedGroup?.id === DEFAULT_GROUP_ID ? undefined : selectedGroup)}
          onOpenSettings={() => setSettingsOpen(true)}
          onSearchChange={setSearch}
        />

        <StatusNotice busy={busy} error={error} phase={phase} status={status} onPickDataDir={pickDataDir} onRestart={() => void connect()} />

        <BookmarkGridCanvas
          allEntries={allEntries}
          entries={filteredEntries}
          phase={phase}
          search={search}
          onAdd={openAddBookmark}
          onContextMenu={(item, x, y) => setContextMenu({ item, x, y })}
          onLayoutCommit={patches => void saveLayouts(patches)}
          onOpen={item => void openBookmark(item)}
        />

        {error && phase !== 'failed' ? <Alert severity="error" sx={{ mx: { xs: 1.5, sm: 2 }, mb: 1.5 }}>{error}</Alert> : null}

        <BookmarkContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onDelete={item => setConfirm({ kind: 'bookmark', id: item.id, label: bookmarkTitle(item) })}
          onEdit={openEditBookmark}
          onOpen={item => void openBookmark(item)}
          onRefreshIcon={item => void refreshIcon(item)}
        />

        <BookmarkDialog
          busy={busy}
          data={data}
          editing={editingBookmark}
          form={bookmarkForm}
          open={bookmarkDialogOpen}
          onChange={setBookmarkForm}
          onClose={() => { setBookmarkDialogOpen(false); setEditingBookmark(null) }}
          onInferIcon={() => void inferIcon()}
          onSave={() => void saveBookmark()}
        />

        <GroupDialog
          busy={busy}
          data={data}
          editableGroups={editableGroups}
          form={groupForm}
          open={groupDialogOpen}
          onChange={setGroupForm}
          onClose={() => setGroupDialogOpen(false)}
          onDelete={group => setConfirm({ kind: 'group', id: group.id, label: group.name })}
          onNew={() => setGroupForm(EMPTY_GROUP_FORM)}
          onSave={() => void saveGroup()}
        />

        <SettingsDialog
          busy={busy}
          open={settingsOpen}
          status={status}
          error={error}
          onClose={() => setSettingsOpen(false)}
          onPickDataDir={pickDataDir}
          onReload={() => void reload()}
        />

        <ConfirmDialog
          busy={busy}
          confirm={confirm}
          data={data}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            if (!confirm) return
            if (confirm.kind === 'bookmark') {
              const item = data.items.find(current => current.id === confirm.id)
              if (item) void deleteBookmark(item)
              else setConfirm(null)
            }
            if (confirm.kind === 'group') {
              const group = data.groups.find(current => current.id === confirm.id)
              if (group) void deleteGroup(group)
              else setConfirm(null)
            }
          }}
        />
      </Box>
    </Box>
  )
}

function filterEntries(entries: BookmarkGridEntry[], groupId: string, search: string): BookmarkGridEntry[] {
  const q = search.trim().toLowerCase()
  return entries.filter(entry => {
    if (groupId !== ALL_GROUP_ID && entry.item.groupId !== groupId) return false
    if (!q) return true
    return bookmarkTitle(entry.item).toLowerCase().includes(q) || entry.item.url.toLowerCase().includes(q) || bookmarkDetail(entry.item).toLowerCase().includes(q)
  })
}
