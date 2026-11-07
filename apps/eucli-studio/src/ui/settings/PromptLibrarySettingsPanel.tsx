import * as React from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import SaveIcon from '@mui/icons-material/Save'
import {
  EMPTY_PROMPT_FOLDER_LIBRARY,
  EMPTY_PROMPT_LIBRARY,
  createLocalId,
  mergePromptOrder,
  promptFolderParentId,
  resolveActiveOwnerId,
  resolvePromptFolderLayer,
  type PromptEntry,
  type PromptFolder,
  type PromptFolderLibrary,
  type PromptLibrary,
  type PromptScope,
} from '../../domain/promptLibrary'
import { moveListItemById } from '../../domain/listOrdering'
import { resolveSortMovePosition } from '../components/SortableDnd'
import { SortableList } from '../components/SortableList'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { SettingsSurface } from './SettingsSurfaces'

// 提示词仓库管理：三段作用域切换 + 收藏夹树侧边栏 + 右侧条目编辑器。
// 收藏夹与条目分两段各自拖拽：Agent 端的顺序事实本来就是两组数组。

const SCOPE_LABELS: Record<PromptScope, string> = {
  global: '全局提示词',
  role: '角色提示词',
  workspace: '工作区提示词',
}

const EMPTY_ENTRY: PromptEntry = { id: '', name: '', content: '', description: '', createdAt: '', updatedAt: '' }

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
  const [error, setError] = React.useState('')
  const [renameTarget, setRenameTarget] = React.useState<PromptFolder | null>(null)
  const [renameDraft, setRenameDraft] = React.useState('')

  const ownerOptions = scope === 'role' ? roles : scope === 'workspace' ? workspaces : []
  // 归属取「当前作用域里真实存在的那个」：切换作用域时不会拿旧的归属 id 去发请求，
  // 角色 id 混进工作区请求这类错配在发起前就被消除。
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

  const reload = React.useCallback(
    async (options?: { keepSelection?: boolean }) => {
      if (scope !== 'global' && !activeOwnerId) {
        setLibrary(EMPTY_PROMPT_LIBRARY)
        setFolders(EMPTY_PROMPT_FOLDER_LIBRARY)
        setError('')
        return
      }
      setLoading(true)
      setError('')
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
        }
      } catch (e: any) {
        setError(text(e?.message) || '加载提示词仓库失败')
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
  const visibleFolders = keyword
    ? layer.folders.filter((folder) => folder.name.includes(keyword))
    : layer.folders
  const visiblePrompts = keyword
    ? layer.prompts.filter((prompt) => prompt.name.includes(keyword) || prompt.content.includes(keyword))
    : layer.prompts

  const selectPrompt = (promptId: string) => {
    setSelectedPromptId(promptId)
    const found = library.prompts.find((prompt) => prompt.id === promptId)
    setDraft(found ? { ...found } : null)
    setError('')
  }

  const createPrompt = () => {
    const entry: PromptEntry = {
      ...EMPTY_ENTRY,
      id: createLocalId('prompt'),
      name: '新提示词',
    }
    setSelectedPromptId(entry.id)
    setDraft(entry)
    setError('')
  }

  const savePrompt = async () => {
    if (!draft) return
    if (!text(draft.name)) {
      setError('提示词名称必填')
      return
    }
    if (!text(draft.content)) {
      setError('提示词内容必填')
      return
    }
    setLoading(true)
    setError('')
    try {
      const exists = library.prompts.some((prompt) => prompt.id === draft.id)
      const prompts = exists
        ? library.prompts.map((prompt) => (prompt.id === draft.id ? draft : prompt))
        : [...library.prompts, draft]
      await callAction<PromptLibrary>('savePromptLibrary', scope, activeOwnerId, { prompts })
      await reload({ keepSelection: true })
      setSelectedPromptId(draft.id)
    } catch (e: any) {
      setError(text(e?.message) || '保存提示词失败')
    } finally {
      setLoading(false)
    }
  }

  const deletePrompt = async () => {
    if (!draft) return
    setLoading(true)
    setError('')
    try {
      await callAction<PromptLibrary>('deletePromptEntry', scope, activeOwnerId, draft.id)
      await reload()
    } catch (e: any) {
      setError(text(e?.message) || '删除提示词失败')
    } finally {
      setLoading(false)
    }
  }

  const createFolder = async () => {
    const folder: PromptFolder = {
      id: createLocalId('folder'),
      name: '新收藏夹',
      folderIds: [],
      promptIds: [],
      createdAt: '',
      updatedAt: '',
    }
    const parentId = currentFolderId
    const next: PromptFolderLibrary = parentId
      ? {
          rootFolderIds: folders.rootFolderIds,
          folders: [
            ...folders.folders.map((item) =>
              item.id === parentId ? { ...item, folderIds: [...item.folderIds, folder.id] } : item,
            ),
            folder,
          ],
        }
      : { rootFolderIds: [...folders.rootFolderIds, folder.id], folders: [...folders.folders, folder] }
    setLoading(true)
    setError('')
    try {
      const saved = await callAction<PromptFolderLibrary>('savePromptFolders', scope, activeOwnerId, next)
      setFolders(saved)
    } catch (e: any) {
      setError(text(e?.message) || '新建收藏夹失败')
    } finally {
      setLoading(false)
    }
  }

  const openRename = (folder: PromptFolder) => {
    setRenameTarget(folder)
    setRenameDraft(folder.name)
  }

  const submitRename = async () => {
    if (!renameTarget) return
    const name = text(renameDraft)
    if (!name) {
      setError('收藏夹名称必填')
      return
    }
    setLoading(true)
    setError('')
    try {
      const saved = await callAction<PromptFolderLibrary>('renamePromptFolder', scope, activeOwnerId, renameTarget.id, name)
      setFolders(saved)
      setRenameTarget(null)
    } catch (e: any) {
      setError(text(e?.message) || '重命名收藏夹失败')
    } finally {
      setLoading(false)
    }
  }

  const deleteFolder = async (folder: PromptFolder) => {
    setLoading(true)
    setError('')
    try {
      const saved = await callAction<PromptFolderLibrary>('deletePromptFolder', scope, activeOwnerId, folder.id)
      setFolders(saved)
      if (currentFolderId === folder.id) setCurrentFolderId(promptFolderParentId(layer))
    } catch (e: any) {
      setError(text(e?.message) || '删除收藏夹失败')
    } finally {
      setLoading(false)
    }
  }

  const moveFolder = async (activeId: string, overId: string) => {
    const ids = layer.folders.map((folder) => folder.id)
    const position = resolveSortMovePosition(ids, activeId, overId)
    if (!position) return
    const next = moveListItemById(ids, (id) => id, activeId, overId, position)
    try {
      const saved = await callAction<PromptFolderLibrary>('reorderPromptFolders', scope, activeOwnerId, currentFolderId, next)
      setFolders(saved)
    } catch (e: any) {
      setError(text(e?.message) || '收藏夹排序失败')
    }
  }

  const movePrompt = async (activeId: string, overId: string) => {
    const ids = layer.prompts.map((prompt) => prompt.id)
    const position = resolveSortMovePosition(ids, activeId, overId)
    if (!position) return
    const next = moveListItemById(ids, (id) => id, activeId, overId, position)
    try {
      if (currentFolderId) {
        const saved = await callAction<PromptFolderLibrary>('reorderFolderPrompts', scope, activeOwnerId, currentFolderId, next)
        setFolders(saved)
        return
      }
      // 根级展示的是「尚未收进收藏夹」的条目：整库保存回写本体顺序。
      const prompts = mergePromptOrder(library.prompts, next)
      const saved = await callAction<PromptLibrary>('savePromptLibrary', scope, activeOwnerId, { prompts })
      setLibrary(saved)
    } catch (e: any) {
      setError(text(e?.message) || '条目排序失败')
    }
  }

  const ownerCandidates = ownerOptions.filter((item: any) => {
    if (!keywordOwner(ownerSearch)) return true
    return text(item?.name).includes(keywordOwner(ownerSearch))
  })

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
              variant={active ? 'contained' : 'text'}
              onClick={() => setScope(value)}
              sx={{ borderRadius: 1.5, fontWeight: 700, py: 0.5 }}
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
                {ownerCandidates.map((item: any) => (
                  <MenuItem key={text(item?.id)} value={text(item?.id)}>
                    {text(item?.name) || text(item?.id)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </>
        ) : null}
        <Button size="small" variant="outlined" startIcon={<FolderOutlinedIcon />} onClick={() => void createFolder()} disabled={loading}>
          新建收藏夹
        </Button>
        <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={createPrompt} disabled={loading}>
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

      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}

      <Stack direction="row" spacing={1.25} sx={{ flex: 1, minHeight: 0 }}>
        <Box
          sx={{
            width: 260,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            borderRadius: 2,
            bgcolor: 'var(--studio-field)',
            p: 0.75,
          }}
        >
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ px: 0.25, pb: 0.5 }}>
            <Tooltip title="返回上一级">
              <span>
                <IconButton
                  size="small"
                  onClick={() => setCurrentFolderId(promptFolderParentId(layer))}
                  disabled={layer.crumbs.length <= 1}
                >
                  <ArrowBackIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
              <Select
                value={currentFolderId}
                onChange={(event) => setCurrentFolderId(String(event.target.value))}
                displayEmpty
                // 面包屑：小圆角矩形、无描边，菜单直接出现（不做过渡动画）。
                MenuProps={{ transitionDuration: 0 }}
                sx={{
                  fontSize: 13,
                  borderRadius: 1,
                  bgcolor: 'var(--studio-field)',
                  '& .MuiSelect-select': { py: 0.5 },
                  '& .MuiOutlinedInput-notchedOutline': { border: 0, borderRadius: 1 },
                  '&:hover .MuiOutlinedInput-notchedOutline': { border: 0 },
                  '&.Mui-focused .MuiOutlinedInput-notchedOutline': { border: 0 },
                }}
              >
                {layer.crumbs.map((crumb) => (
                  <MenuItem key={crumb.id || 'root'} value={crumb.id}>
                    {crumb.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>

          <CustomScrollArea hostSx={{ flex: 1, minHeight: 0 }} scrollSx={{ height: '100%' }} axis="y">
            <Stack spacing={0.5} sx={{ px: 0.25 }}>
              {visibleFolders.length ? (
                <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
                  收藏夹
                </Typography>
              ) : null}
              <SortableList ids={visibleFolders.map((folder) => folder.id)} onMove={(activeId, overId) => void moveFolder(activeId, overId)}>
                {({ id, drag, shouldIgnoreClick }) => {
                  const folder = visibleFolders.find((item) => item.id === id)
                  if (!folder) return null
                  return (
                    <Box ref={drag.setNodeRef} style={drag.style}>
                      <ListItemButton
                        dense
                        onClick={() => {
                          if (shouldIgnoreClick()) return
                          setCurrentFolderId(folder.id)
                          setSelectedPromptId('')
                          setDraft(null)
                        }}
                        sx={{ borderRadius: 1.5, pr: 0.5 }}
                      >
                        <FolderOutlinedIcon fontSize="small" sx={{ mr: 1, color: 'var(--studio-secondary)' }} />
                        <ListItemText primary={folder.name} primaryTypographyProps={{ fontSize: 13, fontWeight: 700 }} />
                        <Tooltip title="重命名">
                          <IconButton
                            size="small"
                            onClick={(event) => {
                              event.stopPropagation()
                              openRename(folder)
                            }}
                          >
                            <Typography sx={{ fontSize: 12 }}>改名</Typography>
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="删除收藏夹（子收藏夹上移）">
                          <IconButton
                            size="small"
                            onClick={(event) => {
                              event.stopPropagation()
                              void deleteFolder(folder)
                            }}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </ListItemButton>
                    </Box>
                  )
                }}
              </SortableList>

              {visiblePrompts.length ? (
                <Typography variant="caption" color="text.secondary" sx={{ px: 0.5, pt: 0.5 }}>
                  {currentFolderId ? '收藏的提示词' : '未收藏的提示词'}
                </Typography>
              ) : null}
              <SortableList ids={visiblePrompts.map((prompt) => prompt.id)} onMove={(activeId, overId) => void movePrompt(activeId, overId)}>
                {({ id, drag, shouldIgnoreClick }) => {
                  const prompt = visiblePrompts.find((item) => item.id === id)
                  if (!prompt) return null
                  return (
                    <Box ref={drag.setNodeRef} style={drag.style}>
                      <ListItemButton
                        dense
                        selected={selectedPromptId === prompt.id}
                        onClick={() => {
                          if (shouldIgnoreClick()) return
                          selectPrompt(prompt.id)
                        }}
                        sx={{ borderRadius: 1.5 }}
                      >
                        <ListItemText
                          primary={prompt.name}
                          secondary={prompt.description || undefined}
                          primaryTypographyProps={{ fontSize: 13, fontWeight: 600 }}
                          secondaryTypographyProps={{ fontSize: 11, noWrap: true }}
                        />
                      </ListItemButton>
                    </Box>
                  )
                }}
              </SortableList>

              {!visibleFolders.length && !visiblePrompts.length ? (
                <Typography variant="body2" color="text.secondary" sx={{ px: 0.5, py: 1 }}>
                  {loading ? '加载中…' : '这一层还是空的'}
                </Typography>
              ) : null}
            </Stack>
          </CustomScrollArea>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {draft ? (
            <Stack spacing={1} sx={{ height: '100%', minHeight: 0 }}>
              <TextField
                size="small"
                label="名称"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
              <TextField
                size="small"
                label="备注（给人看，不进提示词）"
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
              <Stack direction="row" spacing={1}>
                <Button variant="contained" size="small" startIcon={<SaveIcon />} onClick={() => void savePrompt()} disabled={loading}>
                  保存
                </Button>
                <Button
                  variant="text"
                  color="error"
                  size="small"
                  startIcon={<DeleteOutlineIcon />}
                  onClick={() => void deletePrompt()}
                  disabled={loading || !library.prompts.some((prompt) => prompt.id === draft.id)}
                >
                  删除
                </Button>
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                  {library.prompts.some((prompt) => prompt.id === draft.id) ? `ID：${draft.id}` : '新建（未保存）'}
                </Typography>
              </Stack>
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

      <Dialog open={Boolean(renameTarget)} onClose={() => setRenameTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>重命名收藏夹</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="名称"
            value={renameDraft}
            onChange={(event) => setRenameDraft(event.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameTarget(null)}>取消</Button>
          <Button variant="contained" onClick={() => void submitRename()}>
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </SettingsSurface>
  )
}

function keywordOwner(value: string) {
  return text(value)
}
