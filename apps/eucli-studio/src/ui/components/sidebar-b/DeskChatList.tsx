import * as React from 'react'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined'
import PersonOutlinedIcon from '@mui/icons-material/PersonOutlined'
import { colorMixVar } from '../../colorThemeStyles'
import type { DeskEntry, DeskTargetKind } from '../../../domain/desks'
import type { DeskDraft } from '../../../domain/deskDrafts'
import { sessionSourceLabel } from '../../../domain/sessionSourceLabel'
import type { DeskNoticeDotKind } from '../../deskNotice'
import { SortableItem, SortableRoot, SortableSection } from '../SortableDnd'
import { useSortableClickGuard } from '../useSortableClickGuard'

// 工作桌面的会话列表：行高、圆角、图标槽、间距与悬停底色沿用侧边栏同一套节奏，
// 行尾放一个叉，点它只把这条会话从桌面上摘掉，不动会话本体。
// 叉的左边是通知点：等待确认（黄）/ 异常中断（红）/ 已完成未读（绿），点它就清掉这条提醒。
// 整行可拖：拖完按前后关系交回桌面顺序动作，顺序真正落盘。
// 图标槽统一成圆角方块，角色 / 群 / 工作区三者同尺寸，有自定义图就显示图，没有就显示线性图标。
const ROW_HEIGHT = 40
const ICON_SIZE = 27
// 圆角矩形而不是胶囊：40 高的行配 8 点圆角，四角是方的、只是打磨过。
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

type DeskRowDragArgs = {
  setNodeRef: (node: HTMLElement | null) => void
  handleProps: Record<string, any>
  isDragging: boolean
  style: React.CSSProperties
}

// 通知点本身可点：绿 / 红是未读，点了标记已读；黄是有人要你确认，点了直接进会话。
// 点击不冒泡给整行，避免「清提醒」被当成「打开会话」。
// 说明文字走原生 title：整行已经挂了 MUI Tooltip，这里再套一个会在悬停时双层弹窗。
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

