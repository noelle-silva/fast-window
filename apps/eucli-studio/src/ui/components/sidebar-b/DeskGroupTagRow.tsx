import * as React from 'react'
import { Box, Typography } from '@mui/material'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import { DESK_GROUP_DEFAULT_COLOR, type DeskGroupTag } from '../../../domain/deskGroupTags'
import type { SortableItemRenderArgs } from '../SortableDnd'

/** 分组标签的行高：约为会话行的 3/5，比会话标签矮一档，一眼能看出它是分组。 */
const ROW_HEIGHT = 29
const ROW_RADIUS = 1

// 工作桌面的分组标签。
//
// 它在列表里就是一个标签：行高、圆角、悬停反馈跟会话标签同一套，
// 拖拽也走同一套排序规则，没有任何特殊待遇。区别只有内容——它代表一个分组。
//
// 外观沿用之前的组头：组色底 + 折叠箭头 + 名字。
// 本轮不做展开收起，箭头只是组的标识，点击不切换；数量本轮不显示。

/** 组色与纸面混合：深浅主题各自成立，不写死亮度。 */
export function deskGroupTint(color: string, percent = 22): string {
  const base = String(color || '').trim() || DESK_GROUP_DEFAULT_COLOR
  return `color-mix(in srgb, ${base} ${percent}%, var(--studio-paper))`
}

export type DeskGroupTagRowProps = {
  group: DeskGroupTag
  sortable: SortableItemRenderArgs
  onContextMenu: (event: React.MouseEvent, group: DeskGroupTag) => void
}

export function DeskGroupTagRow(props: DeskGroupTagRowProps) {
  const { group, sortable, onContextMenu } = props
  const dragging = sortable.isDragging

  return (
    <Box
      ref={sortable.setNodeRef as any}
      style={sortable.style}
      {...sortable.handleProps}
      role="button"
      tabIndex={0}
      aria-label={group.name}
      onClick={() => {
        if (sortable.shouldSuppressClick()) return
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu(event, group)
      }}
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
        bgcolor: deskGroupTint(group.color),
        '&:hover': { filter: 'brightness(0.985)' },
        '&:focus-visible': { boxShadow: '0 10px 24px rgba(15,23,42,.14)' },
      }}
    >
      <ChevronRightRoundedIcon
        sx={{
          fontSize: 16,
          flex: '0 0 auto',
          color: 'text.secondary',
          transform: 'rotate(90deg)',
          transition: 'transform 120ms ease',
        }}
      />
      <Typography
        noWrap
        sx={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: '16px', fontWeight: 900, color: 'text.primary' }}
      >
        {group.name}
      </Typography>
    </Box>
  )
}
