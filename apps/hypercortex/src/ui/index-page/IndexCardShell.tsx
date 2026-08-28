import * as React from 'react'
import { Box, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material'
import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'
import type { ResizeHandleDirection } from './types'

type Props = {
  dragging?: boolean
  resizing?: boolean
  onFavorite?: () => void
  onRemove?: () => void
  onDeleteEntity?: () => void
  onEditEntity?: () => void
  onStartResize?: (direction: ResizeHandleDirection, e: React.PointerEvent) => void
  children: React.ReactNode
}

const resizeHandles: { direction: ResizeHandleDirection; cursor: string; sx: Record<string, any> }[] = [
  { direction: 'n', cursor: 'ns-resize', sx: { left: 18, right: 18, top: 0, width: 'auto', height: 12 } },
  { direction: 'e', cursor: 'ew-resize', sx: { right: 0, top: 18, bottom: 18, width: 12, height: 'auto' } },
  { direction: 's', cursor: 'ns-resize', sx: { left: 18, right: 18, bottom: 0, width: 'auto', height: 12 } },
  { direction: 'w', cursor: 'ew-resize', sx: { left: 40, top: 18, bottom: 18, width: 12, height: 'auto' } },
  { direction: 'nw', cursor: 'nwse-resize', sx: { left: 0, top: 0 } },
  { direction: 'ne', cursor: 'nesw-resize', sx: { right: 0, top: 0 } },
  { direction: 'sw', cursor: 'nesw-resize', sx: { left: 0, bottom: 0 } },
  { direction: 'se', cursor: 'nwse-resize', sx: { right: 0, bottom: 0 } },
]

export function IndexCardShell(props: Props): React.ReactNode {
  const { dragging, resizing, onFavorite, onRemove, onDeleteEntity, onEditEntity, onStartResize, children } = props
  const [menuAnchorEl, setMenuAnchorEl] = React.useState<{ top: number; left: number } | null>(null)
  const menuOpen = Boolean(menuAnchorEl)

  const closeMenu = React.useCallback(() => setMenuAnchorEl(null), [])

  const openContextMenu = React.useCallback(
    (e: React.MouseEvent) => {
      if (!onFavorite && !onRemove && !onDeleteEntity && !onEditEntity) return
      e.preventDefault()
      e.stopPropagation()
      setMenuAnchorEl({ top: e.clientY, left: e.clientX })
    },
    [onDeleteEntity, onEditEntity, onFavorite, onRemove],
  )

  return (
    <Box
      sx={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        opacity: dragging ? 0.78 : 1,
        borderRadius: 3.5,
        bgcolor: 'var(--hc-surface)',
        boxShadow: '0 10px 24px var(--hc-shadow)',
        overflow: 'hidden',
        transition: resizing ? 'none' : 'opacity .12s ease, box-shadow .18s ease, transform .18s ease',
        '&:hover': {
          transform: 'translateY(-1px)',
          boxShadow: '0 16px 32px var(--hc-shadow-strong)',
        },
      }}
    >
      <Box
        onContextMenu={openContextMenu}
        sx={{
          position: 'relative',
          height: '100%',
          minHeight: 0,
          flex: 1,
          display: 'flex',
        }}
      >
        <Tooltip title="拖拽调整位置">
          <Box
            aria-label="拖拽调整位置"
            data-hc-drag-handle="1"
            sx={{
              position: 'relative',
              zIndex: 2,
              width: 40,
              flexShrink: 0,
              height: '100%',
              minHeight: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'grab',
              '&:active': { cursor: 'grabbing' },
              color: 'var(--hc-text-subtle)',
            }}
          >
            <DragIndicatorRoundedIcon fontSize="small" />
          </Box>
        </Tooltip>
        <Box sx={{ flex: 1, minWidth: 0, height: '100%', minHeight: 0 }}>{children}</Box>
        {onStartResize ? (
          <>
            {resizeHandles.map(handle => (
              <Box
                key={handle.direction}
                data-hc-no-drag="1"
                onPointerDown={e => {
                  e.stopPropagation()
                  onStartResize(handle.direction, e)
                }}
                sx={{
                  position: 'absolute',
                  width: 18,
                  height: 18,
                  cursor: handle.cursor,
                  zIndex: 3,
                  ...handle.sx,
                }}
              />
            ))}
          </>
        ) : null}
        <Menu
          open={menuOpen}
          anchorReference="anchorPosition"
          anchorPosition={menuAnchorEl ?? undefined}
          onClose={closeMenu}
          PaperProps={{ sx: { borderRadius: 3, minWidth: 190 } }}
          MenuListProps={{
            'aria-label': '卡片更多操作',
            onPointerDown: e => e.stopPropagation(),
          }}
        >
          {onFavorite ? (
            <MenuItem
              onClick={e => {
                e.stopPropagation()
                closeMenu()
                onFavorite()
              }}
            >
              <ListItemIcon>
                <StarBorderRoundedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="收藏到…" />
            </MenuItem>
          ) : null}
          {onEditEntity ? (
            <MenuItem
              onClick={e => {
                e.stopPropagation()
                closeMenu()
                onEditEntity()
              }}
            >
              <ListItemIcon>
                <EditRoundedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="编辑信息" />
            </MenuItem>
          ) : null}
          {onRemove ? (
            <MenuItem
              onClick={e => {
                e.stopPropagation()
                closeMenu()
                onRemove()
              }}
            >
              <ListItemIcon>
                <DeleteOutlineRoundedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="从当前页移除引用" />
            </MenuItem>
          ) : null}
          {onDeleteEntity ? (
            <MenuItem
              onClick={e => {
                e.stopPropagation()
                closeMenu()
                onDeleteEntity()
              }}
              sx={{ color: 'var(--hc-danger)' }}
            >
              <ListItemIcon sx={{ color: 'inherit' }}>
                <DeleteForeverRoundedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="删除实体" />
            </MenuItem>
          ) : null}
        </Menu>
      </Box>
    </Box>
  )
}
