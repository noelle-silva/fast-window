import * as React from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import BookmarkAddOutlinedIcon from '@mui/icons-material/BookmarkAddOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import SaveIcon from '@mui/icons-material/Save'
import {
  EMPTY_PROMPT_FOLDER_LIBRARY,
  EMPTY_PROMPT_LIBRARY,
  collectPromptFolderSubtreeIds,
  completeFolderEntryOrder,
  completeRootEntryOrder,
  applyPromptEntryOrder,
  createLocalId,
  parsePromptEntryKey,
  promptFolderParentId,
  promptLayerKeys,
  resolveActiveOwnerId,
  resolvePromptFolderLayer,
  type PromptEntry,
  type PromptFolder,
  type PromptFolderLibrary,
  type PromptLayerEntry,
  type PromptLibrary,
  type PromptScope,
} from '../../domain/promptLibrary'
import { canPlacePromptEntry, planPromptPlacementMove } from '../../domain/promptLibraryPlacement'
import { moveListItemById } from '../../domain/listOrdering'
import { resolveSortMovePosition, type SortableDropConfig } from '../components/SortableDnd'
import { MoreActionsMenu } from '../components/MoreActionsMenu'
import { SettingsSurface } from './SettingsSurfaces'
import { PromptLibrarySidebar } from './PromptLibrarySidebar'
import { PromptFolderPicker } from './PromptFolderPicker'

// 提示词仓库管理：三段作用域切换 + 混排侧边栏 + 右侧条目编辑器。
// 收藏走「收藏到收藏夹」模态窗；条目与收藏夹的功能入口都在右键菜单里。

const SCOPE_LABELS: Record<PromptScope, string> = {
  global: '全局提示词',
  role: '角色提示词',
  workspace: '工作区提示词',
}

const EMPTY_ENTRY: PromptEntry = { id: '', name: '', content: '', description: '', createdAt: '', updatedAt: '' }

// 次要按钮也用实心底色，不用纯边框或透明样式。
const FILLED_SECONDARY_SX = {
  bgcolor: 'var(--studio-field)',
  color: 'var(--studio-text-primary)',
  boxShadow: 'var(--studio-shadow-soft)',
  '&:hover': { bgcolor: 'var(--studio-field-hover)', boxShadow: 'var(--studio-shadow-soft)' },
}

type PendingDelete = { kind: 'prompt' | 'folder'; id: string; name: string }

