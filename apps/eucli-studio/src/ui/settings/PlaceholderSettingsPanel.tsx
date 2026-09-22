import * as React from 'react'
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, IconButton, InputLabel, Menu, MenuItem, Select, Stack, TextField, Tooltip, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import BookmarkBorderOutlinedIcon from '@mui/icons-material/BookmarkBorderOutlined'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import RefreshIcon from '@mui/icons-material/Refresh'
import SaveIcon from '@mui/icons-material/Save'
import {
  createPlaceholderFolder,
  createPlaceholderItem,
  normalizePlaceholderLibrary,
  placeholderProblemLabel,
  type PlaceholderFolder,
  type PlaceholderItem,
  type PlaceholderLibrary,
} from '../../domain/placeholder'
import { systemPluginLocatorId } from '../../domain/systemPlugin'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { customScrollbarHiddenSx } from '../scroll/customScrollbars'
import { PlaceholderDependencyTreePanel } from './PlaceholderDependencyTreePanel'
import {
  addDraftPlaceholder,
  computeDirtyNames,
  createPlaceholderDraft,
  markDraftPlaceholderSaved,
  planPlaceholderCreate,
  planPlaceholderDelete,
  planPlaceholderSave,
  removeDraftPlaceholder,
  renameDraftPlaceholder,
  serverIdentityOf,
  setDraftFolderMembership,
  updateDraftLibrary,
  updateDraftPlaceholder,
  type PlaceholderDraft,
} from './placeholderDraft'
import { SettingsListItem, SettingsPill, SettingsSection, SettingsSurface } from './SettingsSurfaces'

type PlaceholderSettingsPanelProps = {
  controller: any
  loading: boolean
  placeholders: any
  systemPlugins?: any
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function cloneLibrary(raw: unknown): PlaceholderLibrary {
  return normalizePlaceholderLibrary(raw)
}

type PlaceholderDraftCache = {
  base: any
  draft: PlaceholderDraft
}

// 客户端层面的未保存草稿缓存：切换设置页或切换占位符时都不丢未保存的修改。
let placeholderDraftCache: PlaceholderDraftCache | null = null

function folderDepth(folder: PlaceholderFolder, folders: PlaceholderFolder[]) {
  let depth = 0
  let parentId = text(folder.parentId)
  const seen = new Set<string>()
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = folders.find((item) => item.id === parentId)
    if (!parent) break
    depth += 1
    parentId = text(parent.parentId)
  }
  return depth
}

function sortedFolders(folders: PlaceholderFolder[]) {
  return folders.slice().sort((left, right) => {
    const depth = folderDepth(left, folders) - folderDepth(right, folders)
    return depth || left.name.localeCompare(right.name)
  })
}

function formatTime(value: unknown) {
  const raw = text(value)
  if (!raw) return '未知时间'
  const time = Date.parse(raw)
  if (!isFinite(time)) return raw
  return new Date(time).toLocaleString('zh-CN')
}

