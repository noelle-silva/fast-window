import * as React from 'react'
import {
  Box,
  Button,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
  type SxProps,
  type Theme,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import DriveFileMoveOutlinedIcon from '@mui/icons-material/DriveFileMoveOutlined'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { type MoreActionsMenuItem } from '../components/MoreActionsMenu'
import { SettingsSurface } from './SettingsSurfaces'
import { TaskTreeCard } from './TaskTreeCard'
import { TaskTreeEditor } from './TaskTreeEditor'
import { TaskTreeMoveDialog } from './TaskTreeMoveDialog'
import { copyTextToClipboard } from '../../render/copy'
import {
  EMPTY_TASK_TREE,
  TASK_SCOPES,
  TASK_SCOPE_LABELS,
  applyTaskDraft,
  archivedTaskEntries,
  createTaskId,
  moveTaskInLayer,
  resolveTaskPath,
  taskById,
  taskDraftIsDirty,
  taskDraftOf,
  taskLabel,
  taskLayerNodes,
  taskParentOptions,
  taskPathIds,
  taskSiblingLayer,
  taskSubtreeIds,
  type ArchivedTaskEntry,
  type TaskDraft,
  type TaskNode,
  type TaskScope,
  type TaskTree,
} from '../../domain/taskTree'
import { dropTaskDraft, readTaskDraft, writeTaskDraft } from '../../domain/taskTreeDrafts'

// 任务树面板：设置页分类与输入区模态窗共用同一份。
//
// 布局照原型：顶部层级面包屑 + 返回，左侧当前节点详情，右侧下一层卡片墙。
// 卡片面只放标题与复制键；新建、移动、排序、删除都在卡片的更多菜单与左栏里，
// 这样原型里「一眼能复制」的观感保留，操作入口又不缺。

/** 一个作用域上次停留的位置：归属 + 节点层级。 */
export type TaskTreeBrowseState = {
  ownerId?: string
  pathIds?: string[]
}

type TaskTreePanelProps = {
  controller: any
  roles?: any[]
  workspaces?: any[]
  /** 打开时落在哪一段作用域（输入区模态窗按按钮预置）；面板内仍可切换。 */
  initialScope?: TaskScope
  /** 锁定作用域：给出它就不再渲染切换栏，整个面板只服务这一段（输入区两个独立入口用）。 */
  lockedScope?: TaskScope
  /** 打开时优先选中的归属（例如当前角色）；不在列表里时回落到第一个。 */
  initialOwnerId?: string
  /** 切换作用域时优先选中的归属：当前会话的角色 / 工作区。 */
  preferredOwnerIds?: { role?: string; workspace?: string }
  /** 各作用域上次停留的位置（调用方按会话保存）。 */
  browseState?: Partial<Record<TaskScope, TaskTreeBrowseState>>
  /** 浏览位置变化时上报，由调用方按会话保存。 */
  onBrowseStateChange?: (scope: TaskScope, state: Required<TaskTreeBrowseState>) => void
}

const FILLED_SECONDARY_SX = {
  bgcolor: 'var(--studio-field)',
  color: 'var(--studio-text-primary)',
  boxShadow: 'var(--studio-shadow-soft)',
  '&:hover': { bgcolor: 'var(--studio-field-hover)', boxShadow: 'var(--studio-shadow-soft)' },
}

// 卡片墙的内容层：网格排布连同内边距一起放进滚动内容里（跟着一起滚），
// 内边距留给卡片的 hover 阴影与上浮位移，不会被滚动容器裁掉。
const TASK_WALL_CONTENT_SX: SxProps<Theme> = {
  p: 2,
  display: 'grid',
  gridTemplateColumns: { xs: 'repeat(auto-fill, minmax(150px, 1fr))', sm: 'repeat(auto-fill, minmax(220px, 1fr))' },
  gap: 2,
  alignContent: 'start',
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function resolveOwnerId(ownerId: string, ownerIds: string[]): string {
  const current = text(ownerId)
  return ownerIds.includes(current) ? current : ownerIds[0] ?? ''
}

export function TaskTreePanel(props: TaskTreePanelProps) {
  const {
    controller,
    roles = [],
    workspaces = [],
    initialScope = 'role',
    lockedScope,
    initialOwnerId = '',
    preferredOwnerIds = {},
    browseState = {},
    onBrowseStateChange,
  } = props

  const initialBrowse = browseState[initialScope] || {}
  const [scope, setScope] = React.useState<TaskScope>(lockedScope ?? initialScope)
  const [ownerId, setOwnerId] = React.useState(String(initialBrowse.ownerId || initialOwnerId || ''))
  const [tree, setTree] = React.useState<TaskTree>(EMPTY_TASK_TREE)
  /** 树是不是已经和当前作用域/归属对齐了：没对齐之前不做路径校正。 */
  const [treeReady, setTreeReady] = React.useState(false)
  const [pathIds, setPathIds] = React.useState<string[]>(initialBrowse.pathIds || [])
  const [draft, setDraft] = React.useState<TaskDraft | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [copiedId, setCopiedId] = React.useState('')
  const [moveTarget, setMoveTarget] = React.useState<TaskNode | null>(null)
  const [moveParentId, setMoveParentId] = React.useState('')
  /** 归档页：与层级浏览并列的第二个视图，切过去不改变原来的层级位置。 */
  const [archiveView, setArchiveView] = React.useState(false)
  const [archivedSelectedId, setArchivedSelectedId] = React.useState('')

  const ownerOptions = scope === 'role' ? roles : workspaces
  const ownerIds = React.useMemo(
    () => ownerOptions.map((item: any) => text(item?.id)).filter(Boolean),
    [ownerOptions],
  )
  const activeOwnerId = resolveOwnerId(ownerId, ownerIds)

  // 切换作用域时把归属带到上一次停留的位置：优先恢复该段的记忆，其次用会话上下文。
  const switchScope = (nextScope: TaskScope) => {
    if (nextScope === scope) return
    const remembered = browseState[nextScope] || {}
    setScope(nextScope)
    setOwnerId(
      remembered.ownerId ||
        (nextScope === 'role' ? text(preferredOwnerIds.role) : text(preferredOwnerIds.workspace)),
    )
    setPathIds(remembered.pathIds || [])
    setArchiveView(false)
    setArchivedSelectedId('')
  }

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
      const fn = controller?.actions?.notifyTaskTree
      if (typeof fn === 'function') fn(message, kind)
    },
    [controller],
  )

  const reload = React.useCallback(async () => {
    if (!activeOwnerId) {
      setTree(EMPTY_TASK_TREE)
      return
    }
    setLoading(true)
    setTreeReady(false)
    try {
      const next = await callAction<TaskTree>('loadTaskTree', scope, activeOwnerId)
      setTreeReady(true)
      setTree(next)
    } catch (error: any) {
      notify(text(error?.message) || '加载任务失败')
    } finally {
      setLoading(false)
    }
  }, [activeOwnerId, callAction, notify, scope])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const path = React.useMemo(() => resolveTaskPath(tree, pathIds), [tree, pathIds])
  const current = path.length ? path[path.length - 1] : null
  const layerNodes = React.useMemo(() => taskLayerNodes(tree, path), [tree, path])
  // 归档任务不出卡片，数据仍留在树里：改回状态就能重新出现。
  const visibleNodes = React.useMemo(
    () => layerNodes.filter((node) => node.status !== 'archived'),
    [layerNodes],
  )

  // 归档页把整棵树里的归档节点摊平；路径前缀用来区分不同层级的同名任务。
  const archivedEntries = React.useMemo(() => archivedTaskEntries(tree), [tree])
  // 选中的归档任务必须仍处于归档状态：恢复之后它就从归档页消失，编辑位跟着收起。
  const archivedSelected = React.useMemo(() => {
    if (!archiveView || !archivedSelectedId) return null
    const node = taskById(tree, archivedSelectedId)
    return node && node.status === 'archived' ? node : null
  }, [archiveView, archivedSelectedId, tree])
  /** 编辑位面对的那个节点：正常视图是当前层级节点，归档页是被选中的归档节点。 */
  const editingNode = archiveView ? archivedSelected : current

  // 路径里被删掉的那一段会在解析时截断，这里把状态同步成截断后的真实路径。
  // 树还没对齐时不能校正：那一刻解析出来的是空路径，会把刚恢复的浏览位置抹掉——
  // 重开窗口「总是回到根层」就是这里造成的。
  React.useEffect(() => {
    if (!treeReady) return
    if (pathIds.length !== path.length) setPathIds(taskPathIds(path))
  }, [path, pathIds, treeReady])

  // 换节点时先看有没有没保存的草稿：有就接着改，没有才用服务端这份。
  // 依赖只认节点 id：树里别的节点变了不该把正在改的内容冲掉。
  React.useEffect(() => {
    if (!editingNode) {
      setDraft(null)
      return
    }
    setDraft(readTaskDraft(scope, activeOwnerId, editingNode.id) ?? taskDraftOf(editingNode))
  }, [editingNode?.id, scope, activeOwnerId])

  // 改到一半的文字随手写进草稿缓存：换层级、关模态窗都不会丢。
  const onDraftChange = React.useCallback(
    (patch: Partial<TaskDraft>) => {
      setDraft((prev) => {
        if (!prev) return prev
        const next = { ...prev, ...patch }
        writeTaskDraft(scope, activeOwnerId, next.id, next)
        return next
      })
    },
    [scope, activeOwnerId],
  )

  // 浏览位置按作用域上报，调用方按会话保存；下次打开或切段时从这里恢复。
  React.useEffect(() => {
    if (!onBrowseStateChange) return
    onBrowseStateChange(scope, { ownerId: activeOwnerId, pathIds })
  }, [scope, activeOwnerId, pathIds, onBrowseStateChange])

  const dirty = taskDraftIsDirty(editingNode, draft)
  // enterPrefix 是新节点落脚层的路径前缀：建完直接进到它这一层，左栏就是它的编辑位。
  const callCreate = async (parentId: string, enterPrefix: string[]) => {
    const node: TaskNode = {
      id: createTaskId(),
      name: '',
      description: '',
      content: '',
      copyHighlight: false,
      status: 'todo',
      children: [],
      createdAt: '',
      updatedAt: '',
    }
    setLoading(true)
    try {
      const saved = await callAction<TaskTree>('createTaskNode', scope, activeOwnerId, parentId, node)
      setTree(saved)
      setPathIds([...enterPrefix, node.id])
    } catch (error: any) {
      notify(text(error?.message) || '新建任务失败')
    } finally {
      setLoading(false)
    }
  }

  // 顶部新建：挂在当前节点下；在根层就建根任务。
  const createInCurrentLayer = () => {
    void callCreate(current?.id ?? '', pathIds)
  }

  const saveDraft = async () => {
    if (!editingNode || !draft || !dirty) return
    setSaving(true)
    try {
      const saved = await callAction<TaskTree>('saveTaskTree', scope, activeOwnerId, applyTaskDraft(tree, draft))
      setTree(saved)
      dropTaskDraft(scope, activeOwnerId, draft.id)
    } catch (error: any) {
      notify(text(error?.message) || '保存任务失败')
    } finally {
      setSaving(false)
    }
  }

  // 归档是动作而不是字段编辑：菜单里确认之后直接落库，不等「保存」。
  // 同时丢掉这个节点残留的草稿，免得下次进来把归档状态又覆盖回去。
  const archiveTask = async (node: TaskNode) => {
    const base = taskDraftOf(node)
    if (!base) return
    setLoading(true)
    try {
      const saved = await callAction<TaskTree>(
        'saveTaskTree',
        scope,
        activeOwnerId,
        applyTaskDraft(tree, { ...base, status: 'archived' }),
      )
      setTree(saved)
      dropTaskDraft(scope, activeOwnerId, node.id)
    } catch (error: any) {
      notify(text(error?.message) || '归档任务失败')
    } finally {
      setLoading(false)
    }
  }

  const removeTask = async (node: TaskNode) => {
    const depth = pathIds.indexOf(node.id)
    setLoading(true)
    try {
      const saved = await callAction<TaskTree>('deleteTaskNode', scope, activeOwnerId, node.id)
      setTree(saved)
      if (depth >= 0) setPathIds(pathIds.slice(0, depth))
      setArchivedSelectedId((previousId) => (previousId === node.id ? '' : previousId))
    } catch (error: any) {
      notify(text(error?.message) || '删除任务失败')
    } finally {
      setLoading(false)
    }
  }

  const reorderTask = async (node: TaskNode, delta: number) => {
    const layer = taskSiblingLayer(tree, node.id)
    if (!layer) return
    const next = moveTaskInLayer(layer.ids, node.id, delta)
    if (next.join('|') === layer.ids.join('|')) return
    setLoading(true)
    try {
      const saved = await callAction<TaskTree>('reorderTaskChildren', scope, activeOwnerId, layer.parentId, next)
      setTree(saved)
    } catch (error: any) {
      notify(text(error?.message) || '排序失败')
    } finally {
      setLoading(false)
    }
  }

  const openMove = (node: TaskNode) => {
    setMoveParentId('')
    setMoveTarget(node)
  }

  const confirmMove = async () => {
    const node = moveTarget
    setMoveTarget(null)
    if (!node) return
    setLoading(true)
    try {
      const saved = await callAction<TaskTree>('moveTaskNode', scope, activeOwnerId, node.id, moveParentId)
      setTree(saved)
    } catch (error: any) {
      notify(text(error?.message) || '移动任务失败')
    } finally {
      setLoading(false)
    }
  }

  const copyContent = async (node: TaskNode) => {
    const content = String(node.content ?? '')
    if (!content.trim()) return
    const ok = await copyTextToClipboard(content)
    notify(ok ? '已复制' : '复制失败', ok ? 'success' : 'error')
    if (!ok) return
    setCopiedId(node.id)
    window.setTimeout(() => setCopiedId((currentId) => (currentId === node.id ? '' : currentId)), 1500)
  }

  const cardMenu = (node: TaskNode): MoreActionsMenuItem[] => {
    const layer = taskSiblingLayer(tree, node.id)
    const index = layer ? layer.ids.indexOf(node.id) : -1
    return [
      {
        key: 'open',
        label: node.children.length ? '进入下一层' : '打开',
        onSelect: () => setPathIds([...pathIds, node.id]),
      },
      {
        key: 'create-child',
        label: '新建子任务',
        icon: <AddIcon fontSize="small" />,
        onSelect: () => void callCreate(node.id, [...pathIds, node.id]),
      },
      {
        key: 'move',
        label: '移动到…',
        icon: <DriveFileMoveOutlinedIcon fontSize="small" />,
        onSelect: () => openMove(node),
      },
      {
        key: 'archive',
        label: '归档',
        icon: <ArchiveOutlinedIcon fontSize="small" />,
        confirm: {
          title: `归档「${taskLabel(node)}」？`,
          description: '归档后这张卡片不再出现在任务墙，数据会保留，可以从顶部栏的归档页找回来。',
          confirmLabel: '归档',
          tone: 'primary',
        },
        onSelect: () => void archiveTask(node),
      },
      {
        key: 'up',
        label: '上移',
        disabled: index <= 0,
        onSelect: () => void reorderTask(node, -1),
      },
      {
        key: 'down',
        label: '下移',
        disabled: index < 0 || !layer || index >= layer.ids.length - 1,
        onSelect: () => void reorderTask(node, 1),
      },
      {
        key: 'delete',
        label: '删除',
        danger: true,
        icon: <DeleteOutlineIcon fontSize="small" />,
        confirm: {
          title: `删除「${taskLabel(node)}」？`,
          description: node.children.length ? '它的整棵子树会一起删除，删掉不可恢复。' : '删掉不可恢复。',
          confirmLabel: '删除',
        },
        onSelect: () => void removeTask(node),
      },
    ]
  }

  const moveOptions = React.useMemo(() => {
    if (!moveTarget) return []
    return taskParentOptions(tree, new Set(taskSubtreeIds(moveTarget)))
  }, [moveTarget, tree])

  const renderCard = (node: TaskNode) => (
    <TaskTreeCard
      key={node.id}
      title={taskLabel(node)}
      description={node.description}
      copyHighlight={node.copyHighlight}
      status={node.status}
      copied={copiedId === node.id}
      canCopy={Boolean(node.content.trim())}
      menuItems={cardMenu(node)}
      onOpen={() => setPathIds([...pathIds, node.id])}
      onCopy={() => void copyContent(node)}
    />
  )

  // 归档页的卡片：点开就在左栏恢复状态；菜单只留删除，
  // 在归档上下文里不做新建子任务 / 移动这类结构动作。
  const archivedCardMenu = (node: TaskNode): MoreActionsMenuItem[] => [
    {
      key: 'delete',
      label: '删除',
      danger: true,
      icon: <DeleteOutlineIcon fontSize="small" />,
      confirm: {
        title: `删除「${taskLabel(node)}」？`,
        description: node.children.length ? '它的整棵子树会一起删除，删掉不可恢复。' : '删掉不可恢复。',
        confirmLabel: '删除',
      },
      onSelect: () => void removeTask(node),
    },
  ]

  const renderArchivedCard = (entry: ArchivedTaskEntry) => (
    <TaskTreeCard
      key={entry.node.id}
      title={taskLabel(entry.node)}
      description={entry.node.description}
      trail={entry.trail.join(' / ')}
      copyHighlight={entry.node.copyHighlight}
      status={entry.node.status}
      copied={copiedId === entry.node.id}
      canCopy={Boolean(entry.node.content.trim())}
      menuItems={archivedCardMenu(entry.node)}
      onOpen={() => setArchivedSelectedId(entry.node.id)}
      onCopy={() => void copyContent(entry.node)}
    />
  )

  // 卡片墙的内容与空态随视图切换：归档页是整棵树的扁平清单，正常视图是当前层。
  const wallContent = archiveView ? archivedEntries.map(renderArchivedCard) : visibleNodes.map(renderCard)
  const wallEmptyMessage = archiveView
    ? '还没有归档的任务'
    : !ownerIds.length
      ? scope === 'role'
        ? '还没有角色，先去「角色管理」新建一个。'
        : '还没有工作区，先去「工作区管理」新建一个。'
      : layerNodes.length
        ? '这一层的任务都已归档'
        : '这一层还没有任务'

  return (
    <SettingsSurface sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {/* 顶部栏：左侧是归档入口（归档页里换成返回 + 标题），右侧是归属下拉与新建按钮；
          设置页多出来的作用域切换也在左侧。模态窗锁定了作用域，这一行就是它的顶部栏。 */}
      <Stack direction="row" spacing={1.25} alignItems="center">
        {lockedScope ? null : (
          <Box sx={{ display: 'flex', gap: 0.5, p: 0.5, borderRadius: 2, bgcolor: 'var(--studio-field)', width: 240, flexShrink: 0 }}>
            {TASK_SCOPES.map((value) => {
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
                  {TASK_SCOPE_LABELS[value]}
                </Button>
              )
            })}
          </Box>
        )}

        {archiveView ? (
          <Stack direction="row" spacing={0.75} alignItems="center">
            <IconButton
              size="small"
              aria-label="返回任务层级"
              onClick={() => setArchiveView(false)}
              sx={{ ...FILLED_SECONDARY_SX, borderRadius: 1.5 }}
            >
              <ArrowBackIcon fontSize="small" />
            </IconButton>
            <Typography
              component="span"
              variant="body2"
              sx={{ fontWeight: 700, color: 'var(--studio-text-primary)', whiteSpace: 'nowrap' }}
            >
              归档任务
            </Typography>
          </Stack>
        ) : (
          <Button
            size="small"
            disableElevation
            variant="contained"
            startIcon={<ArchiveOutlinedIcon fontSize="small" />}
            onClick={() => {
              setArchiveView(true)
              setArchivedSelectedId('')
            }}
            sx={{ borderRadius: 1.5, fontWeight: 700, py: 0.5, ...FILLED_SECONDARY_SX }}
          >
            归档
          </Button>
        )}

        <Box sx={{ flex: 1 }} />

        <Box sx={{ width: 220, flexShrink: 0 }}>
          <FormControl size="small" fullWidth>
            <InputLabel id="task-tree-owner-label">{scope === 'role' ? '选择角色' : '选择工作区'}</InputLabel>
            <Select
              labelId="task-tree-owner-label"
              label={scope === 'role' ? '选择角色' : '选择工作区'}
              value={activeOwnerId}
              onChange={(event) => {
                setOwnerId(String(event.target.value))
                // 换归属等于换一棵树，回到根层、也回到正常视图。
                setPathIds([])
                setArchiveView(false)
                setArchivedSelectedId('')
              }}
            >
              {ownerOptions.map((item: any) => (
                <MenuItem key={text(item?.id)} value={text(item?.id)}>
                  {text(item?.name) || text(item?.id)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>

        {archiveView ? null : (
          <IconButton
            size="small"
            aria-label="新建任务"
            onClick={createInCurrentLayer}
            disabled={loading || !activeOwnerId}
            sx={{
              borderRadius: 1.5,
              bgcolor: 'primary.main',
              color: '#fff',
              '&:hover': { bgcolor: 'primary.dark' },
            }}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        )}
      </Stack>

      {/* 面包屑行：返回按钮与当前层级路径。归档页自成一层，不需要路径。 */}
      {archiveView ? null : (
        <Stack direction="row" spacing={1.25} alignItems="center">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 }}>
          <IconButton
            size="small"
            aria-label="返回上一级"
            disabled={!path.length || loading}
            onClick={() => setPathIds(pathIds.slice(0, -1))}
            sx={{ ...FILLED_SECONDARY_SX, borderRadius: 1.5 }}
          >
            <ArrowBackIcon fontSize="small" />
          </IconButton>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              minWidth: 0,
              overflowX: 'auto',
              whiteSpace: 'nowrap',
              scrollbarWidth: 'none',
              '&::-webkit-scrollbar': { display: 'none' },
            }}
          >
            <Typography
              component="span"
              variant="body2"
              onClick={() => setPathIds([])}
              sx={{ cursor: 'pointer', fontWeight: path.length ? 400 : 600, color: path.length ? 'var(--studio-text-secondary)' : 'var(--studio-text-primary)' }}
            >
              根路径
            </Typography>
            {path.map((node, index) => {
              const isCurrent = index === path.length - 1
              return (
                <React.Fragment key={node.id}>
                  <Typography component="span" variant="body2" sx={{ color: 'var(--studio-text-tertiary)' }}>
                    /
                  </Typography>
                  <Typography
                    component="span"
                    variant="body2"
                    onClick={() => {
                      if (isCurrent) return
                      setPathIds(path.slice(0, index + 1).map((item) => item.id))
                    }}
                    sx={{
                      cursor: isCurrent ? 'default' : 'pointer',
                      fontWeight: isCurrent ? 600 : 400,
                      color: isCurrent ? 'var(--studio-text-primary)' : 'var(--studio-text-secondary)',
                    }}
                  >
                    {taskLabel(node)}
                  </Typography>
                </React.Fragment>
              )
            })}
          </Box>
        </Box>
        </Stack>
      )}

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gap: 2,
          alignItems: 'stretch',
          gridTemplateColumns: editingNode ? { xs: '1fr', lg: '320px minmax(0, 1fr)' } : 'minmax(0, 1fr)',
        }}
      >
        {editingNode ? (
          <TaskTreeEditor
            draft={draft}
            label={taskLabel(editingNode)}
            dirty={dirty}
            saving={saving}
            canCopy={Boolean(editingNode.content.trim())}
            hasChildren={editingNode.children.length > 0}
            archived={archiveView}
            onDraftChange={onDraftChange}
            onSave={() => void saveDraft()}
            onCopy={() => void copyContent(editingNode)}
            onMove={() => openMove(editingNode)}
            onCreateChild={() => void callCreate(editingNode.id, pathIds)}
            onArchive={() => void archiveTask(editingNode)}
            onDelete={() => void removeTask(editingNode)}
          />
        ) : null}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0 }}>
          {wallContent.length ? (
            <CustomScrollArea
              axis="y"
              hostSx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
              scrollSx={{ flex: 1, minHeight: 0 }}
              contentSx={TASK_WALL_CONTENT_SX}
            >
              {wallContent}
            </CustomScrollArea>
          ) : (
            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1.5,
                color: 'var(--studio-text-tertiary)',
              }}
            >
              <Typography variant="body2">{wallEmptyMessage}</Typography>
            </Box>
          )}
        </Box>
      </Box>

      {/* 移动目标：只列可以当父级的节点，自己与自己的子树不在候选里。 */}
      <TaskTreeMoveDialog
        open={Boolean(moveTarget)}
        nodeLabel={taskLabel(moveTarget)}
        value={moveParentId}
        options={moveOptions}
        onChange={setMoveParentId}
        onClose={() => setMoveTarget(null)}
        onConfirm={() => void confirmMove()}
      />
    </SettingsSurface>
  )
}
