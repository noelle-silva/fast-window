import * as React from 'react'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined'
import DragIndicatorOutlinedIcon from '@mui/icons-material/DragIndicatorOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import { Box, Chip, IconButton, Tooltip, Typography } from '@mui/material'
import type { CollectionNode } from '../types'
import type { SortableItemRenderArgs } from './SortableDnd'

type FolderCardProps = {
  folder: CollectionNode
  commandCount: number
  sortable: SortableItemRenderArgs
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
}

export function FolderCard({ folder, commandCount, sortable, onOpen, onRename, onDelete }: FolderCardProps) {
  return (
    <Box
      ref={sortable.setNodeRef}
      style={sortable.style}
      className={`cr-folder-card${sortable.isDropTarget ? ' cr-folder-card-drop' : ''}${sortable.isDropCandidate ? ' cr-folder-card-candidate' : ''}`}
      sx={{ opacity: sortable.isDragging ? 0.82 : 1 }}
      role="button"
      tabIndex={0}
      onClick={() => {
        if (!sortable.shouldSuppressClick()) onOpen()
      }}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onOpen()
      }}
      {...sortable.dropActivatorProps}
    >
      <IconButton
        ref={sortable.setHandleRef}
        size="small"
        aria-label="拖拽收藏夹"
        onClick={event => event.stopPropagation()}
        sx={{ cursor: sortable.isDragging ? 'grabbing' : 'grab', color: 'rgba(0, 0, 0, 0.32)' }}
        {...sortable.handleProps}
      >
        <DragIndicatorOutlinedIcon fontSize="small" />
      </IconButton>
      <Box className="cr-folder-icon" aria-hidden="true">
        <FolderRoundedIcon sx={{ fontSize: 16 }} />
      </Box>
      <Typography noWrap sx={{ minWidth: 0, fontSize: 13, fontWeight: 900 }}>{folder.name || '未命名收藏夹'}</Typography>
      <Chip size="small" label={`${commandCount} 条命令`} sx={{ fontWeight: 700, fontSize: 11, height: 20, flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 8 }} />
      <Tooltip title="重命名收藏夹">
        <IconButton
          size="small"
          aria-label="重命名收藏夹"
          onClick={event => {
            event.stopPropagation()
            onRename()
          }}
        >
          <EditOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="删除收藏夹">
        <IconButton
          size="small"
          aria-label="删除收藏夹"
          onClick={event => {
            event.stopPropagation()
            onDelete()
          }}
        >
          <DeleteOutlineOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <ChevronRightRoundedIcon fontSize="small" sx={{ color: 'text.secondary' }} />
    </Box>
  )
}