export function PlaceholderSettingsPanel(props: PlaceholderSettingsPanelProps) {
  const { controller, loading, placeholders, systemPlugins } = props
  const sourceLibrary = React.useMemo(() => placeholders?.library || { placeholders: [], folders: [] }, [placeholders?.library])
  const busy = loading || !!placeholders?.loading
  const restoredDraft = placeholderDraftCache && placeholderDraftCache.base === (placeholders?.library ?? null) ? placeholderDraftCache : null
  const [draftState, setDraftState] = React.useState<PlaceholderDraft>(() => (restoredDraft ? restoredDraft.draft : createPlaceholderDraft(sourceLibrary)))
  const draft = draftState.library
  // 自己的保存不覆盖草稿里其他未保存改动：保存期间与保存结果都不触发草稿重置。
  const savedLibraryRef = React.useRef<any>(null)
  const skipNextSyncRef = React.useRef(!!restoredDraft)
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const [selectedFolderId, setSelectedFolderId] = React.useState('')
  const [previewText, setPreviewText] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState('')
  const [pluginDialogOpen, setPluginDialogOpen] = React.useState(false)
  const [previewDialogOpen, setPreviewDialogOpen] = React.useState(false)
  const [problemsDialogOpen, setProblemsDialogOpen] = React.useState(false)
  const [folderMenuEl, setFolderMenuEl] = React.useState<HTMLElement | null>(null)
  const [folderMenuWidth, setFolderMenuWidth] = React.useState<number | undefined>(undefined)
  const [folderDialogOpen, setFolderDialogOpen] = React.useState(false)
  const [folderDraft, setFolderDraft] = React.useState<{ name: string; parentId: string }>({ name: '', parentId: '' })
  const [createFolderDialog, setCreateFolderDialog] = React.useState<{ open: boolean; name: string }>({ open: false, name: '' })
  const [favoriteDialog, setFavoriteDialog] = React.useState<{ open: boolean; name: string; checked: Record<string, boolean> }>({ open: false, name: '', checked: {} })

  React.useEffect(() => {
    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false
      return
    }
    if (savedLibraryRef.current === 'saving') return
    if (savedLibraryRef.current && savedLibraryRef.current === sourceLibrary) return
    savedLibraryRef.current = null
    const next = createPlaceholderDraft(sourceLibrary)
    setDraftState(next)
    setSelectedIndex((current) => Math.min(Math.max(0, current), Math.max(0, next.library.placeholders.length - 1)))
  }, [sourceLibrary])

  React.useEffect(() => {
    placeholderDraftCache = { base: placeholders?.library ?? null, draft: draftState }
  }, [draftState, placeholders?.library])

  React.useEffect(() => {
    controller.actions.refreshPlaceholderLibrary?.(false)
  }, [controller])

  // 占位符界面需要知道来源插件是否已停用；插件列表为空时顺带补一次读取。
  React.useEffect(() => {
    controller.actions.refreshSystemPlugins?.(false)
  }, [controller])

  const pluginEnabledById = React.useMemo(() => {
    const map = new Map<string, boolean>()
    const items = Array.isArray(systemPlugins?.items) ? systemPlugins.items : []
    for (const item of items) {
      const id = systemPluginLocatorId(item)
      if (id) map.set(id, item.enabled !== false)
    }
    return map
  }, [systemPlugins?.items])

  const sourcePluginDisabled = (item: PlaceholderItem) =>
    item.source?.kind === 'system_plugin' && pluginEnabledById.get(String(item.source.pluginId || '')) === false

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      controller.actions.previewPlaceholders?.(previewText)?.catch?.(() => null)
    }, 240)
    return () => window.clearTimeout(timer)
  }, [controller, previewText])

  const selectedPlaceholder = draft.placeholders[selectedIndex] || null
  // 依赖树是服务端按已保存数据解析的结果：按服务端身份加载，并在服务端库变化（含保存）后重新加载。
  const selectedServerName = selectedPlaceholder ? serverIdentityOf(draftState, selectedPlaceholder.name) : ''

  React.useEffect(() => {
    if (!selectedServerName) return
    controller.actions.loadPlaceholderDependencies?.(selectedServerName)?.catch?.(() => null)
  }, [controller, selectedServerName, placeholders?.library])

  const selectedFolder = draft.folders.find((folder) => folder.id === selectedFolderId) || null
  const filteredPlaceholders = draft.placeholders
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => selectedFolder ? selectedFolder.placeholderNames?.includes(item.name) : true)
  const nameCounts = draft.placeholders.reduce((acc, item) => {
    const name = text(item.name)
    if (name) acc[name] = (acc[name] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  const hasEmptyName = draft.placeholders.some((item) => !text(item.name))
  const hasDuplicateName = Object.values(nameCounts).some((count) => count > 1)
  const problems = Array.isArray(placeholders?.problems) ? placeholders.problems : []

  // 未保存标记：草稿与服务端有差异的条目（含改名与收藏归属）。
  const dirtyNames = React.useMemo(() => computeDirtyNames(placeholders?.library, draftState), [placeholders?.library, draftState])

  const persistLibrary = async (next: PlaceholderLibrary) => {
    savedLibraryRef.current = 'saving'
    try {
      const saved = await controller.actions.savePlaceholderLibrary?.(next)
      savedLibraryRef.current = saved || null
      return (saved || null) as PlaceholderLibrary | null
    } catch (e) {
      savedLibraryRef.current = null
      throw e
    }
  }

  const runPersist = async (next: PlaceholderLibrary, afterSuccess: () => void) => {
    setSaving(true)
    setSaveError('')
    try {
      await persistLibrary(next)
      afterSuccess()
      return true
    } catch (e: any) {
      setSaveError(String(e?.message || e || '保存失败'))
      return false
    } finally {
      setSaving(false)
    }
  }

  // 保存以占位符为粒度：只把草稿里这个占位符的字段与收藏归属合并进服务端数据，其他未保存改动留在草稿里。
  const savePlaceholderByName = async (draftNameRaw: string, membershipOverride?: Record<string, boolean>) => {
    const draftName = text(draftNameRaw)
    const plan = planPlaceholderSave(placeholders?.library, draftState, draftName, membershipOverride)
    if (!plan.ok) {
      setSaveError(plan.error)
      return false
    }
    return runPersist(plan.library, () => {
      setDraftState((current) => markDraftPlaceholderSaved(current, draftName))
    })
  }

  const saveSelectedPlaceholder = async () => {
    const item = draft.placeholders[selectedIndex]
    if (!item) return
    await savePlaceholderByName(text(item.name))
  }

  const createItem = async () => {
    const baseInput = placeholders?.library
    if (!baseInput) return
    const knownNames = new Set([
      ...cloneLibrary(baseInput).placeholders.map((entry) => text(entry.name)),
      ...draft.placeholders.map((entry) => text(entry.name)),
    ].filter(Boolean))
    let nextName = '新占位符'
    let suffix = 2
    while (knownNames.has(nextName)) {
      nextName = `新占位符 ${suffix}`
      suffix += 1
    }
    const item: PlaceholderItem = { ...createPlaceholderItem(), name: nextName }
    const folderId = selectedFolderId
    await runPersist(planPlaceholderCreate(baseInput, item, folderId), () => {
      setDraftState((current) => addDraftPlaceholder(current, item, folderId))
      setSelectedIndex(draft.placeholders.length)
    })
  }

  const deleteItem = async (index: number, name: string) => {
    const draftName = text(name)
    const baseInput = placeholders?.library
    if (!baseInput || !draftName) return
    const identity = serverIdentityOf(draftState, draftName)
    await runPersist(planPlaceholderDelete(baseInput, [identity, draftName]), () => {
      setDraftState((current) => removeDraftPlaceholder(current, draftName))
      setSelectedIndex((current) => Math.max(0, Math.min(current, draft.placeholders.length - 2)))
    })
  }

  const renameItem = (index: number, nextName: string) => {
    setDraftState((current) => renameDraftPlaceholder(current, index, nextName))
  }

  const createFolder = async (nameRaw: string) => {
    const name = text(nameRaw)
    if (!name) return false
    const baseInput = placeholders?.library
    if (!baseInput) return false
    const folder = { ...createPlaceholderFolder(), name }
    const next = cloneLibrary(baseInput)
    next.folders = next.folders.concat(folder)
    return runPersist(next, () => {
      setDraftState((current) => updateDraftLibrary(current, (library) => ({ ...library, folders: library.folders.concat(folder) })))
      setSelectedFolderId(folder.id)
    })
  }

  const updateFolder = async (folderId: string, patch: Partial<PlaceholderFolder>) => {
    const baseInput = placeholders?.library
    if (!baseInput) return false
    const updatedAt = new Date().toISOString()
    const applyPatch = (folder: PlaceholderFolder) => (folder.id === folderId ? { ...folder, ...patch, updatedAt } : folder)
    const next = cloneLibrary(baseInput)
    next.folders = next.folders.map(applyPatch)
    return runPersist(next, () => {
      setDraftState((current) => updateDraftLibrary(current, (library) => ({ ...library, folders: library.folders.map(applyPatch) })))
    })
  }

  const deleteFolder = async (folderId: string) => {
    const baseInput = placeholders?.library
    if (!baseInput) return
    const updatedAt = new Date().toISOString()
    const applyDelete = (folders: PlaceholderFolder[]) => folders
      .filter((folder) => folder.id !== folderId)
      .map((folder) => (folder.parentId === folderId ? { ...folder, parentId: '', updatedAt } : folder))
    const next = cloneLibrary(baseInput)
    next.folders = applyDelete(next.folders)
    await runPersist(next, () => {
      setDraftState((current) => updateDraftLibrary(current, (library) => ({ ...library, folders: applyDelete(library.folders) })))
      if (selectedFolderId === folderId) setSelectedFolderId('')
    })
  }

  const copyPlaceholderToken = (name: string) => {
    const token = `{{${text(name)}}}`
    const capabilities = controller?.capabilities
    const writeText = capabilities?.clipboard?.writeText
    if (typeof writeText !== 'function') return capabilities?.ui?.showToast?.('未授权：clipboard.writeText', { kind: 'error' })
    Promise.resolve()
      .then(() => writeText(token))
      .then(() => capabilities?.ui?.showToast?.('已复制占位符', { kind: 'success' }))
      .catch(() => capabilities?.ui?.showToast?.('复制失败', { kind: 'error' }))
  }

  const openFavoriteDialog = (name: string) => {
    const target = text(name)
    if (!target) return
    const checked: Record<string, boolean> = {}
    for (const folder of draft.folders) checked[folder.id] = !!folder.placeholderNames?.includes(target)
    setFavoriteDialog({ open: true, name: target, checked })
  }

  const closeFavoriteDialog = () => setFavoriteDialog({ open: false, name: '', checked: {} })

  const toggleFavoriteDialogFolder = (folderId: string) => {
    setFavoriteDialog((current) => ({ ...current, checked: { ...current.checked, [folderId]: !current.checked[folderId] } }))
  }

  const saveFavoriteDialog = async () => {
    const target = text(favoriteDialog.name)
    if (!target) return
    const membership = favoriteDialog.checked
    const ok = await savePlaceholderByName(target, membership)
    if (!ok) return
    setDraftState((current) => setDraftFolderMembership(current, target, membership))
    closeFavoriteDialog()
  }

  const openPluginDialog = async () => {
    setPluginDialogOpen(true)
    await controller.actions.refreshAvailableSystemPluginPlaceholderInterfaces?.().catch?.(() => null)
  }

  const createFromPlugin = async (pluginId: string, interfaceId: string) => {
    // 外部创建以服务端结果为准：草稿随刷新后的服务端数据重置（与“刷新”同一语义）。
    await controller.actions.createPlaceholderFromSystemPlugin?.(pluginId, interfaceId)
    setPluginDialogOpen(false)
  }

  return (
    <SettingsSurface sx={{ height: '100%' }}>
      <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 900 }}>占位符管理</Typography>
            <Typography variant="caption" color="text.secondary">使用 {`{{名字}}`} 在提示词里引用；替换只发生在发送给 AI 前。</Typography>
          </Box>
          <Button startIcon={<RefreshIcon />} variant="text" onClick={() => controller.actions.refreshPlaceholderLibrary?.(true)} disabled={busy || saving}>{placeholders?.loading ? '刷新中…' : '刷新'}</Button>
          <Button variant="text" onClick={() => setPreviewDialogOpen(true)}>解析预览</Button>
          <Button variant="text" color={problems.length ? 'error' : 'inherit'} onClick={() => setProblemsDialogOpen(true)}>问题看板{problems.length ? `（${problems.length}）` : ''}</Button>
          <Button variant="text" onClick={openPluginDialog} disabled={busy || saving}>从插件接口创建占位符</Button>
          <Button startIcon={<AddIcon />} variant="text" onClick={() => { void createItem() }} disabled={busy || saving}>新建占位符</Button>
        </Stack>

        {placeholders?.error ? <Typography variant="body2" color="error">{String(placeholders.error || '')}</Typography> : null}
        {saveError ? <Typography variant="body2" color="error">{saveError}</Typography> : null}
        {hasEmptyName ? <Typography variant="body2" color="error">占位符名字不能为空。</Typography> : null}
        {hasDuplicateName ? <Typography variant="body2" color="error">占位符名字必须全局唯一。</Typography> : null}

        <Stack direction="row" spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
          <SettingsSection tone="muted" sx={{ p: 1, width: { xs: 200, sm: 240, lg: 280 }, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 900 }}>占位符列表</Typography>
              <Button
                size="small"
                variant="outlined"
                startIcon={<FolderOutlinedIcon fontSize="small" />}
                endIcon={<ArrowDropDownIcon fontSize="small" />}
                onClick={(event) => {
                  setFolderMenuWidth(event.currentTarget.getBoundingClientRect().width)
                  setFolderMenuEl(event.currentTarget)
                }}
                sx={{ justifyContent: 'flex-start', minWidth: 0, width: '100%', textTransform: 'none' }}
              >
                <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedFolder ? selectedFolder.name : '全部占位符'}</Box>
              </Button>
              <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', ...customScrollbarHiddenSx }}>
                <Stack spacing={1}>
                  {filteredPlaceholders.length ? filteredPlaceholders.map(({ item, index }) => {
                    const selected = index === selectedIndex
                    const label = text(item.name) || `未命名占位符 ${index + 1}`
                    const disabledByPlugin = sourcePluginDisabled(item)
                    return (
                      <Box key={`${item.name}:${index}`} sx={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 0.25 }}>
                        <Button variant={selected ? 'contained' : 'text'} color={selected ? 'primary' : disabledByPlugin ? 'error' : 'inherit'} onClick={() => setSelectedIndex(index)} sx={{ justifyContent: 'flex-start', minWidth: 0, flex: 1, textTransform: 'none' }}><Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{disabledByPlugin ? `${label}（插件已停用）` : label}</Box></Button>
                        <Tooltip title={`复制 {{${text(item.name) || '名字'}}}`}>
                          <span>
                            <IconButton size="small" aria-label={`复制占位符 ${label}`} onClick={() => copyPlaceholderToken(item.name)} disabled={!text(item.name)}>
                              <ContentCopyIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="收藏到收藏夹">
                          <span>
                            <IconButton size="small" aria-label={`收藏 ${label}`} onClick={() => openFavoriteDialog(item.name)} disabled={!text(item.name)}>
                              <BookmarkBorderOutlinedIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        {dirtyNames.has(text(item.name)) ? (
                          <Tooltip title="有未保存的修改">
                            <Box sx={{ position: 'absolute', top: 0, right: 0, width: 8, height: 8, borderRadius: '50%', bgcolor: 'warning.main', boxShadow: '0 0 0 2px var(--studio-field)', pointerEvents: 'none' }} />
                          </Tooltip>
                        ) : null}
                      </Box>
                    )
                  }) : <Typography variant="body2" color="text.secondary">暂无占位符。</Typography>}
                </Stack>
              </Box>
            </Stack>
          </SettingsSection>

          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            <CustomScrollArea hostSx={{ height: '100%', minHeight: 0 }} scrollSx={{ height: '100%' }}>
              {selectedPlaceholder ? (
                <Stack spacing={1.25}>
                  <PlaceholderEditor
                    item={selectedPlaceholder}
                    folders={draft.folders}
                    disabled={busy || saving}
                    saving={saving}
                    sourcePluginDisabled={sourcePluginDisabled(selectedPlaceholder)}
                    onRename={(nextName) => renameItem(selectedIndex, nextName)}
                    onUpdate={(patch) => setDraftState((current) => updateDraftPlaceholder(current, selectedIndex, patch))}
                    onSave={() => { void saveSelectedPlaceholder() }}
                    onDelete={() => { void deleteItem(selectedIndex, selectedPlaceholder.name) }}
                  />
                  <PlaceholderDependencyTreePanel tree={placeholders?.dependencyTree} />
                </Stack>
              ) : (
                <SettingsSection sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">选择一个占位符，或新建后开始编辑。</Typography></SettingsSection>
              )}
            </CustomScrollArea>
          </Box>
        </Stack>

        <Menu
          anchorEl={folderMenuEl}
          open={!!folderMenuEl}
          onClose={() => setFolderMenuEl(null)}
          transitionDuration={{ enter: 0, exit: 0 }}
          PaperProps={{ sx: { width: folderMenuWidth || undefined } }}
        >
          <MenuItem
            selected={!selectedFolderId}
            onClick={() => {
              setSelectedFolderId('')
              setFolderMenuEl(null)
            }}
          >
            全部占位符
          </MenuItem>
          {sortedFolders(draft.folders).map((folder) => (
            <MenuItem
              key={folder.id}
              selected={selectedFolderId === folder.id}
              onClick={() => {
                setSelectedFolderId(folder.id)
                setFolderMenuEl(null)
              }}
              sx={{ pl: 2 + folderDepth(folder, draft.folders) * 2 }}
            >
              {folder.name}
            </MenuItem>
          ))}
          <Divider />
          <MenuItem
            onClick={() => {
              setCreateFolderDialog({ open: true, name: '' })
              setFolderMenuEl(null)
            }}
          >
            <AddIcon fontSize="small" sx={{ mr: 1 }} />
            新建收藏夹
          </MenuItem>
          <MenuItem
            disabled={!selectedFolder}
            onClick={() => {
              if (selectedFolder) setFolderDraft({ name: selectedFolder.name, parentId: selectedFolder.parentId || '' })
              setFolderDialogOpen(true)
              setFolderMenuEl(null)
            }}
          >
            收藏夹设置…
          </MenuItem>
        </Menu>

        <Dialog open={favoriteDialog.open} onClose={closeFavoriteDialog} fullWidth maxWidth="xs" PaperProps={{ sx: { bgcolor: 'var(--studio-paper-muted)' } }}>
          <DialogTitle>收藏「{favoriteDialog.name}」</DialogTitle>
          <DialogContent>
            <Stack spacing={1} sx={{ pt: 0.5 }}>
              {draft.folders.length ? sortedFolders(draft.folders).map((folder) => (
                <Stack
                  key={folder.id}
                  direction="row"
                  spacing={0.5}
                  alignItems="center"
                  onClick={() => toggleFavoriteDialogFolder(folder.id)}
                  sx={{ pl: 1 + folderDepth(folder, draft.folders) * 2, pr: 1, py: 0.25, borderRadius: 2, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                >
                  <Checkbox
                    size="small"
                    checked={favoriteDialog.checked[folder.id] === true}
                    onChange={() => toggleFavoriteDialogFolder(folder.id)}
                    onClick={(event) => event.stopPropagation()}
                    inputProps={{ 'aria-label': folder.name }}
                  />
                  <Typography variant="body2">{folder.name}</Typography>
                </Stack>
              )) : <Typography variant="body2" color="text.secondary">还没有收藏夹，先在下拉栏里新建一个。</Typography>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={closeFavoriteDialog}>取消</Button>
            <Button variant="contained" onClick={() => { void saveFavoriteDialog() }} disabled={!draft.folders.length || saving}>{saving ? '保存中…' : '保存'}</Button>
          </DialogActions>
        </Dialog>

        <Dialog open={createFolderDialog.open} onClose={() => setCreateFolderDialog({ open: false, name: '' })} fullWidth maxWidth="xs" PaperProps={{ sx: { bgcolor: 'var(--studio-paper-muted)' } }}>
          <DialogTitle>新建收藏夹</DialogTitle>
          <DialogContent>
            <Stack spacing={1.25} sx={{ pt: 1.5 }}>
              <TextField
                autoFocus
                size="small"
                label="收藏夹名称"
                value={createFolderDialog.name}
                onChange={(e) => setCreateFolderDialog((current) => ({ ...current, name: e.target.value }))}
                fullWidth
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreateFolderDialog({ open: false, name: '' })}>取消</Button>
            <Button
              variant="contained"
              disabled={!text(createFolderDialog.name) || saving}
              onClick={() => {
                void createFolder(createFolderDialog.name).then((ok) => {
                  if (ok) setCreateFolderDialog({ open: false, name: '' })
                })
              }}
            >
              创建
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog open={folderDialogOpen} onClose={() => setFolderDialogOpen(false)} fullWidth maxWidth="xs" PaperProps={{ sx: { bgcolor: 'var(--studio-paper-muted)' } }}>
          <DialogTitle>收藏夹设置</DialogTitle>
          <DialogContent>
            {selectedFolder ? (
              <Stack spacing={1.25} sx={{ pt: 1.5 }}>
                <TextField size="small" label="收藏夹名称" value={folderDraft.name} onChange={(e) => setFolderDraft((current) => ({ ...current, name: e.target.value }))} disabled={busy || saving} fullWidth />
                <FormControl size="small" fullWidth>
                  <InputLabel>父级收藏夹</InputLabel>
                  <Select label="父级收藏夹" value={folderDraft.parentId} onChange={(e) => setFolderDraft((current) => ({ ...current, parentId: String(e.target.value || '') }))} disabled={busy || saving}>
                    <MenuItem value="">无</MenuItem>
                    {draft.folders.filter((folder) => folder.id !== selectedFolder.id).map((folder) => <MenuItem key={folder.id} value={folder.id}>{folder.name}</MenuItem>)}
                  </Select>
                </FormControl>
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ pt: 0.5 }}>请先在下拉栏里选择一个收藏夹。</Typography>
            )}
          </DialogContent>
          <DialogActions sx={{ justifyContent: 'space-between' }}>
            {selectedFolder ? (
              <Button
                color="error"
                size="small"
                startIcon={<DeleteOutlineIcon />}
                onClick={() => {
                  void deleteFolder(selectedFolder.id)
                  setFolderDialogOpen(false)
                }}
                disabled={busy || saving}
              >
                删除收藏夹
              </Button>
            ) : <span />}
            <Stack direction="row" spacing={1}>
              <Button onClick={() => setFolderDialogOpen(false)}>取消</Button>
              <Button
                variant="contained"
                disabled={busy || saving || !selectedFolder}
                onClick={() => {
                  if (!selectedFolder) return
                  void updateFolder(selectedFolder.id, { name: text(folderDraft.name) || selectedFolder.name, parentId: folderDraft.parentId })
                  setFolderDialogOpen(false)
                }}
              >
                保存
              </Button>
            </Stack>
          </DialogActions>
        </Dialog>

        <Dialog open={previewDialogOpen} onClose={() => setPreviewDialogOpen(false)} fullWidth maxWidth="md" PaperProps={{ sx: { bgcolor: 'var(--studio-paper-muted)' } }}>
          <DialogTitle>解析预览</DialogTitle>
          <DialogContent>
            <Stack spacing={1.25} sx={{ pt: 1.5 }}>
              <TextField size="small" multiline minRows={4} label="输入包含占位符的文本" value={previewText} onChange={(e) => setPreviewText(e.target.value)} fullWidth />
              <SettingsSection tone="muted" sx={{ p: 1, minHeight: 92, whiteSpace: 'pre-wrap' }}>{String(placeholders?.preview?.text || '')}</SettingsSection>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPreviewDialogOpen(false)}>关闭</Button>
          </DialogActions>
        </Dialog>

        <Dialog open={problemsDialogOpen} onClose={() => setProblemsDialogOpen(false)} fullWidth maxWidth="sm" PaperProps={{ sx: { bgcolor: 'var(--studio-paper-muted)' } }}>
          <DialogTitle>问题看板</DialogTitle>
          <DialogContent>
            <Stack spacing={1} sx={{ pt: 0.5 }}>
              {problems.length ? problems.map((problem: any, index: number) => (
                <Typography key={`${problem.name}:${problem.type}:${index}`} variant="body2" color="error">{String(problem.name || '')}：{placeholderProblemLabel(String(problem.type || ''))}</Typography>
              )) : <Typography variant="body2" color="text.secondary">当前未发现问题。</Typography>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setProblemsDialogOpen(false)}>关闭</Button>
          </DialogActions>
        </Dialog>

        <Dialog open={pluginDialogOpen} onClose={() => setPluginDialogOpen(false)} fullWidth maxWidth="sm" PaperProps={{ sx: { bgcolor: 'var(--studio-paper-muted)' } }}>
          <DialogTitle>从插件接口创建占位符</DialogTitle>
          <DialogContent>
            <Stack spacing={1}>
              {Array.isArray(systemPlugins?.availableInterfaces) && systemPlugins.availableInterfaces.length ? systemPlugins.availableInterfaces.map((item: any) => (
                <SettingsListItem key={`${item.pluginId}:${item.interfaceId}`} sx={{ p: 1 }}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                        <Typography variant="body2" sx={{ fontWeight: 900 }}>{String(item.placeholderName || '')}</Typography>
                        {item.disabled ? <SettingsPill tone="danger">已停用</SettingsPill> : null}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">{String(item.pluginName || item.pluginId || '')} · {String(item.interfaceDescription || item.interfaceId || '')}</Typography>
                    </Box>
                    <Button size="small" variant="contained" onClick={() => createFromPlugin(String(item.pluginId || ''), String(item.interfaceId || ''))}>创建</Button>
                  </Stack>
                </SettingsListItem>
              )) : <Typography variant="body2" color="text.secondary">当前没有可创建的插件接口。</Typography>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPluginDialogOpen(false)}>关闭</Button>
          </DialogActions>
        </Dialog>
      </Stack>
    </SettingsSurface>
  )
}

