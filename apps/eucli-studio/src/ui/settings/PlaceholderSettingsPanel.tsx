import * as React from 'react'
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, InputLabel, Menu, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import RefreshIcon from '@mui/icons-material/Refresh'
import SaveIcon from '@mui/icons-material/Save'
import {
  createPlaceholderFolder,
  createPlaceholderItem,
  normalizePlaceholderLibrary,
  placeholderProblemLabel,
  type PlaceholderDependencyNode,
  type PlaceholderFolder,
  type PlaceholderItem,
  type PlaceholderLibrary,
} from '../../domain/placeholder'
import { systemPluginLocatorId } from '../../domain/systemPlugin'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { customScrollbarHiddenSx } from '../scroll/customScrollbars'
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
  const sourceLibrary = placeholders?.library || { placeholders: [], folders: [] }
  const busy = loading || !!placeholders?.loading
  const [draft, setDraft] = React.useState<PlaceholderLibrary>(() => cloneLibrary(sourceLibrary))
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const [selectedFolderId, setSelectedFolderId] = React.useState('')
  const [previewText, setPreviewText] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState('')
  const [pluginDialogOpen, setPluginDialogOpen] = React.useState(false)
  const [previewDialogOpen, setPreviewDialogOpen] = React.useState(false)
  const [problemsDialogOpen, setProblemsDialogOpen] = React.useState(false)
  const [folderMenuEl, setFolderMenuEl] = React.useState<HTMLElement | null>(null)
  const [folderDialogOpen, setFolderDialogOpen] = React.useState(false)

  React.useEffect(() => {
    const next = cloneLibrary(sourceLibrary)
    setDraft(next)
    setSelectedIndex((current) => Math.min(Math.max(0, current), Math.max(0, next.placeholders.length - 1)))
  }, [sourceLibrary])

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

  React.useEffect(() => {
    const selectedName = text(draft.placeholders[selectedIndex]?.name)
    if (!selectedName) return
    controller.actions.loadPlaceholderDependencies?.(selectedName)?.catch?.(() => null)
  }, [controller, draft.placeholders, selectedIndex])

  const selectedPlaceholder = draft.placeholders[selectedIndex] || null
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
  const canSave = !busy && !saving && !hasEmptyName && !hasDuplicateName
  const problems = Array.isArray(placeholders?.problems) ? placeholders.problems : []

  const replacePlaceholder = (index: number, updater: (item: PlaceholderItem) => PlaceholderItem) => {
    setDraft((current) => ({ ...current, placeholders: current.placeholders.map((item, itemIndex) => (itemIndex === index ? updater(item) : item)) }))
  }

  const createItem = () => {
    const item = createPlaceholderItem()
    const names = new Set(draft.placeholders.map((existing) => text(existing.name)).filter(Boolean))
    let nextName = '新占位符'
    let suffix = 2
    while (names.has(nextName)) {
      nextName = `新占位符 ${suffix}`
      suffix += 1
    }
    setDraft((current) => ({
      ...current,
      placeholders: current.placeholders.concat({ ...item, name: nextName }),
      folders: selectedFolderId
        ? current.folders.map((folder) => folder.id === selectedFolderId
          ? { ...folder, placeholderNames: Array.from(new Set([...(folder.placeholderNames || []), nextName])).sort((a, b) => a.localeCompare(b)), updatedAt: new Date().toISOString() }
          : folder)
        : current.folders,
    }))
    setSelectedIndex(draft.placeholders.length)
  }

  const deleteItem = (index: number, name: string) => {
    setDraft((current) => ({
      placeholders: current.placeholders.filter((_item, itemIndex) => itemIndex !== index),
      folders: current.folders.map((folder) => ({ ...folder, placeholderNames: (folder.placeholderNames || []).filter((itemName) => itemName !== name) })),
    }))
    setSelectedIndex((current) => Math.max(0, Math.min(current, draft.placeholders.length - 2)))
  }

  const renameItem = (index: number, oldName: string, nextNameRaw: string) => {
    const nextName = nextNameRaw
    replacePlaceholder(index, (item) => ({ ...item, name: nextName }))
    setDraft((current) => ({
      ...current,
      folders: current.folders.map((folder) => ({ ...folder, placeholderNames: (folder.placeholderNames || []).map((itemName) => itemName === oldName ? nextName : itemName) })),
    }))
  }

  const createFolder = () => {
    const folder = createPlaceholderFolder()
    setDraft((current) => ({ ...current, folders: current.folders.concat(folder) }))
    setSelectedFolderId(folder.id)
  }

  const updateFolder = (folderId: string, patch: Partial<PlaceholderFolder>) => {
    setDraft((current) => ({ ...current, folders: current.folders.map((folder) => folder.id === folderId ? { ...folder, ...patch, updatedAt: new Date().toISOString() } : folder) }))
  }

  const deleteFolder = (folderId: string) => {
    setDraft((current) => ({
      ...current,
      folders: current.folders.filter((folder) => folder.id !== folderId).map((folder) => folder.parentId === folderId ? { ...folder, parentId: '', updatedAt: new Date().toISOString() } : folder),
    }))
    if (selectedFolderId === folderId) setSelectedFolderId('')
  }

  const toggleFolderMembership = (folderId: string, itemName: string, checked: boolean) => {
    setDraft((current) => ({
      ...current,
      folders: current.folders.map((folder) => {
        if (folder.id !== folderId) return folder
        const names = new Set(folder.placeholderNames || [])
        if (checked) names.add(itemName)
        else names.delete(itemName)
        return { ...folder, placeholderNames: Array.from(names).sort((a, b) => a.localeCompare(b)), updatedAt: new Date().toISOString() }
      }),
    }))
  }

  const saveDraft = async () => {
    if (!canSave) {
      setSaveError(hasEmptyName ? '占位符名字不能为空' : '占位符名字不能重复')
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      const saved = await controller.actions.savePlaceholderLibrary?.(draft)
      setDraft(cloneLibrary(saved || draft))
    } catch (e) {
      setSaveError(String((e as any)?.message || e || '保存失败'))
    } finally {
      setSaving(false)
    }
  }

  const openPluginDialog = async () => {
    setPluginDialogOpen(true)
    await controller.actions.refreshAvailableSystemPluginPlaceholderInterfaces?.().catch?.(() => null)
  }

  const createFromPlugin = async (pluginId: string, interfaceId: string) => {
    const saved = await controller.actions.createPlaceholderFromSystemPlugin?.(pluginId, interfaceId)
    if (saved) setDraft(cloneLibrary(saved))
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
          <Button startIcon={<AddIcon />} variant="text" onClick={createItem} disabled={busy || saving}>新建占位符</Button>
          <Button startIcon={<SaveIcon />} variant="contained" onClick={saveDraft} disabled={!canSave}>{saving ? '保存中…' : '保存'}</Button>
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
                onClick={(event) => setFolderMenuEl(event.currentTarget)}
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
                    return <Button key={`${item.name}:${index}`} variant={selected ? 'contained' : 'text'} color={selected ? 'primary' : disabledByPlugin ? 'error' : 'inherit'} onClick={() => setSelectedIndex(index)} sx={{ justifyContent: 'flex-start', minWidth: 0, width: '100%', textTransform: 'none' }}><Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{disabledByPlugin ? `${label}（插件已停用）` : label}</Box></Button>
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
                    sourcePluginDisabled={sourcePluginDisabled(selectedPlaceholder)}
                    onRename={(nextName) => renameItem(selectedIndex, selectedPlaceholder.name, nextName)}
                    onUpdate={(patch) => replacePlaceholder(selectedIndex, (item) => ({ ...item, ...patch }))}
                    onDelete={() => deleteItem(selectedIndex, selectedPlaceholder.name)}
                    onToggleFolder={(folderId, checked) => toggleFolderMembership(folderId, selectedPlaceholder.name, checked)}
                  />
                  <PlaceholderDependencyTreePanel tree={placeholders?.dependencyTree} />
                </Stack>
              ) : (
                <SettingsSection sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">选择一个占位符，或新建后开始编辑。</Typography></SettingsSection>
              )}
            </CustomScrollArea>
          </Box>
        </Stack>

        <Menu anchorEl={folderMenuEl} open={!!folderMenuEl} onClose={() => setFolderMenuEl(null)}>
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
              createFolder()
              setFolderMenuEl(null)
            }}
          >
            <AddIcon fontSize="small" sx={{ mr: 1 }} />
            新建收藏夹
          </MenuItem>
          <MenuItem
            disabled={!selectedFolder}
            onClick={() => {
              setFolderDialogOpen(true)
              setFolderMenuEl(null)
            }}
          >
            收藏夹设置…
          </MenuItem>
        </Menu>

        <Dialog open={folderDialogOpen} onClose={() => setFolderDialogOpen(false)} fullWidth maxWidth="xs">
          <DialogTitle>收藏夹设置</DialogTitle>
          <DialogContent sx={{ bgcolor: 'grey.50' }}>
            {selectedFolder ? (
              <Stack spacing={1.25} sx={{ pt: 0.5 }}>
                <TextField size="small" label="收藏夹名称" value={selectedFolder.name} onChange={(e) => updateFolder(selectedFolder.id, { name: e.target.value })} disabled={busy || saving} fullWidth />
                <FormControl size="small" fullWidth>
                  <InputLabel>父级收藏夹</InputLabel>
                  <Select label="父级收藏夹" value={selectedFolder.parentId || ''} onChange={(e) => updateFolder(selectedFolder.id, { parentId: String(e.target.value || '') })} disabled={busy || saving}>
                    <MenuItem value="">无</MenuItem>
                    {draft.folders.filter((folder) => folder.id !== selectedFolder.id).map((folder) => <MenuItem key={folder.id} value={folder.id}>{folder.name}</MenuItem>)}
                  </Select>
                </FormControl>
                <Button
                  color="error"
                  size="small"
                  startIcon={<DeleteOutlineIcon />}
                  onClick={() => {
                    deleteFolder(selectedFolder.id)
                    setFolderDialogOpen(false)
                  }}
                  disabled={busy || saving}
                >
                  删除收藏夹
                </Button>
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ pt: 0.5 }}>请先在下拉栏里选择一个收藏夹。</Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setFolderDialogOpen(false)}>关闭</Button>
          </DialogActions>
        </Dialog>

        <Dialog open={previewDialogOpen} onClose={() => setPreviewDialogOpen(false)} fullWidth maxWidth="md">
          <DialogTitle>解析预览</DialogTitle>
          <DialogContent sx={{ bgcolor: 'grey.50' }}>
            <Stack spacing={1.25} sx={{ pt: 0.5 }}>
              <TextField size="small" multiline minRows={4} label="输入包含占位符的文本" value={previewText} onChange={(e) => setPreviewText(e.target.value)} fullWidth />
              <SettingsSection tone="muted" sx={{ p: 1, minHeight: 92, whiteSpace: 'pre-wrap' }}>{String(placeholders?.preview?.text || '')}</SettingsSection>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPreviewDialogOpen(false)}>关闭</Button>
          </DialogActions>
        </Dialog>

        <Dialog open={problemsDialogOpen} onClose={() => setProblemsDialogOpen(false)} fullWidth maxWidth="sm">
          <DialogTitle>问题看板</DialogTitle>
          <DialogContent sx={{ bgcolor: 'grey.50' }}>
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

        <Dialog open={pluginDialogOpen} onClose={() => setPluginDialogOpen(false)} fullWidth maxWidth="sm">
          <DialogTitle>从插件接口创建占位符</DialogTitle>
          <DialogContent sx={{ bgcolor: 'grey.50' }}>
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
  sourcePluginDisabled: boolean
  onRename: (name: string) => void
  onUpdate: (patch: Partial<PlaceholderItem>) => void
  onDelete: () => void
  onToggleFolder: (folderId: string, checked: boolean) => void
}) {
  const { item, folders, disabled, sourcePluginDisabled, onRename, onUpdate, onDelete, onToggleFolder } = props
  return (
    <SettingsSection>
      <Stack spacing={1}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <TextField size="small" label="名字" value={item.name} onChange={(e) => onRename(e.target.value)} sx={{ flex: 1 }} disabled={disabled} />
          <Button color="error" startIcon={<DeleteOutlineIcon />} onClick={onDelete} disabled={disabled}>删除</Button>
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
        {folders.length ? folders.map((folder) => {
          const checked = !!folder.placeholderNames?.includes(item.name)
          return (
            <Stack key={folder.id} direction="row" spacing={1} alignItems="center" sx={{ pl: folderDepth(folder, folders) * 2 }}>
              <Checkbox size="small" checked={checked} onChange={(e) => onToggleFolder(folder.id, e.target.checked)} disabled={disabled || !text(item.name)} />
              <Typography variant="body2">{folder.name}</Typography>
            </Stack>
          )
        }) : <Typography variant="caption" color="text.secondary">暂无收藏夹。</Typography>}
      </Stack>
    </SettingsSection>
  )
}

function PlaceholderDependencyTreePanel(props: { tree: PlaceholderDependencyNode }) {
  return (
    <SettingsSection tone="muted">
      <Stack spacing={1}>
        <Typography variant="body2" sx={{ fontWeight: 900 }}>依赖树</Typography>
        {props.tree?.name ? <DependencyNode node={props.tree} depth={0} /> : <Typography variant="body2" color="text.secondary">选择占位符后查看依赖。</Typography>}
      </Stack>
    </SettingsSection>
  )
}

function DependencyNode(props: { node: PlaceholderDependencyNode; depth: number }) {
  const { node, depth } = props
  const suffix = node.cycle ? '（循环）' : node.missing ? '（未注册）' : ''
  return (
    <Box sx={{ pl: depth * 2 }}>
      <Typography variant="body2" color={node.cycle || node.missing ? 'error' : 'text.primary'}>{node.name}{suffix}</Typography>
      {Array.isArray(node.children) ? node.children.map((child, index) => <DependencyNode key={`${child.name}:${index}`} node={child} depth={depth + 1} />) : null}
    </Box>
  )
}
