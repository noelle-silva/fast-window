import * as React from 'react'
import { Box, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material'
import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import type { ResizeHandleDirection } from './types'

type Props = {
  editMode: boolean
  dragging?: boolean
  resizing?: boolean
  onRemove?: () => void
  onDeleteEntity?: () => void
  onEditEntity?: () => void
  onStartResize?: (direction: ResizeHandleDirection, e: React.PointerEvent) => void
  children: React.ReactNode
}

const resizeHandles: { direction: ResizeHandleDirection; cursor: string; sx: Record<string, any> }[] = [
  { direction: 'nw', cursor: 'nwse-resize', sx: { left: 0, top: 0 } },
  { direction: 'ne', cursor: 'nesw-resize', sx: { right: 0, top: 0 } },
  { direction: 'sw', cursor: 'nesw-resize', sx: { left: 0, bottom: 0 } },
  { direction: 'se', cursor: 'nwse-resize', sx: { right: 0, bottom: 0 } },
]

export function IndexCardShell(props: Props): React.ReactNode {
  const { editMode, dragging, resizing, onRemove, onDeleteEntity, onEditEntity, onStartResize, children } = props
  const [menuAnchorEl, setMenuAnchorEl] = React.useState<HTMLElement | null>(null)
  const menuOpen = Boolean(menuAnchorEl)

  const closeMenu = React.useCallback(() => setMenuAnchorEl(null), [])

  return (
    <Box
      sx={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        opacity: dragging ? 0.78 : 1,
        transition: resizing ? 'none' : 'opacity .12s ease, box-shadow .12s ease',
      }}
    >
      <Box
        sx={{
          position: 'relative',
          height: '100%',
          minHeight: 0,
          flex: 1,
          cursor: editMode ? 'grab' : 'default',
          '&:active': editMode ? { cursor: 'grabbing' } : undefined,
          '&:hover .hc-index-card-actions, &:focus-within .hc-index-card-actions': {
            opacity: 1,
            pointerEvents: 'auto',
          },
        }}
      >
        <Box sx={{ height: '100%', minHeight: 0 }}>{children}</Box>
        {editMode ? (
          <Box
            className="hc-index-card-actions"
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              opacity: menuOpen ? 1 : 0,
              pointerEvents: menuOpen ? 'auto' : 'none',
              transition: 'opacity .12s ease',
              zIndex: 4,
            }}
          >
            {onRemove || onDeleteEntity || onEditEntity ? (
              <Tooltip title="更多操作">
                <IconButton
                  size="small"
                  aria-label="更多操作"
                  data-hc-no-drag="1"
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => {
                    e.stopPropagation()
                    setMenuAnchorEl(e.currentTarget)
                  }}
                  sx={{
                    bgcolor: 'rgba(255,255,255,.95)',
                    border: '1px solid rgba(15,23,42,.10)',
                    boxShadow: '0 8px 18px rgba(15,23,42,.08)',
                    color: 'rgba(15,23,42,.66)',
                  }}
                >
                  <MoreHorizRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
          </Box>
        ) : null}
        {editMode && onStartResize ? (
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
          anchorEl={menuAnchorEl}
          onClose={closeMenu}
          PaperProps={{ sx: { borderRadius: 3, minWidth: 190 } }}
          MenuListProps={{
            'aria-label': '卡片更多操作',
            onPointerDown: e => e.stopPropagation(),
          }}
        >
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
              sx={{ color: '#d32f2f' }}
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