type PromptLibrarySettingsPanelProps = {
  controller: any
  roles?: any[]
  workspaces?: any[]
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

export function PromptLibrarySettingsPanel(props: PromptLibrarySettingsPanelProps) {
  const { controller, roles = [], workspaces = [] } = props

  const [scope, setScope] = React.useState<PromptScope>('global')
  const [ownerId, setOwnerId] = React.useState('')
  const [ownerSearch, setOwnerSearch] = React.useState('')
  const [library, setLibrary] = React.useState<PromptLibrary>(EMPTY_PROMPT_LIBRARY)
  const [folders, setFolders] = React.useState<PromptFolderLibrary>(EMPTY_PROMPT_FOLDER_LIBRARY)
  const [currentFolderId, setCurrentFolderId] = React.useState('')
  const [selectedPromptId, setSelectedPromptId] = React.useState('')
  const [draft, setDraft] = React.useState<PromptEntry | null>(null)
  const [search, setSearch] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [folderDialog, setFolderDialog] = React.useState<{ mode: 'create' | 'rename'; folderId: string; name: string } | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState<PendingDelete | null>(null)
  const [pickerTarget, setPickerTarget] = React.useState<{ mode: 'collect' | 'collect-folder' | 'move-prompt' | 'move-folder'; id: string } | null>(null)
  const [pickerInitialIds, setPickerInitialIds] = React.useState<string[]>([])

  const ownerOptions = scope === 'role' ? roles : scope === 'workspace' ? workspaces : []
  const ownerIds = React.useMemo(() => ownerOptions.map((item: any) => text(item?.id)).filter(Boolean), [ownerOptions])
  const activeOwnerId = resolveActiveOwnerId(scope, ownerId, ownerIds)

  const callAction = React.useCallback(
    async <T,>(name: string, ...args: any[]): Promise<T> => {
      const fn = controller?.actions?.[name]
      if (typeof fn !== 'function') throw new Error(`当前客户端缺少动作：${name}`)
      return (await fn(...args)) as T
    },
    [controller],
  )

  const notify = React.useCallback(
    (message: string, kind: 'error' | 'success' = 'error') => {
      const fn = controller?.actions?.notifyPromptLibrary
      if (typeof fn === 'function') fn(message, kind)
    },
    [controller],
  )

  const reload = React.useCallback(
    async (options?: { keepSelection?: boolean }) => {
      if (scope !== 'global' && !activeOwnerId) {
        setLibrary(EMPTY_PROMPT_LIBRARY)
        setFolders(EMPTY_PROMPT_FOLDER_LIBRARY)
        return
      }
      setLoading(true)
      try {
        const [nextLibrary, nextFolders] = await Promise.all([
          callAction<PromptLibrary>('loadPromptLibrary', scope, activeOwnerId),
          callAction<PromptFolderLibrary>('loadPromptFolders', scope, activeOwnerId),
        ])
        setLibrary(nextLibrary)
        setFolders(nextFolders)
        if (!options?.keepSelection) {
          setCurrentFolderId('')
          setSelectedPromptId('')
          setDraft(null)
          setPickerTarget(null)
        }
      } catch (e: any) {
        notify(text(e?.message) || '加载提示词仓库失败')
      } finally {
        setLoading(false)
      }
    },
    [activeOwnerId, callAction, scope],
  )

  React.useEffect(() => {
    void reload()
  }, [reload])

  const layer = React.useMemo(
    () => resolvePromptFolderLayer(folders, library, currentFolderId),
    [folders, library, currentFolderId],
  )

  const keyword = text(search)
  const visibleLayer = React.useMemo(() => {
    if (!keyword) return layer
    return {
      ...layer,
      entries: layer.entries.filter((entry) =>
        entry.kind === 'folder'
          ? entry.folder.name.includes(keyword)
          : entry.prompt.name.includes(keyword) || entry.prompt.content.includes(keyword),
      ),
    }
  }, [keyword, layer])

  const allFolders = folders.folders
  const isSaved = Boolean(draft && library.prompts.some((prompt) => prompt.id === draft.id))
  // 已保存的条目被改动也算脏：黄点表示「有还没落库的修改」。
  const savedEntry = draft ? library.prompts.find((prompt) => prompt.id === draft.id) ?? null : null
  const isDirty = Boolean(
    draft &&
      (!savedEntry ||
        savedEntry.name !== draft.name ||
        savedEntry.content !== draft.content ||
        savedEntry.description !== draft.description),
  )

  const selectPrompt = (promptId: string) => {
    setSelectedPromptId(promptId)
    const found = library.prompts.find((prompt) => prompt.id === promptId)
    setDraft(found ? { ...found } : null)
  }

  const createPrompt = () => {
    const entry: PromptEntry = { ...EMPTY_ENTRY, id: createLocalId('prompt'), name: '新提示词' }
    setSelectedPromptId(entry.id)
    setDraft(entry)
  }

  const savePrompt = async () => {
    if (!draft) return
    if (!text(draft.name)) {
      notify('提示词名称必填')
      return
    }
    setLoading(true)
    try {
      const exists = library.prompts.some((prompt) => prompt.id === draft.id)
      const prompts = exists
        ? library.prompts.map((prompt) => (prompt.id === draft.id ? draft : prompt))
        : [...library.prompts, draft]
      await callAction<PromptLibrary>('savePromptLibrary', scope, activeOwnerId, { prompts })
      await reload({ keepSelection: true })
      setSelectedPromptId(draft.id)
      // 在当前层级新建的条目直接归入当前收藏夹，不落在根级。
      if (!exists && currentFolderId) {
        const savedFolders = await callAction<PromptFolderLibrary>('addPromptToFolder', scope, activeOwnerId, currentFolderId, draft.id)
        setFolders(savedFolders)
      }
    } catch (e: any) {
      notify(text(e?.message) || '保存提示词失败')
    } finally {
      setLoading(false)
    }
  }

  const confirmDeletePrompt = async () => {
    if (!pendingDelete || pendingDelete.kind !== 'prompt') return
    setLoading(true)
    try {
      await callAction<PromptLibrary>('deletePromptEntry', scope, activeOwnerId, pendingDelete.id)
      setPendingDelete(null)
      await reload()
    } catch (e: any) {
      notify(text(e?.message) || '删除提示词失败')
    } finally {
      setLoading(false)
    }
  }

  const openCreateFolder = () => setFolderDialog({ mode: 'create', folderId: '', name: '' })

  // 名字由对话框给出；确认前不写盘，取消就什么都不发生。
  const createFolderNamed = async (name: string) => {
    const folder: PromptFolder = {
      id: createLocalId('folder'),
      name,
      folderIds: [],
      promptIds: [],
      entryOrder: [],
      createdAt: '',
      updatedAt: '',
    }
    const parentId = currentFolderId
    const parentKey = `folder:${folder.id}`
    // 提交整库前先把每层顺序补齐：服务端只接受「本层全部条目」的完整排列。
    const base: PromptFolderLibrary = {
      rootFolderIds: folders.rootFolderIds,
      rootEntryOrder: completeRootEntryOrder(folders, library),
      folders: folders.folders.map((item) => ({ ...item, entryOrder: completeFolderEntryOrder(item) })),
    }
    const next: PromptFolderLibrary = parentId
      ? {
          rootFolderIds: base.rootFolderIds,
          rootEntryOrder: base.rootEntryOrder,
          folders: [
            ...base.folders.map((item) =>
              item.id === parentId
                ? { ...item, folderIds: [...item.folderIds, folder.id], entryOrder: [...item.entryOrder, parentKey] }
                : item,
            ),
            folder,
          ],
        }
      : {
          rootFolderIds: [...base.rootFolderIds, folder.id],
          rootEntryOrder: [...base.rootEntryOrder, parentKey],
          folders: [...base.folders, folder],
        }
    setLoading(true)
    try {
      const saved = await callAction<PromptFolderLibrary>('savePromptFolders', scope, activeOwnerId, next)
      setFolders(saved)
    } catch (e: any) {
      notify(text(e?.message) || '新建收藏夹失败')
    } finally {
      setLoading(false)
    }
  }

  const openRename = (folder: PromptFolder) => {
    setFolderDialog({ mode: 'rename', folderId: folder.id, name: folder.name })
  }

  const submitFolderDialog = async () => {
    if (!folderDialog) return
    const name = text(folderDialog.name)
    if (!name) {
      notify('收藏夹名称必填')
      return
    }
    if (folderDialog.mode === 'create') {
      setFolderDialog(null)
      await createFolderNamed(name)
      return
    }
    setLoading(true)
    try {
      const saved = await callAction<PromptFolderLibrary>('renamePromptFolder', scope, activeOwnerId, folderDialog.folderId, name)
      setFolders(saved)
      setFolderDialog(null)
    } catch (e: any) {
      notify(text(e?.message) || '重命名收藏夹失败')
    } finally {
      setLoading(false)
    }
  }

  const confirmDeleteFolder = async () => {
    if (!pendingDelete || pendingDelete.kind !== 'folder') return
    setLoading(true)
    try {
      const saved = await callAction<PromptFolderLibrary>('deletePromptFolder', scope, activeOwnerId, pendingDelete.id)
      setFolders(saved)
      if (currentFolderId === pendingDelete.id) setCurrentFolderId(promptFolderParentId(layer))
      setPendingDelete(null)
    } catch (e: any) {
      notify(text(e?.message) || '删除收藏夹失败')
    } finally {
      setLoading(false)
    }
  }

  // 混排拖拽：同一列表内的收藏夹与条目一起挪位置，提交完整层顺序。
  const moveEntry = async (activeKey: string, overKey: string) => {
    const keys = promptLayerKeys(layer)
    const position = resolveSortMovePosition(keys, activeKey, overKey)
    if (!position) return
    const next = moveListItemById(keys, (key) => key, activeKey, overKey, position)
    // 松手瞬间先按新顺序重排本地数据：弹回原位的动画与新顺序在同一帧生效，不会回跳。
    const previous = folders
    setFolders(applyPromptEntryOrder(folders, currentFolderId, next))
    try {
      const saved = await callAction<PromptFolderLibrary>('reorderPromptFolderEntries', scope, activeOwnerId, currentFolderId, next)
      setFolders(saved)
    } catch (e: any) {
      setFolders(previous)
      notify(text(e?.message) || '排序失败')
    }
  }

  // Ctrl 拖拽的落点：规则由 domain 判定，这里只执行它给出的原子动作。
  const moveEntryToLayer = React.useCallback(
    async (activeKey: string, targetFolderId: string) => {
      const payload = parsePromptEntryKey(activeKey)
      if (!payload) return
      const move = planPromptPlacementMove({
        library: folders,
        payload,
        fromFolderId: currentFolderId,
        toFolderId: targetFolderId,
      })
      if (!move) return
      setLoading(true)
      try {
        const saved = await callAction<PromptFolderLibrary>(
          move.actionName,
          scope,
          activeOwnerId,
          move.id,
          move.fromFolderId,
          move.toFolderId,
        )
        setFolders(saved)
      } catch (e: any) {
        notify(text(e?.message) || '移动失败')
      } finally {
        setLoading(false)
      }
    },
    [activeOwnerId, callAction, currentFolderId, folders, notify, scope],
  )

  const entryDrop = React.useMemo<SortableDropConfig>(
    () => ({
      canDrop: (activeKey, targetFolderId) => {
        const payload = parsePromptEntryKey(activeKey)
        return (
          !!payload &&
          canPlacePromptEntry({
            library: folders,
            payload,
            fromFolderId: currentFolderId,
            toFolderId: targetFolderId,
          })
        )
      },
      onDrop: (activeKey, targetFolderId) => void moveEntryToLayer(activeKey, targetFolderId),
    }),
    [currentFolderId, folders, moveEntryToLayer],
  )

  // 条目最右侧的复制按钮：只复制正文，不改动仓库里的任何事实。
  const copyPromptContent = React.useCallback(
    async (promptId: string) => {
      const prompt = library.prompts.find((item) => item.id === promptId)
      if (!prompt) return
      const writeText = controller?.capabilities?.clipboard?.writeText
      if (typeof writeText !== 'function') {
        notify('未授权：剪贴板写入')
        return
      }
      try {
        await writeText(prompt.content)
        notify('已复制提示词内容', 'success')
      } catch (e: any) {
        notify(text(e?.message) || '复制失败')
      }
    },
    [controller, library.prompts, notify],
  )

  // 打开选择窗时先算出「当前已经收藏在哪些位置」，作为预勾选。
  const initialSelectionFor = (target: { mode: string; id: string }): string[] => {
    if (target.mode === 'collect') return folders.folders.filter((folder) => folder.promptIds.includes(target.id)).map((folder) => folder.id)
    if (target.mode === 'collect-folder') return folders.folders.filter((folder) => folder.folderIds.includes(target.id)).map((folder) => folder.id)
    // 移动模式只勾住当前所在这一处。
    return currentFolderId ? [currentFolderId] : []
  }

  const openPicker = (target: { mode: 'collect' | 'collect-folder' | 'move-prompt' | 'move-folder'; id: string }) => {
    setPickerInitialIds(initialSelectionFor(target))
    setPickerTarget(target)
  }

  // 收藏模式按差集落地：多选勾选，新勾选的加索引，取消勾选的摘索引。
  // 移动模式是单选目标，直接走原子动作（一次请求完成「摘原位置 + 加目标」）。
  const applyPicker = async (selectedIds: string[]) => {
    const target = pickerTarget
    const initial = pickerInitialIds
    setPickerTarget(null)
    if (!target) return

    const isMove = target.mode === 'move-prompt' || target.mode === 'move-folder'
    if (isMove) {
      const toFolderId = selectedIds[0] ?? ''
      const fromFolderId = initial[0] ?? ''
      if (toFolderId === fromFolderId) return
      const actionName = target.mode === 'move-folder' ? 'movePromptFolder' : 'movePromptToFolder'
      setLoading(true)
      try {
        const saved = await callAction<PromptFolderLibrary>(
          actionName,
          scope,
          activeOwnerId,
          target.id,
          fromFolderId,
          toFolderId,
        )
        setFolders(saved)
      } catch (e: any) {
        notify(text(e?.message) || '移动失败')
      } finally {
        setLoading(false)
      }
      return
    }

    const next = new Set(selectedIds)
    const toAdd = selectedIds.filter((id) => !initial.includes(id))
    const toRemove = initial.filter((id) => !next.has(id))
    if (!toAdd.length && !toRemove.length) return
    const folderMode = target.mode === 'collect-folder'
    setLoading(true)
    try {
      for (const id of toAdd) {
        const saved = folderMode
          ? await callAction<PromptFolderLibrary>('addFolderToFolder', scope, activeOwnerId, target.id, id)
          : await callAction<PromptFolderLibrary>('addPromptToFolder', scope, activeOwnerId, id, target.id)
        setFolders(saved)
      }
      for (const id of toRemove) {
        const saved = folderMode
          ? await callAction<PromptFolderLibrary>('removeFolderFromParent', scope, activeOwnerId, target.id, id)
          : await callAction<PromptFolderLibrary>('removePromptFromFolder', scope, activeOwnerId, id, target.id)
        setFolders(saved)
      }
    } catch (e: any) {
      notify(text(e?.message) || '保存收藏位置失败')
    } finally {
      setLoading(false)
    }
  }

  const collectEntry = (entry: PromptLayerEntry) => {
    openPicker(
      entry.kind === 'folder' ? { mode: 'collect-folder', id: entry.folder.id } : { mode: 'collect', id: entry.prompt.id },
    )
  }

  const moveEntryToFolder = (entry: PromptLayerEntry) => {
    openPicker(
      entry.kind === 'folder' ? { mode: 'move-folder', id: entry.folder.id } : { mode: 'move-prompt', id: entry.prompt.id },
    )
  }

  // 移动收藏夹时它自己和后代都不能当目标；移动条目时当前所在夹也不能选。
  const excludedFolderIds = React.useMemo(() => {
    if (!pickerTarget) return []
    if (pickerTarget.mode === 'move-folder' || pickerTarget.mode === 'collect-folder') {
      return collectPromptFolderSubtreeIds(folders, pickerTarget.id)
    }
    if (pickerTarget.mode === 'move-prompt' && currentFolderId) return [currentFolderId]
    return []
  }, [pickerTarget, folders, currentFolderId])


  return (
    <SettingsSurface sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {/* 分段切换：实心底座 + 选中块，不用轮廓线描边。 */}
      <Box sx={{ display: 'flex', gap: 0.5, p: 0.5, borderRadius: 2, bgcolor: 'var(--studio-field)' }}>
        {(Object.keys(SCOPE_LABELS) as PromptScope[]).map((value) => {
          const active = scope === value
          return (
            <Button
              key={value}
              fullWidth
              size="small"
              disableElevation
              variant="contained"
              onClick={() => setScope(value)}
              sx={active ? { borderRadius: 1.5, fontWeight: 700, py: 0.5 } : [{ borderRadius: 1.5, fontWeight: 700, py: 0.5 }, FILLED_SECONDARY_SX]}
            >
              {SCOPE_LABELS[value]}
            </Button>
          )
        })}
      </Box>

      {/* 归属选择、两个新建动作与当前层搜索共用一行。 */}
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        {scope !== 'global' ? (
          <>
            <TextField
              size="small"
              placeholder={scope === 'role' ? '搜索角色' : '搜索工作区'}
              value={ownerSearch}
              onChange={(event) => setOwnerSearch(event.target.value)}
              sx={{ width: 150 }}
            />
            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel id="prompt-library-owner-label">{scope === 'role' ? '选择角色' : '选择工作区'}</InputLabel>
              <Select
                labelId="prompt-library-owner-label"
                label={scope === 'role' ? '选择角色' : '选择工作区'}
                value={activeOwnerId}
                onChange={(event) => setOwnerId(String(event.target.value))}
              >
                {ownerOptions
                  .filter((item: any) => !text(ownerSearch) || text(item?.name).includes(text(ownerSearch)))
                  .map((item: any) => (
                    <MenuItem key={text(item?.id)} value={text(item?.id)}>
                      {text(item?.name) || text(item?.id)}
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>
          </>
        ) : null}
        <Button
          size="small"
          variant="contained"
          disableElevation
          startIcon={<FolderOutlinedIcon />}
          onClick={openCreateFolder}
          disabled={loading}
          sx={FILLED_SECONDARY_SX}
        >
          新建收藏夹
        </Button>
        <Button
          size="small"
          variant="contained"
          disableElevation
          startIcon={<AddIcon />}
          onClick={createPrompt}
          disabled={loading}
          sx={FILLED_SECONDARY_SX}
        >
          新建提示词
        </Button>
        <Box sx={{ flex: 1 }} />
        <TextField
          size="small"
          placeholder="搜索当前层"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          sx={{ width: 180 }}
        />
      </Stack>

      {scope !== 'global' && !ownerIds.length ? (
        <Typography variant="body2" color="text.secondary">
          {scope === 'role' ? '还没有角色，先去「角色管理」新建一个。' : '还没有工作区，先去「工作区管理」新建一个。'}
        </Typography>
      ) : null}

      <Stack direction="row" spacing={1.25} sx={{ flex: 1, minHeight: 0 }}>
        <PromptLibrarySidebar
          layer={visibleLayer}
          selectedPromptId={selectedPromptId}
          loading={loading}
          dragDisabled={Boolean(keyword)}
          drop={entryDrop}
          onBack={() => setCurrentFolderId(promptFolderParentId(layer))}
          onNavigate={(folderId) => {
            setCurrentFolderId(folderId)
            setSelectedPromptId('')
            setDraft(null)
          }}
          onSelectPrompt={selectPrompt}
          onCopyPrompt={(promptId) => void copyPromptContent(promptId)}
          onReorderEntries={(activeKey, overKey) => void moveEntry(activeKey, overKey)}
          onCollectEntry={collectEntry}
          onMoveEntryToFolder={moveEntryToFolder}
          onRenameFolder={openRename}
          onDeleteFolder={(folder) => setPendingDelete({ kind: 'folder', id: folder.id, name: folder.name })}
        />

        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {draft ? (
            <Stack spacing={1} sx={{ height: '100%', minHeight: 0 }}>
              {/* 名称、保存、收藏、更多操作同一行，右侧对齐。 */}
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  size="small"
                  label="名称"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  sx={{ flex: 1 }}
                />
                <Button
                  variant="contained"
                  size="small"
                  disableElevation
                  startIcon={<SaveIcon />}
                  onClick={() => void savePrompt()}
                  disabled={loading}
                >
                  保存
                  {isDirty ? (
                    <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'warning.main', ml: 0.75 }} />
                  ) : null}
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  disableElevation
                  startIcon={<BookmarkAddOutlinedIcon />}
                  onClick={() => openPicker({ mode: 'collect', id: draft.id })}
                  disabled={loading || !isSaved}
                  sx={FILLED_SECONDARY_SX}
                >
                  收藏到收藏夹
                </Button>
                <MoreActionsMenu
                  ariaLabel="提示词操作"
                  items={[
                    {
                      key: 'delete',
                      label: '删除提示词',
                      icon: <DeleteOutlineIcon fontSize="small" />,
                      danger: true,
                      disabled: !isSaved,
                      onSelect: () => draft && setPendingDelete({ kind: 'prompt', id: draft.id, name: draft.name }),
                    },
                  ]}
                />
              </Stack>
              <TextField
                size="small"
                label="备注"
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
              <TextField
                label="内容"
                multiline
                minRows={8}
                value={draft.content}
                onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                sx={{ flex: 1, minHeight: 0, '& .MuiInputBase-root': { alignItems: 'flex-start', height: '100%' } }}
              />

            </Stack>
          ) : (
            <Box sx={{ m: 'auto', textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                选择左侧的提示词查看与编辑，或点「新建提示词」
              </Typography>
            </Box>
          )}
        </Box>
      </Stack>

      <PromptFolderPicker
        open={Boolean(pickerTarget)}
        folders={allFolders}
        rootFolderIds={folders.rootFolderIds}
        initialSelectedIds={pickerInitialIds}
        excludedIds={excludedFolderIds}
        single={pickerTarget?.mode === 'move-prompt' || pickerTarget?.mode === 'move-folder'}
        onClose={() => setPickerTarget(null)}
        onSave={(selectedIds) => void applyPicker(selectedIds)}
      />

      <Dialog open={Boolean(folderDialog)} onClose={() => setFolderDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{folderDialog?.mode === 'create' ? '新建收藏夹' : '重命名收藏夹'}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="收藏夹名称"
            value={folderDialog?.name ?? ''}
            onChange={(event) => setFolderDialog((current) => (current ? { ...current, name: event.target.value } : current))}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button variant="contained" disableElevation onClick={() => setFolderDialog(null)} sx={FILLED_SECONDARY_SX}>
            取消
          </Button>
          <Button variant="contained" disableElevation onClick={() => void submitFolderDialog()}>
            确认
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(pendingDelete)} onClose={() => setPendingDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{pendingDelete?.kind === 'folder' ? '删除收藏夹' : '删除提示词'}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            确定删除「{pendingDelete?.name}」吗？
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {pendingDelete?.kind === 'folder'
              ? '删除后这个收藏夹就不在了，里面的子收藏夹会回到上一级；夹子里的提示词不会被删除。'
              : '删除后这条提示词会被永久删除，也会从所有收藏夹里一起移除，无法恢复。'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" disableElevation onClick={() => setPendingDelete(null)} sx={FILLED_SECONDARY_SX}>
            取消
          </Button>
          <Button
            color="error"
            variant="contained"
            disableElevation
            onClick={() => void (pendingDelete?.kind === 'folder' ? confirmDeleteFolder() : confirmDeletePrompt())}
          >
            删除
          </Button>
        </DialogActions>
      </Dialog>
    </SettingsSurface>
  )
}
