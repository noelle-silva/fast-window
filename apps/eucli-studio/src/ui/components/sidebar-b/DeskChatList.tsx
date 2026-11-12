import * as React from 'react'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined'
import PersonOutlinedIcon from '@mui/icons-material/PersonOutlined'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { colorMixVar } from '../../colorThemeStyles'
import {
  DESK_GROUP_DEFAULT_COLOR,
  deskChatRowId,
  parseDeskRowId,
  type DeskEntry,
  type DeskGroup,
  type DeskRow,
  type DeskTargetKind,
  type SessionDesks,
} from '../../../domain/desks'
import type { DeskDraft } from '../../../domain/deskDrafts'
import { formatContextTokens } from '../../../domain/messageMetaLine'
import { sessionSourceLabel } from '../../../domain/sessionSourceLabel'
import type { DeskNoticeDotKind } from '../../deskNotice'
import { useSortableClickGuard } from '../useSortableClickGuard'

// 工作桌面的会话列表。
//
// 行高、圆角、图标槽、间距与悬停底色沿用侧边栏同一套节奏。
// 一条可见行要么是会话，要么是分组；展开的分组下面挂着自己的成员。
//
// 拖拽走 dnd-kit 原生能力，规则只有一条：
//   手上的东西在浮层里，永远跟指针；数据只在松手时改一次。
//   —— 拖动中改数据会让 React 把那一行卸载重建，dnd-kit 的锚点一没就 cancel 整场拖拽。
//
// 谁跟谁换位由「指针此刻压在哪一层」决定：
//   压在分组标签头上 = 跟整块换；压在成员区 = 在该组内部换。
const ROW_HEIGHT = 48
const ICON_SIZE = 27
const ROW_RADIUS = 1
const ICON_RADIUS = 1

const NOTICE_DOT: Record<DeskNoticeDotKind, { color: string; palette: 'success' | 'warning' | 'error'; label: string }> = {
  waiting_confirmation: { color: 'warning.main', palette: 'warning', label: '有工具请求等待确认，点一下去处理' },
  error: { color: 'error.main', palette: 'error', label: '会话异常中断，点一下标记已读' },
  completed: { color: 'success.main', palette: 'success', label: '会话已完成，点一下标记已读' },
}

const LIST_SX = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  scrollbarWidth: 'none',
  msOverflowStyle: 'none',
  '&::-webkit-scrollbar': { width: 0, height: 0 },
  px: 0.5,
  py: 0.75,
  display: 'flex',
  flexDirection: 'column',
  gap: 0.25,
}

const TARGET_ICON: Record<DeskTargetKind, React.ElementType> = {
  role: PersonOutlinedIcon,
  group: GroupsOutlinedIcon,
  workspace: FolderOutlinedIcon,
}

/** 组色与纸面混合：深浅主题各自成立，不写死亮度。 */
export function deskGroupTint(color: string, percent = 22): string {
  const base = String(color || '').trim() || DESK_GROUP_DEFAULT_COLOR
  return `color-mix(in srgb, ${base} ${percent}%, var(--studio-paper))`
}

function DeskEntryIcon(props: { kind: DeskTargetKind; image: string; active: boolean }) {
  const hasImage = !!String(props.image || '')
  const Icon = TARGET_ICON[props.kind]
  return (
    <Box
      sx={{
        width: ICON_SIZE,
        height: ICON_SIZE,
        flex: '0 0 auto',
        borderRadius: ICON_RADIUS,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: hasImage ? 'transparent' : colorMixVar('--studio-primary', props.active ? 18 : 12),
        color: 'primary.main',
      }}
    >
      {hasImage ? (
        <Box
          component="img"
          src={props.image}
          alt=""
          sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <Icon sx={{ fontSize: Math.round(ICON_SIZE * 0.62) }} />
      )}
    </Box>
  )
}