function DeskRow(props: {
  entry: DeskEntry
  active: boolean
  running: boolean
  noticeDot: DeskNoticeDotKind | ''
  hoverShowsRoleIcon: boolean
  dragArgs: DeskRowDragArgs
  shouldIgnoreClick: () => boolean
  onOpen: (entry: DeskEntry) => void
  onRemove: (entry: DeskEntry) => void
  onDismissNotice: (entry: DeskEntry) => void
  onContextMenu: (event: React.MouseEvent, entry: DeskEntry) => void
}) {
  const {
    entry,
    active,
    running,
    noticeDot,
    hoverShowsRoleIcon,
    dragArgs,
    shouldIgnoreClick,
    onOpen,
    onRemove,
    onDismissNotice,
    onContextMenu,
  } = props
  const dragging = dragArgs.isDragging
  const [hovered, setHovered] = React.useState(false)

  // 悬停说明与第二行的来源字样同源：工作区会话写作「工作区名/角色名」，角色会话只有角色名。
  const sourceLabel = sessionSourceLabel(entry)

  // 悬停换图标只作用于工作区来源；角色没设头像时自然落回角色默认图标。
  const swapToRole = hoverShowsRoleIcon && entry.targetKind === 'workspace' && hovered
  const iconKind: DeskTargetKind = swapToRole ? 'role' : entry.targetKind
  const iconImage = swapToRole ? entry.roleAvatarImage : entry.avatarImage

  return (
    <Tooltip title={sourceLabel} placement="left">
      <Box
        ref={dragArgs.setNodeRef as any}
        style={dragArgs.style}
        role="button"
        tabIndex={0}
        aria-label={entry.title}
        aria-current={active ? 'true' : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onContextMenu={(event) => onContextMenu(event, entry)}
        onClick={() => {
          if (shouldIgnoreClick()) return
          onOpen(entry)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onOpen(entry)
        }}
        {...dragArgs.handleProps}
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
          cursor: dragging ? 'grabbing' : 'grab',
          touchAction: 'none',
          opacity: dragging ? 0.72 : 1,
          zIndex: dragging ? 2 : undefined,
          bgcolor: active ? colorMixVar('--studio-primary', 10) : 'transparent',
          '&:hover': { bgcolor: colorMixVar('--studio-primary', active ? 14 : 6) },
          '&:focus-visible': { boxShadow: '0 10px 24px rgba(15,23,42,.14)' },
        }}
      >
        <DeskEntryIcon kind={iconKind} image={iconImage} active={active} />

        {/* 名称在上，来源与运行标记并排在下一行：来源常驻（工作区名/角色名，角色只有角色名），
            跑起来时在它右边接上 running。两行压在 40 点行高内；来源过长时让位给运行标记。 */}
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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
            {sourceLabel ? (
              <Typography
                noWrap
                sx={{
                  flex: '0 1 auto',
                  minWidth: 0,
                  fontSize: 10,
                  lineHeight: '12px',
                  fontWeight: 600,
                  color: active ? 'text.secondary' : 'text.disabled',
                }}
              >
                {sourceLabel}
              </Typography>
            ) : null}
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
                <Typography
                  noWrap
                  sx={{ fontSize: 9, lineHeight: '11px', fontWeight: 800, letterSpacing: '.2px', color: 'primary.main' }}
                >
                  running...
                </Typography>
              </Box>
            ) : null}
          </Box>
        </Box>

        {noticeDot ? (
          <DeskNoticeDot
            kind={noticeDot}
            onActivate={() => {
              if (noticeDot === 'waiting_confirmation') onOpen(entry)
              else onDismissNotice(entry)
            }}
          />
        ) : null}

        <IconButton
          size="small"
          aria-label={`从工作桌面移除 ${entry.title}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onRemove(entry)
          }}
          sx={{ color: 'text.disabled', '&:hover': { bgcolor: 'transparent', color: 'text.primary' } }}
        >
          <CloseRoundedIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
    </Tooltip>
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
  entries: DeskEntry[]
  drafts: DeskDraft[]
  activeChatId: string
  runningChatIds: ReadonlySet<string>
  /** 每条桌面条目的通知点，键是桌面引用键（DeskEntry.key）。 */
  noticeDotByKey: Readonly<Record<string, DeskNoticeDotKind>>
  hoverShowsRoleIcon: boolean
  onOpen: (entry: DeskEntry) => void
  onRemove: (entry: DeskEntry) => void
  onDismissNotice: (entry: DeskEntry) => void
  onMove: (activeKey: string, overKey: string) => void
  onContextMenu: (event: React.MouseEvent, entry: DeskEntry) => void
  onRemoveDraft: (draft: DeskDraft) => void
}) {
  const {
    entries,
    drafts,
    activeChatId,
    runningChatIds,
    noticeDotByKey,
    hoverShowsRoleIcon,
    onOpen,
    onRemove,
    onDismissNotice,
    onMove,
    onContextMenu,
    onRemoveDraft,
  } = props
  const clickGuard = useSortableClickGuard()
  const keys = React.useMemo(() => entries.map((it) => it.key), [entries])
  const activeId = String(activeChatId || '').trim()

  if (!entries.length && !drafts.length) {
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
      {entries.length ? (
      <SortableRoot onMove={onMove} onDragStart={clickGuard.onDragStart} onDragStop={clickGuard.onDragStop}>
        <SortableSection items={keys}>
          {entries.map((entry) => (
            <SortableItem key={entry.key} id={entry.key}>
              {(dragArgs) => (
                <DeskRow
                  entry={entry}
                  active={!!activeId && entry.chatId === activeId}
                  running={runningChatIds.has(entry.chatId)}
                  noticeDot={noticeDotByKey[entry.key] || ''}
                  hoverShowsRoleIcon={hoverShowsRoleIcon}
                  dragArgs={dragArgs}
                  shouldIgnoreClick={clickGuard.shouldIgnoreClick}
                  onOpen={onOpen}
                  onRemove={onRemove}
                  onDismissNotice={onDismissNotice}
                  onContextMenu={onContextMenu}
                />
              )}
            </SortableItem>
          ))}
        </SortableSection>
      </SortableRoot>
      ) : null}
    </Box>
  )
}
