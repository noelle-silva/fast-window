import * as React from 'react'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined'
import PersonOutlinedIcon from '@mui/icons-material/PersonOutlined'
import { colorMixVar } from '../../colorThemeStyles'
import type { DeskEntry, DeskTargetKind } from '../../../domain/desk'
import { SortableItem, SortableRoot, SortableSection } from '../SortableDnd'
import { useSortableClickGuard } from '../useSortableClickGuard'

// 工作桌面的会话列表：行高、圆角、图标槽、间距与悬停底色沿用侧边栏同一套节奏，
// 行尾放一个叉，点它只把这条会话从桌面上摘掉，不动会话本体。
// 整行可拖：拖完按前后关系交回桌面顺序动作，顺序真正落盘。
// 图标槽统一成圆角方块，角色 / 群 / 工作区三者同尺寸，有自定义图就显示图，没有就显示线性图标。
const ROW_HEIGHT = 40
const ICON_SIZE = 27
// 圆角矩形而不是胶囊：40 高的行配 8 点圆角，四角是方的、只是打磨过。
const ROW_RADIUS = 1
const ICON_RADIUS = 1

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

function DeskRow(props: {
  entry: DeskEntry
  active: boolean
  dragArgs: DeskRowDragArgs
  shouldIgnoreClick: () => boolean
  onOpen: (entry: DeskEntry) => void
  onRemove: (entry: DeskEntry) => void
  onContextMenu: (event: React.MouseEvent, entry: DeskEntry) => void
}) {
  const { entry, active, dragArgs, shouldIgnoreClick, onOpen, onRemove, onContextMenu } = props
  const dragging = dragArgs.isDragging

  return (
    <Tooltip title={entry.targetName} placement="left">
      <Box
        ref={dragArgs.setNodeRef as any}
        style={dragArgs.style}
        role="button"
        tabIndex={0}
        aria-label={entry.title}
        aria-current={active ? 'true' : undefined}
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
        <DeskEntryIcon kind={entry.targetKind} image={entry.avatarImage} active={active} />

        <Typography
          noWrap
          sx={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            lineHeight: 1.2,
            fontWeight: active ? 900 : 600,
            color: active ? 'text.primary' : 'text.secondary',
          }}
        >
          {entry.title}
        </Typography>

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

export function DeskChatList(props: {
  entries: DeskEntry[]
  activeChatId: string
  onOpen: (entry: DeskEntry) => void
  onRemove: (entry: DeskEntry) => void
  onMove: (activeKey: string, overKey: string) => void
  onContextMenu: (event: React.MouseEvent, entry: DeskEntry) => void
}) {
  const { entries, activeChatId, onOpen, onRemove, onMove, onContextMenu } = props
  const clickGuard = useSortableClickGuard()
  const keys = React.useMemo(() => entries.map((it) => it.key), [entries])
  const activeId = String(activeChatId || '').trim()

  if (!entries.length) {
    return (
      <Box sx={LIST_SX}>
        <Typography sx={{ px: 0.75, py: 0.5, fontSize: 12, color: 'text.disabled' }}>桌面上还没有会话</Typography>
      </Box>
    )
  }

  return (
    <Box sx={LIST_SX}>
      <SortableRoot onMove={onMove} onDragStart={clickGuard.onDragStart} onDragStop={clickGuard.onDragStop}>
        <SortableSection items={keys}>
          {entries.map((entry) => (
            <SortableItem key={entry.key} id={entry.key}>
              {(dragArgs) => (
                <DeskRow
                  entry={entry}
                  active={!!activeId && entry.chatId === activeId}
                  dragArgs={dragArgs}
                  shouldIgnoreClick={clickGuard.shouldIgnoreClick}
                  onOpen={onOpen}
                  onRemove={onRemove}
                  onContextMenu={onContextMenu}
                />
              )}
            </SortableItem>
          ))}
        </SortableSection>
      </SortableRoot>
    </Box>
  )
}
