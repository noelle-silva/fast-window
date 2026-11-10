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
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import BookmarkAddOutlinedIcon from '@mui/icons-material/BookmarkAddOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import NotesOutlinedIcon from '@mui/icons-material/NotesOutlined'
import SaveIcon from '@mui/icons-material/Save'
import {
  EMPTY_PROMPT_FOLDER_LIBRARY,
  EMPTY_PROMPT_LIBRARY,
  PROMPT_SCOPE_LABELS,
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
import {
  NEW_PROMPT_DRAFT_ID,
  dropPromptDraft,
  promptDraftIds,
  readNewPromptDraft,
  readPromptDraft,
  usePromptDraftVersion,
  writeNewPromptDraft,
  writePromptDraft,
} from '../../domain/promptDrafts'
import { moveListItemById } from '../../domain/listOrdering'
import { resolveSortMovePosition, type SortableDropConfig } from '../components/SortableDnd'
import { MoreActionsMenu } from '../components/MoreActionsMenu'
import { SettingsSurface } from './SettingsSurfaces'
import { FillTextarea } from '../components/FillTextarea'
import { PromptLibrarySidebar } from './PromptLibrarySidebar'
import { PromptFolderPicker } from './PromptFolderPicker'

// 提示词仓库管理：三段作用域切换 + 混排侧边栏 + 右侧条目编辑器。
// 最右侧留了附加栏插槽：输入区的模态窗挂当前输入框，设置页不传就保持两栏。
// 收藏走「收藏到收藏夹」模态窗；条目与收藏夹的功能入口都在右键菜单里。

const EMPTY_ENTRY: PromptEntry = { id: '', name: '', content: '', description: '', createdAt: '', updatedAt: '' }

// 次要按钮也用实心底色，不用纯边框或透明样式。
const FILLED_SECONDARY_SX = {
  bgcolor: 'var(--studio-field)',
  color: 'var(--studio-text-primary)',
  boxShadow: 'var(--studio-shadow-soft)',
  '&:hover': { bgcolor: 'var(--studio-field-hover)', boxShadow: 'var(--studio-shadow-soft)' },
}

type PendingDelete = { kind: 'prompt' | 'folder'; id: string; name: string }

/** 一个作用域上次停留的位置：归属 + 收藏夹层级。 */
export type PromptLibraryBrowseState = {
  ownerId?: string
  folderId?: string
  /** 上次打开的那条提示词：重开窗口直接回到它的编辑位。 */
  selectedPromptId?: string
}

type PromptLibrarySettingsPanelProps = {
  controller: any
  roles?: any[]
  workspaces?: any[]
  /** 打开时落在哪一段作用域（输入区模态窗按按钮预置）；面板内仍可自由切换。 */
  initialScope?: PromptScope
  /** 打开时优先选中的归属（例如当前角色）；不在列表里时回落到第一个。 */
  initialOwnerId?: string
  /**
   * 切换作用域时优先选中的归属：当前会话的角色 / 工作区。
   * 传了它就按会话上下文走；不传则各段都回落到列表第一个。
   */
  preferredOwnerIds?: { role?: string; workspace?: string }
  /**
   * 各作用域上次停留的位置（调用方按会话保存）。
   * 打开与切段时优先恢复这里记录的归属与收藏夹层级。
   */
  browseState?: Partial<Record<PromptScope, PromptLibraryBrowseState>>
  /** 浏览位置变化时上报，由调用方按会话保存。 */
  onBrowseStateChange?: (scope: PromptScope, state: Required<PromptLibraryBrowseState>) => void
  /**
   * 最右侧附加栏：调用方按场景注入（输入区的模态窗挂当前输入框）。
   * 设置页不传，面板保持原来的两栏。
   */
  sidePane?: React.ReactNode
  /** 行内「填入」的去处：把提示词正文插到聊天输入框当前光标处。 */
  onInsertPromptText?: (text: string) => void
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

export function PromptLibrarySettingsPanel(props: PromptLibrarySettingsPanelProps) {
  const {
    controller,
    roles = [],
    workspaces = [],
    initialScope = 'global',
    initialOwnerId = '',
    preferredOwnerIds = {},
    browseState = {},
    onBrowseStateChange,
    sidePane,
    onInsertPromptText,
  } = props

  const initialBrowse = browseState[initialScope] || {}
  const [scope, setScope] = React.useState<PromptScope>(initialScope)
  const [ownerId, setOwnerId] = React.useState(String(initialBrowse.ownerId || initialOwnerId || ''))
  const [library, setLibrary] = React.useState<PromptLibrary>(EMPTY_PROMPT_LIBRARY)
  const [folders, setFolders] = React.useState<PromptFolderLibrary>(EMPTY_PROMPT_FOLDER_LIBRARY)
  const [currentFolderId, setCurrentFolderId] = React.useState(String(initialBrowse.folderId || ''))
  const [selectedPromptId, setSelectedPromptId] = React.useState('')
  const [draft, setDraft] = React.useState<PromptEntry | null>(null)
  /** 备注平时收在「更多」菜单里，点了才在编辑器里占一行。 */
  const [remarkOpen, setRemarkOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [folderDialog, setFolderDialog] = React.useState<{ mode: 'create' | 'rename'; folderId: string; name: string } | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState<PendingDelete | null>(null)
  const [pickerTarget, setPickerTarget] = React.useState<{ mode: 'collect' | 'collect-folder' | 'move-prompt' | 'move-folder'; id: string } | null>(null)
  const [pickerInitialIds, setPickerInitialIds] = React.useState<string[]>([])

  const ownerOptions = scope === 'role' ? roles : scope === 'workspace' ? workspaces : []
  const ownerIds = React.useMemo(() => ownerOptions.map((item: any) => text(item?.id)).filter(Boolean), [ownerOptions])
  const activeOwnerId = resolveActiveOwnerId(scope, ownerId, ownerIds)

  // 哪些条目还挂着没保存的草稿：列表靠它在条目标题旁点一个黄点。
  const promptDraftVersion = usePromptDraftVersion()
  const dirtyPromptIds = React.useMemo(
    () => promptDraftIds(scope, activeOwnerId),
    [scope, activeOwnerId, promptDraftVersion],
  )

  // 切换作用域时把归属带到上一次停留的位置：优先恢复该段的记忆，
  // 没有记忆才用会话上下文（当前角色 / 工作区），两者都没有就留空回落第一个。
  const switchScope = (nextScope: PromptScope) => {
    if (nextScope === scope) return
    const remembered = browseState[nextScope] || {}
    setScope(nextScope)
    setOwnerId(
      remembered.ownerId ||
        (nextScope === 'role'
          ? text(preferredOwnerIds.role)
          : nextScope === 'workspace'
            ? text(preferredOwnerIds.workspace)
            : ''),
    )
    setCurrentFolderId(remembered.folderId || '')
  }

  // 浏览位置按作用域上报，调用方按会话保存；下次打开或切段时从这里恢复。
  React.useEffect(() => {
    if (!onBrowseStateChange) return
    onBrowseStateChange(scope, { ownerId: activeOwnerId, folderId: currentFolderId, selectedPromptId })
  }, [scope, activeOwnerId, currentFolderId, selectedPromptId, onBrowseStateChange])

  // 重开窗口时直接回到上次打开的那条提示词：库到位后补一次选中，之后不再抢。
  const restoredPromptRef = React.useRef(false)
  React.useEffect(() => {
    if (restoredPromptRef.current) return
    if (!library.prompts.length) return
    restoredPromptRef.current = true
    const wanted = String(browseState[scope]?.selectedPromptId || '')
    if (!wanted) return
    const found = library.prompts.find((prompt) => prompt.id === wanted)
    if (!found) return
    setSelectedPromptId(found.id)
    setDraft(readPromptDraft(scope, activeOwnerId, found.id) ?? { ...found })
  }, [activeOwnerId, browseState, library.prompts, scope])

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
          // 只清选中项；收藏夹层级由作用域 / 归属切换显式管理，避免把恢复的位置冲掉。
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
    // 有没保存的草稿就接着改，缓存里没有才用库里这份。
    const cached = readPromptDraft(scope, activeOwnerId, promptId)
    const found = library.prompts.find((prompt) => prompt.id === promptId)
    setDraft(cached ?? (found ? { ...found } : null))
  }

  const createPrompt = () => {
    // 上一条新建还没保存，就先接着它写，不要另起一条把它顶掉。
    const cached = readNewPromptDraft(scope, activeOwnerId)
    if (cached) {
      setSelectedPromptId(cached.id)
      setDraft(cached)
      return
    }
    const entry: PromptEntry = { ...EMPTY_ENTRY, id: createLocalId('prompt'), name: '新提示词' }
    setSelectedPromptId(entry.id)
    setDraft(entry)
  }

  // 改到一半的内容随手写进草稿缓存：换条目、关模态窗都不会丢。
  const updateDraft = React.useCallback(
    (patch: Partial<PromptEntry>) => {
      setDraft((prev) => {
        if (!prev) return prev
        const next = { ...prev, ...patch }
        if (library.prompts.some((prompt) => prompt.id === next.id)) writePromptDraft(scope, activeOwnerId, next)
        else writeNewPromptDraft(scope, activeOwnerId, next)
        return next
      })
    },
    [activeOwnerId, library.prompts, scope],
  )

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
      // 保存成功，这份草稿就不再是「未保存」了。
      dropPromptDraft(scope, activeOwnerId, draft.id)
      dropPromptDraft(scope, activeOwnerId, NEW_PROMPT_DRAFT_ID)
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

  // 填入：把正文交给调用方，由它在聊天输入框的光标处落字。
  // 面板只认「这条提示词写了什么」，不知道输入框在哪。
  const insertPromptContent = React.useCallback(
    (promptId: string) => {
      const prompt = library.prompts.find((item) => item.id === promptId)
      if (!prompt) return
      const body = String(prompt.content || '')
      if (!body) {
        // 空提示词插进去等于什么都没发生，直接说清楚，别让人以为按钮坏了。
        notify('这条提示词还没有内容')
        return
      }
      onInsertPromptText?.(body)
      notify('已填入输入框', 'success')
    },
    [library.prompts, notify, onInsertPromptText],
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
          onInsertPrompt={onInsertPromptText ? insertPromptContent : undefined}
          dirtyPromptIds={dirtyPromptIds}
          onReorderEntries={(activeKey, overKey) => void moveEntry(activeKey, overKey)}
          onCollectEntry={collectEntry}
          onMoveEntryToFolder={moveEntryToFolder}
          onRenameFolder={openRename}
          onDeleteFolder={(folder) => setPendingDelete({ kind: 'folder', id: folder.id, name: folder.name })}
          search={search}
          onSearchChange={setSearch}
          onCreatePrompt={createPrompt}
          onCreateFolder={openCreateFolder}
        />

        {/* 顶部切换栏与编辑器同宽：左上那一整块让给列表，下拉仍与下方输入框对齐。 */}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.25, minHeight: 0 }}>
          {/* 分段切换：实心底座 + 选中块，不用轮廓线描边。
              归属下拉挂在同一行的右侧，只占固定宽度，切换按钮仍留足点击区域。 */}
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', gap: 0.5, p: 0.5, borderRadius: 2, bgcolor: 'var(--studio-field)' }}>
              {(Object.keys(PROMPT_SCOPE_LABELS) as PromptScope[]).map((value) => {
                const active = scope === value
                return (
                  <Button
                    key={value}
                    fullWidth
                    size="small"
                    disableElevation
                    variant="contained"
                    onClick={() => switchScope(value)}
                    sx={active ? { borderRadius: 1.5, fontWeight: 700, py: 0.5 } : [{ borderRadius: 1.5, fontWeight: 700, py: 0.5 }, FILLED_SECONDARY_SX]}
                  >
                    {PROMPT_SCOPE_LABELS[value]}
                  </Button>
                )
              })}
            </Box>
            {/* 归属槽位始终占同一段宽度：切到全局只是清空内容，切换按钮的宽度不跟着跳。 */}
            <Box sx={{ width: 280, flexShrink: 0 }}>
              {scope !== 'global' ? (
                <FormControl size="small" fullWidth>
                  <InputLabel id="prompt-library-owner-label">{scope === 'role' ? '选择角色' : '选择工作区'}</InputLabel>
                  <Select
                    labelId="prompt-library-owner-label"
                    label={scope === 'role' ? '选择角色' : '选择工作区'}
                    value={activeOwnerId}
                    onChange={(event) => {
                      setOwnerId(String(event.target.value))
                      // 换归属等于换一份库，回到根层。
                      setCurrentFolderId('')
                    }}
                  >
                    {ownerOptions.map((item: any) => (
                      <MenuItem key={text(item?.id)} value={text(item?.id)}>
                        {text(item?.name) || text(item?.id)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              ) : null}
            </Box>
          </Stack>

          {scope !== 'global' && !ownerIds.length ? (
            <Typography variant="body2" color="text.secondary">
              {scope === 'role' ? '还没有角色，先去「角色管理」新建一个。' : '还没有工作区，先去「工作区管理」新建一个。'}
            </Typography>
          ) : null}

          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', gap: 1.25, minHeight: 0 }}>
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {draft ? (
                <Stack spacing={1} sx={{ height: '100%', minHeight: 0 }}>
                  {/* 名称、保存、收藏、更多操作同一行，右侧对齐。 */}
                  <Stack direction="row" spacing={1} alignItems="center">
                    <TextField
                      size="small"
                      label="名称"
                      value={draft.name}
                      onChange={(event) => updateDraft({ name: event.target.value })}
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
                    {/* 收藏只留图标：省下的横向空间归名称输入框。 */}
                    <IconButton
                      size="small"
                      aria-label="收藏到收藏夹"
                      onClick={() => openPicker({ mode: 'collect', id: draft.id })}
                      disabled={loading || !isSaved}
                      sx={{ ...FILLED_SECONDARY_SX, borderRadius: 1.5 }}
                    >
                      <BookmarkAddOutlinedIcon fontSize="small" />
                    </IconButton>
                    <MoreActionsMenu
                      ariaLabel="提示词操作"
                      items={[
                        {
                          key: 'remark',
                          label: remarkOpen ? '隐藏备注' : '显示备注',
                          icon: <NotesOutlinedIcon fontSize="small" />,
                          onSelect: () => setRemarkOpen((current) => !current),
                        },
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
                  {remarkOpen ? (
                    <TextField
                      size="small"
                      label="备注"
                      value={draft.description}
                      onChange={(event) => updateDraft({ description: event.target.value })}
                    />
                  ) : null}
                  {/* 内容框吃满剩余高度，内容再长也只在框内滚，滑块用项目自制的那一套。 */}
                  <FillTextarea
                    label="内容"
                    value={draft.content}
                    onChange={(next) => updateDraft({ content: next })}
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

            {sidePane}
          </Box>
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