// 通知点本身可点：绿 / 红是未读，点了标记已读；黄是有人要你确认，点了直接进会话。
// 点击不冒泡给整行，避免「清提醒」被当成「打开会话」。
function DeskNoticeDot(props: { kind: DeskNoticeDotKind; onActivate: () => void }) {
  const meta = NOTICE_DOT[props.kind]
  return (
    <IconButton
      size="small"
      title={meta.label}
      aria-label={meta.label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        props.onActivate()
      }}
      sx={{ p: 0.5, minWidth: 0, color: 'inherit', '&:hover': { bgcolor: 'transparent' } }}
    >
      <Box
        component="span"
        sx={{
          display: 'block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          bgcolor: meta.color,
          boxShadow: (theme) => `0 0 0 3px ${theme.palette[meta.palette].main}1f`,
        }}
      />
    </IconButton>
  )
}

/** 会话行的内容。可拖行和浮层里的那一份共用它，保证两边长得一模一样。 */
function DeskChatBody(props: {
  entry: DeskEntry
  active: boolean
  running: boolean
  noticeDot: DeskNoticeDotKind | ''
  hoverShowsRoleIcon: boolean
  onDismissNotice: () => void
  onOpen: () => void
  onRemove: () => void
  compact?: boolean
}) {
  const { entry, active, running, noticeDot, hoverShowsRoleIcon } = props
  const [hovered, setHovered] = React.useState(false)

  const sourceLabel = sessionSourceLabel(entry)
  const contextUsageText = formatContextTokens(entry.contextTokens)

  // 悬停换图标只作用于工作区来源；角色没设头像时自然落回角色默认图标。
  const swapToRole = hoverShowsRoleIcon && entry.targetKind === 'workspace' && hovered
  const iconKind: DeskTargetKind = swapToRole ? 'role' : entry.targetKind
  const iconImage = swapToRole ? entry.roleAvatarImage : entry.avatarImage

  return (
    <Box
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0 }}
    >
      <DeskEntryIcon kind={iconKind} image={iconImage} active={active} />

      {/* 三行叠放：名称 / 来源 / 上下文用量。来源常驻；第三行是已使用的上下文规模，
          跑起来时在它右边接上 running。 */}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1px' }}>
        <Typography
          noWrap
          sx={{
            fontSize: 12,
            lineHeight: '14px',
            fontWeight: active ? 900 : 600,
            color: active ? 'text.primary' : 'text.secondary',
          }}
        >
          {entry.title}
        </Typography>
        {sourceLabel ? (
          <Typography
            noWrap
            sx={{
              fontSize: 10,
              lineHeight: '12px',
              fontWeight: 600,
              color: active ? 'text.secondary' : 'text.disabled',
            }}
          >
            {sourceLabel}
          </Typography>
        ) : null}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, overflow: 'hidden' }}>
          <Typography
            noWrap
            sx={{
              flex: '0 1 auto',
              minWidth: 0,
              fontSize: 10,
              lineHeight: '12px',
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              color: active ? 'text.secondary' : 'text.disabled',
            }}
          >
            {contextUsageText}
          </Typography>
          {running ? (
            <Box
              sx={{
                flex: '0 0 auto',
                height: 11,
                px: '4px',
                borderRadius: '3px',
                bgcolor: colorMixVar('--studio-primary', 14),
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Typography noWrap sx={{ fontSize: 9, lineHeight: '11px', fontWeight: 800, letterSpacing: '.2px', color: 'primary.main' }}>
                running...
              </Typography>
            </Box>
          ) : null}
        </Box>
      </Box>

      {/* 通知点：黄色是有人要你确认，点它直接进会话；绿 / 红是未读，点它清掉提醒。 */}
      {noticeDot ? (
        <DeskNoticeDot
          kind={noticeDot}
          onActivate={() => {
            if (noticeDot === 'waiting_confirmation') props.onOpen()
            else props.onDismissNotice()
          }}
        />
      ) : null}

      {props.compact ? null : (
        <IconButton
          size="small"
          aria-label={`从工作桌面移除 ${entry.title}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            props.onRemove()
          }}
          sx={{ color: 'text.disabled', '&:hover': { bgcolor: 'transparent', color: 'text.primary' } }}
        >
          <CloseRoundedIcon sx={{ fontSize: 16 }} />
        </IconButton>
      )}
    </Box>
  )
}

type ChatRowProps = {
  rowId: string
  entry: DeskEntry
  containerId: string
  active: boolean
  running: boolean
  noticeDot: DeskNoticeDotKind | ''
  hoverShowsRoleIcon: boolean
  shouldIgnoreClick: () => boolean
  onOpen: () => void
  onRemove: () => void
  onDismissNotice: () => void
  onContextMenu: (event: React.MouseEvent) => void
}

/** 一条可拖的会话行。 */
function SortableChatRow(props: ChatRowProps) {
  const { rowId, entry, containerId, active } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rowId,
    data: { container: containerId },
  })

  // 只留位移，不带缩放：拖拽只该有位移，尺寸由行自己的样式决定。
  const style = { transform: CSS.Translate.toString(transform), transition }

  return (
    <Tooltip title={sessionSourceLabel(entry)} placement="left">
      <Box
        ref={setNodeRef}
        data-desk-row={rowId}
        style={style}
        aria-label={entry.title}
        aria-current={active ? 'true' : undefined}
        onContextMenu={props.onContextMenu}
        onClick={() => {
          if (props.shouldIgnoreClick()) return
          props.onOpen()
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          props.onOpen()
        }}
        {...attributes}
        {...listeners}
        sx={{
          position: 'relative',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 0.75,
          py: 0.5,
          minHeight: ROW_HEIGHT,
          boxSizing: 'border-box',
          borderRadius: ROW_RADIUS,
          userSelect: 'none',
          outline: 'none',
          cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'none',
          // 手上那份在浮层里，这一行整条隐去：列表里不占任何视觉位置。
          opacity: isDragging ? 0 : 1,
          bgcolor: active ? colorMixVar('--studio-primary', 10) : 'transparent',
          '&:hover': { bgcolor: colorMixVar('--studio-primary', active ? 14 : 6) },
          '&:focus-visible': { boxShadow: '0 10px 24px rgba(15,23,42,.14)' },
        }}
      >
        <DeskChatBody
          entry={entry}
          active={active}
          running={props.running}
          noticeDot={props.noticeDot}
          hoverShowsRoleIcon={props.hoverShowsRoleIcon}
          onDismissNotice={props.onDismissNotice}
          onOpen={props.onOpen}
          onRemove={props.onRemove}
        />
      </Box>
    </Tooltip>
  )
}

/**
 * 展开分组的成员区：向左让出 4px 给竖色条，其余宽度与组标签一致。
 *
 * 空组也要有高度，否则成员区是一片零高的空气，指针压不上去，
 * 会话就永远进不了这个组。这里给它一行的高度，既是落点也是提示。
 */
function DeskGroupChildren(props: {
  group: DeskGroup
  empty?: boolean
  setBodyRef?: (node: HTMLElement | null) => void
  children?: React.ReactNode
}) {
  const color = String(props.group.color || '').trim() || DESK_GROUP_DEFAULT_COLOR
  return (
    <Box
      ref={props.setBodyRef}
      sx={{
        position: 'relative',
        pl: '4px',
        pt: props.empty ? 0 : '2px',
        pb: props.empty ? 0 : '2px',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.25,
        minHeight: props.empty ? ROW_HEIGHT : undefined,
        // 竖条落在 0～2px，条目从 4px 起：线和条目之间留 2px 呼吸。
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: props.empty ? 'auto' : '9px',
          height: props.empty ? '100%' : undefined,
          width: '2px',
          borderRadius: '2px',
          bgcolor: color,
          opacity: 0.55,
          zIndex: 2,
          pointerEvents: 'none',
        },
      }}
    >
      {props.empty ? (
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            px: 0.75,
            fontSize: 11,
            color: 'text.disabled',
            userSelect: 'none',
          }}
        >
          拖会话到这里
        </Box>
      ) : (
        props.children
      )}
    </Box>
  )
}

type GroupRowProps = {
  rowId: string
  group: DeskGroup
  chats: Array<{ rowId: string; entry: DeskEntry }>
  activeChatId: string
  runningChatIds: ReadonlySet<string>
  noticeDotByKey: Readonly<Record<string, DeskNoticeDotKind>>
  hoverShowsRoleIcon: boolean
  shouldIgnoreClick: () => boolean
  onToggleCollapsed: (groupId: string) => void
  onContextMenu: (event: React.MouseEvent) => void
  onGroupContextMenu: (event: React.MouseEvent, group: DeskGroup) => void
  onOpen: (entry: DeskEntry) => void
  onRemove: (entry: DeskEntry) => void
  onDismissNotice: (entry: DeskEntry) => void
  onEntryContextMenu: (event: React.MouseEvent, entry: DeskEntry) => void
}

/** 一个可拖的分组：展开时整块一起走，收起时就是一行。 */
function SortableGroupRow(props: GroupRowProps) {
  const { rowId, group, chats } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rowId,
    data: { container: 'root' },
  })
  // 标签头单独挂一个落点：指针停在这里，就按「整个块让位」处理。
  const { setNodeRef: setHeaderRef } = useDroppable({
    id: `desk-group-header:${group.id}`,
    disabled: group.collapsed,
    data: { role: 'desk-group-header', groupId: group.id },
  })
  // 成员区本身也是落点。空组没有成员可压，指针只能落在这片区域上 ——
  // 没有它，会话永远进不了空组。
  const { setNodeRef: setBodyRef } = useDroppable({
    id: `desk-group-body:${group.id}`,
    disabled: group.collapsed,
    data: { role: 'desk-group-body', groupId: group.id },
  })

  const style = { transform: CSS.Translate.toString(transform), transition }
  const color = String(group.color || '').trim() || DESK_GROUP_DEFAULT_COLOR

  return (
    <Box
      ref={setNodeRef}
      data-desk-group={rowId}
      style={style}
      sx={{ display: 'flex', flexDirection: 'column', opacity: isDragging ? 0 : 1 }}
    >
      <Box
        ref={setHeaderRef}
        data-desk-group-header={rowId}
        aria-label={group.name}
        aria-expanded={!group.collapsed}
        onClick={() => {
          if (isDragging) return
          props.onToggleCollapsed(group.id)
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          props.onGroupContextMenu(event, group)
        }}
        {...attributes}
        {...listeners}
        sx={{
          position: 'relative',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 0.75,
          py: 0.5,
          minHeight: 29,
          boxSizing: 'border-box',
          borderRadius: ROW_RADIUS,
          userSelect: 'none',
          outline: 'none',
          cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'none',
          bgcolor: deskGroupTint(color),
          '&:hover': { filter: 'brightness(0.985)' },
          '&:focus-visible': { boxShadow: '0 10px 24px rgba(15,23,42,.14)' },
        }}
      >
        <ChevronRightRoundedIcon
          sx={{
            fontSize: 16,
            flex: '0 0 auto',
            color: 'text.secondary',
            transform: group.collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
            transition: 'transform 120ms ease',
          }}
        />
        <Typography
          noWrap
          sx={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: '16px', fontWeight: 900, color: 'text.primary' }}
        >
          {group.name}
        </Typography>
        {chats.length ? (
          <Box
            component="span"
            sx={{
              flex: '0 0 auto',
              fontSize: 10,
              lineHeight: '14px',
              fontWeight: 800,
              color: colorMixVar('--studio-primary', 0),
              bgcolor: `color-mix(in srgb, var(--studio-paper) 78%, ${color} 22%)`,
              px: '5px',
              borderRadius: '5px',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {chats.length}
          </Box>
        ) : null}
      </Box>

      {group.collapsed ? null : (
        <SortableContext items={chats.map((chat) => chat.rowId)} strategy={verticalListSortingStrategy}>
          <DeskGroupChildren group={group} empty={!chats.length} setBodyRef={setBodyRef}>
            {chats.map((chat) => (
              <SortableChatRow
                key={chat.rowId}
                rowId={chat.rowId}
                entry={chat.entry}
                containerId={`grp:${group.id}`}
                active={!!props.activeChatId && chat.entry.chatId === props.activeChatId}
                running={props.runningChatIds.has(chat.entry.chatId)}
                noticeDot={props.noticeDotByKey[chat.entry.key] || ''}
                hoverShowsRoleIcon={props.hoverShowsRoleIcon}
                shouldIgnoreClick={props.shouldIgnoreClick}
                onOpen={() => props.onOpen(chat.entry)}
                onRemove={() => props.onRemove(chat.entry)}
                onDismissNotice={() => props.onDismissNotice(chat.entry)}
                onContextMenu={(event) => props.onEntryContextMenu(event, chat.entry)}
              />
            ))}
          </DeskGroupChildren>
        </SortableContext>
      )}
    </Box>
  )
}

// 临时条目（Ctrl 新建、还没发送的会话）：淡一档，不参与拖拽，也不进后端数据。
function DeskDraftRow(props: { draft: DeskDraft; onRemove: (draft: DeskDraft) => void }) {
  const { draft, onRemove } = props
  return (
    <Tooltip title="尚未发送，发送后转为正式条目" placement="left">
      <Box
        role="button"
        tabIndex={0}
        aria-label={draft.title}
        data-desk-draft="1"
        sx={{
          position: 'relative',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 0.75,
          minHeight: ROW_HEIGHT,
          py: 0.5,
          boxSizing: 'border-box',
          borderRadius: ROW_RADIUS,
          userSelect: 'none',
          outline: 'none',
          cursor: 'default',
          opacity: 0.55,
        }}
      >
        <DeskEntryIcon kind={draft.targetKind as DeskTargetKind} image="" active={false} />
        <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: '14px', fontWeight: 600, color: 'text.secondary' }}>
          {draft.title}
        </Typography>
        <IconButton
          size="small"
          aria-label={`从工作桌面移除 ${draft.title}`}
          onClick={() => onRemove(draft)}
          sx={{ color: 'text.disabled', '&:hover': { bgcolor: 'transparent', color: 'text.primary' } }}
        >
          <CloseRoundedIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
    </Tooltip>
  )
}

export function DeskChatList(props: {
  /** 顶层单元序列，含分组及其成员。 */
  rows: DeskRow[]
  /** 桌面数据本身，拖拽时用来判断某一层里都有谁。 */
  desks: SessionDesks | undefined
  drafts: DeskDraft[]
  activeChatId: string
  runningChatIds: ReadonlySet<string>
  noticeDotByKey: Readonly<Record<string, DeskNoticeDotKind>>
  hoverShowsRoleIcon: boolean
  onOpen: (entry: DeskEntry) => void
  onRemove: (entry: DeskEntry) => void
  onDismissNotice: (entry: DeskEntry) => void
  onContextMenu: (event: React.MouseEvent, entry: DeskEntry) => void
  onRemoveDraft: (draft: DeskDraft) => void
  /** 换位：顶层换位、进出分组、组内换序共用这一个出口。 */
  onMove: (activeUnitId: string, overUnitId: string) => void
  /** 放进某个分组末尾：空分组没有成员可压，需要这条单独的路径。 */
  onMoveToGroupEnd: (activeUnitId: string, groupId: string) => void
  onToggleCollapsed: (groupId: string) => void
  onGroupContextMenu: (event: React.MouseEvent, group: DeskGroup) => void
}) {
  const {
    rows,
    desks,
    drafts,
    activeChatId,
    runningChatIds,
    noticeDotByKey,
    hoverShowsRoleIcon,
    onOpen,
    onRemove,
    onDismissNotice,
    onContextMenu,
    onRemoveDraft,
    onMove,
    onMoveToGroupEnd,
    onToggleCollapsed,
    onGroupContextMenu,
  } = props

  const clickGuard = useSortableClickGuard()
  const [activeUnitId, setActiveUnitId] = React.useState<string | null>(null)
  const lastOverRef = React.useRef<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const rootUnitIds = React.useMemo(() => rows.map((row) => row.rowId), [rows])

  // 展开的组外壳、所有组成员，各建一份集合，落点筛选用。
  const layout = React.useMemo(() => {
    const expandedShells = new Set<string>()
    const memberIds = new Set<string>()
    for (const row of rows) {
      if (row.kind !== 'group') continue
      if (!row.group.collapsed) expandedShells.add(row.rowId)
      for (const chat of row.chats) memberIds.add(chat.rowId)
    }
    return { expandedShells, memberIds }
  }, [rows])

  /**
   * 落点判定：指针压在哪一行，就落哪一行。
   *
   * 不比较「中心距离」—— 展开组很高，中心在中间，指针压在它底部边缘时会输给旁边的小会话。
   *
   * 1. 先看指针被哪些行包住；同时包住时取面积最小的（最具体的那一层）
   * 2. 落在行与行的缝里，取边缘最近的那个
   * 3. 兜底交给原生
   */
  const collisionDetection = React.useCallback<CollisionDetection>(
    (args) => {
      const { active, droppableContainers, droppableRects, pointerCoordinates } = args
      const activeId = String(active.id)
      const activeKind = parseDeskRowId(activeId)?.kind

      const candidates = droppableContainers.filter((container) => {
        const id = String(container.id)
        // 被拖的那一个必须划掉：它的矩形跟着指针走，跟自己永远零距离。
        if (id === activeId) return false
        if (activeKind === 'group') return !layout.memberIds.has(id)
        if (layout.expandedShells.has(id)) return false
        return true
      })

      const hitOf = (container: (typeof candidates)[number]) => [
        { id: container.id, data: { droppableContainer: container, value: 1 } },
      ]
      if (!pointerCoordinates) return closestCenter({ ...args, droppableContainers: candidates })

      let inside: (typeof candidates)[number] | null = null
      let insideArea = Infinity
      for (const container of candidates) {
        const rect = droppableRects.get(container.id)
        if (!rect) continue
        if (pointerCoordinates.x < rect.left || pointerCoordinates.x > rect.right) continue
        if (pointerCoordinates.y < rect.top || pointerCoordinates.y > rect.bottom) continue
        const area = rect.width * rect.height
        if (area < insideArea) {
          insideArea = area
          inside = container
        }
      }
      if (inside) return hitOf(inside)

      let nearest: (typeof candidates)[number] | null = null
      let nearestDistance = Infinity
      for (const container of candidates) {
        const rect = droppableRects.get(container.id)
        if (!rect) continue
        const dx =
          pointerCoordinates.x < rect.left
            ? rect.left - pointerCoordinates.x
            : pointerCoordinates.x > rect.right
              ? pointerCoordinates.x - rect.right
              : 0
        const dy =
          pointerCoordinates.y < rect.top
            ? rect.top - pointerCoordinates.y
            : pointerCoordinates.y > rect.bottom
              ? pointerCoordinates.y - rect.bottom
              : 0
        const distance = dx * dx + dy * dy
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearest = container
        }
      }
      if (nearest) return hitOf(nearest)

      return closestCenter({ ...args, droppableContainers: candidates })
    },
    [layout],
  )

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    lastOverRef.current = null
    setActiveUnitId(String(event.active.id))
  }, [])

  /** 拖动中只记落点，一个字节都不写。 */
  const handleDragOver = React.useCallback((event: DragOverEvent) => {
    const { active, over } = event
    if (!over) return
    const overId = String(over.id)
    if (!overId || overId === String(active.id)) return
    lastOverRef.current = overId
  }, [])

  /** 松手：唯一一次改顺序。 */
  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      const activeId = String(active.id)
      const overId = over ? String(over.id) : lastOverRef.current
      lastOverRef.current = null
      setActiveUnitId(null)
      if (!overId || overId === activeId) return

      // 成员区落点：把这个会话放进该组末尾。空组只有这一条路能进去。
      const bodyGroupId = parseDeskGroupBodyId(overId)
      if (bodyGroupId) {
        onMoveToGroupEnd(activeId, bodyGroupId)
        return
      }

      // 标签头落点翻译成它所属的组：这样就是「整块往下让」。
      const header = parseDeskGroupHeaderId(overId)
      const target = header ? `desk-group:${header}` : overId
      if (target === activeId) return
      onMove(activeId, target)
    },
    [onMove, onMoveToGroupEnd],
  )

  const overlay = React.useMemo(() => {
    if (!activeUnitId) return null
    for (const row of rows) {
      if (row.kind === 'group') {
        if (row.rowId === activeUnitId) {
          return <GroupOverlay group={row.group} chats={row.chats} color={row.group.color} />
        }
        const chat = row.chats.find((item) => item.rowId === activeUnitId)
        if (chat) {
          return <ChatOverlay entry={chat.entry} running={runningChatIds.has(chat.entry.chatId)} />
        }
        continue
      }
      if (row.rowId === activeUnitId) {
        return <ChatOverlay entry={row.entry} running={runningChatIds.has(row.entry.chatId)} />
      }
    }
    return null
  }, [activeUnitId, rows, runningChatIds])

  if (!rows.length && !drafts.length) {
    return (
      <Box sx={LIST_SX}>
        <Typography sx={{ px: 0.75, py: 0.5, fontSize: 12, color: 'text.disabled' }}>桌面上还没有会话</Typography>
      </Box>
    )
  }

  return (
    <Box sx={LIST_SX}>
      {drafts.map((draft) => (
        <DeskDraftRow key={draft.pendingChatId} draft={draft} onRemove={onRemoveDraft} />
      ))}

      {rows.length ? (
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            lastOverRef.current = null
            setActiveUnitId(null)
          }}
        >
          <SortableContext items={rootUnitIds} strategy={verticalListSortingStrategy}>
            {rows.map((row) =>
              row.kind === 'group' ? (
                <SortableGroupRow
                  key={row.rowId}
                  rowId={row.rowId}
                  group={row.group}
                  chats={row.chats}
                  activeChatId={activeChatId}
                  runningChatIds={runningChatIds}
                  noticeDotByKey={noticeDotByKey}
                  hoverShowsRoleIcon={hoverShowsRoleIcon}
                  shouldIgnoreClick={clickGuard.shouldIgnoreClick}
                  onToggleCollapsed={onToggleCollapsed}
                  onContextMenu={() => {}}
                  onGroupContextMenu={onGroupContextMenu}
                  onOpen={onOpen}
                  onRemove={onRemove}
                  onDismissNotice={onDismissNotice}
                  onEntryContextMenu={onContextMenu}
                />
              ) : (
                <SortableChatRow
                  key={row.rowId}
                  rowId={row.rowId}
                  entry={row.entry}
                  containerId="root"
                  active={!!activeChatId && row.entry.chatId === activeChatId}
                  running={runningChatIds.has(row.entry.chatId)}
                  noticeDot={noticeDotByKey[row.entry.key] || ''}
                  hoverShowsRoleIcon={hoverShowsRoleIcon}
                  shouldIgnoreClick={clickGuard.shouldIgnoreClick}
                  onOpen={() => onOpen(row.entry)}
                  onRemove={() => onRemove(row.entry)}
                  onDismissNotice={() => onDismissNotice(row.entry)}
                  onContextMenu={(event) => onContextMenu(event, row.entry)}
                />
              ),
            )}
          </SortableContext>

          {/* 浮层挂在列表外面：列表会裁掉超出的内容，挂在里面手上的那份就看不见了。 */}
          <DragOverlay dropAnimation={null}>{overlay}</DragOverlay>
        </DndContext>
      ) : null}
    </Box>
  )
}

/** 浮层里的会话行：跟列表里那一行长得一模一样，只是不能点、不能拖。 */
function ChatOverlay(props: { entry: DeskEntry; running: boolean }) {
  return (
    <Box
      sx={{
        width: '100%',
        bgcolor: 'var(--studio-paper)',
        borderRadius: ROW_RADIUS,
        boxShadow: '0 18px 34px -14px rgba(15,23,42,.34), 0 4px 10px rgba(15,23,42,.1)',
        px: 0.75,
        py: 0.5,
        minHeight: ROW_HEIGHT,
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <DeskChatBody
        entry={props.entry}
        active={false}
        running={props.running}
        noticeDot={''}
        hoverShowsRoleIcon={false}
        onDismissNotice={() => {}}
        onOpen={() => {}}
        onRemove={() => {}}
        compact
      />
    </Box>
  )
}

/** 浮层里的分组：整块照原样摆出来，只是不能点、不能拖。 */
function GroupOverlay(props: { group: DeskGroup; chats: Array<{ rowId: string; entry: DeskEntry }>; color: string }) {
  const color = String(props.color || '').trim() || DESK_GROUP_DEFAULT_COLOR
  return (
    <Box
      sx={{
        width: '100%',
        bgcolor: 'var(--studio-paper)',
        borderRadius: ROW_RADIUS,
        boxShadow: '0 18px 34px -14px rgba(15,23,42,.34), 0 4px 10px rgba(15,23,42,.1)',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 0.75,
          py: 0.5,
          minHeight: 29,
          borderRadius: ROW_RADIUS,
          bgcolor: deskGroupTint(color),
        }}
      >
        <ChevronRightRoundedIcon
          sx={{
            fontSize: 16,
            flex: '0 0 auto',
            color: 'text.secondary',
            transform: props.group.collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
          }}
        />
        <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: '16px', fontWeight: 900 }}>
          {props.group.name}
        </Typography>
        {props.chats.length ? (
          <Box
            component="span"
            sx={{
              fontSize: 10,
              lineHeight: '14px',
              fontWeight: 800,
              bgcolor: `color-mix(in srgb, var(--studio-paper) 78%, ${color} 22%)`,
              px: '5px',
              borderRadius: '5px',
            }}
          >
            {props.chats.length}
          </Box>
        ) : null}
      </Box>

      {props.group.collapsed ? null : (
        <DeskGroupChildren group={props.group}>
          {props.chats.map((chat) => (
            <Box
              key={chat.rowId}
              sx={{ display: 'flex', alignItems: 'center', px: 0.75, py: 0.5, minHeight: ROW_HEIGHT }}
            >
              <DeskChatBody
                entry={chat.entry}
                active={false}
                running={false}
                noticeDot={''}
                hoverShowsRoleIcon={false}
                onDismissNotice={() => {}}
                onOpen={() => {}}
                onRemove={() => {}}
                compact
              />
            </Box>
          ))}
        </DeskGroupChildren>
      )}
    </Box>
  )
}

/** 分组标签头的落点 id，拖拽结束时翻译回它所属的组。 */
function parseDeskGroupHeaderId(value: string): string {
  const prefix = 'desk-group-header:'
  return String(value || '').startsWith(prefix) ? String(value).slice(prefix.length) : ''
}

/** 分组员区的落点 id，拖拽结束时翻译回它所属的组。 */
function parseDeskGroupBodyId(value: string): string {
  const prefix = 'desk-group-body:'
  return String(value || '').startsWith(prefix) ? String(value).slice(prefix.length) : ''
}

export { deskChatRowId }