function PlaceholderEditor(props: {
  item: PlaceholderItem
  folders: PlaceholderFolder[]
  disabled: boolean
  saving: boolean
  sourcePluginDisabled: boolean
  onRename: (name: string) => void
  onUpdate: (patch: Partial<PlaceholderItem>) => void
  onSave: () => void
  onDelete: () => void
}) {
  const { item, folders, disabled, saving, sourcePluginDisabled, onRename, onUpdate, onSave, onDelete } = props
  const [menuEl, setMenuEl] = React.useState<HTMLElement | null>(null)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false)
  const label = text(item.name) || '未命名占位符'
  const memberFolders = folders.filter((folder) => !!folder.placeholderNames?.includes(item.name))
  return (
    <SettingsSection>
      <Stack spacing={1}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <TextField size="small" label="名字" value={item.name} onChange={(e) => onRename(e.target.value)} sx={{ flex: 1 }} disabled={disabled} />
          <Button startIcon={<SaveIcon />} variant="contained" size="small" onClick={onSave} disabled={disabled || !text(item.name)}>{saving ? '保存中…' : '保存'}</Button>
          <Tooltip title="更多操作">
            <span>
              <IconButton size="small" aria-label="更多操作" onClick={(event) => setMenuEl(event.currentTarget)} disabled={disabled}>
                <MoreVertIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
        <TextField size="small" label="备注" value={item.description || ''} onChange={(e) => onUpdate({ description: e.target.value })} disabled={disabled} fullWidth />
        {item.source?.kind === 'system_plugin' ? (
          <Stack spacing={0.5}>
            <Typography variant="caption" color="text.secondary">值</Typography>
            <Box
              sx={{
                borderRadius: 2,
                bgcolor: 'var(--studio-field)',
                boxShadow: 'var(--studio-shadow-soft)',
                px: 1.5,
                py: 1.25,
                minHeight: 116,
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 700, textAlign: 'center', color: sourcePluginDisabled ? 'error.main' : 'primary.main' }}>
                {sourcePluginDisabled
                  ? '所属插件已停用：解析时会跳过这个占位符并提示，启用插件后自动恢复。'
                  : '这个占位符的值由系统插件动态提供，保存的手写值不会参与解析。'}
              </Typography>
            </Box>
          </Stack>
        ) : (
          <TextField size="small" multiline minRows={5} label="值" value={item.value} onChange={(e) => onUpdate({ value: e.target.value })} disabled={disabled} fullWidth />
        )}
        <Typography variant="caption" color="text.secondary">创建时间：{formatTime(item.createdAt)}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 900 }}>所属收藏夹</Typography>
        {memberFolders.length ? (
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
            {memberFolders.map((folder) => <SettingsPill key={folder.id}>{folder.name}</SettingsPill>)}
          </Stack>
        ) : <Typography variant="caption" color="text.secondary">这个占位符还没有加入收藏夹。</Typography>}

        <Menu anchorEl={menuEl} open={!!menuEl} onClose={() => setMenuEl(null)} transitionDuration={{ enter: 0, exit: 0 }}>
          <MenuItem
            sx={{ color: 'error.main', gap: 1 }}
            onClick={() => {
              setMenuEl(null)
              setConfirmDeleteOpen(true)
            }}
          >
            <DeleteOutlineIcon fontSize="small" />
            删除占位符
          </MenuItem>
        </Menu>

        <Dialog open={confirmDeleteOpen} onClose={() => setConfirmDeleteOpen(false)} maxWidth="xs" fullWidth PaperProps={{ sx: { bgcolor: 'var(--studio-paper-muted)' } }}>
          <DialogTitle>确认删除占位符？</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary">将删除「{label}」，并从各收藏夹中移除。删除会立即生效。</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmDeleteOpen(false)}>取消</Button>
            <Button
              color="error"
              variant="contained"
              onClick={() => {
                setConfirmDeleteOpen(false)
                onDelete()
              }}
            >
              删除
            </Button>
          </DialogActions>
        </Dialog>
      </Stack>
    </SettingsSection>
  )
}


