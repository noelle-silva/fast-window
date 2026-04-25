import * as React from 'react'
import { Box, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material'
import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'

type Props = {
  editMode: boolean
  dragging?: boolean
  resizing?: boolean
  onRemove?: () => void
  onDeleteEntity?: () => void
  onStartResize?: (e: React.PointerEvent) => void
  children: React.ReactNode
}

export function IndexCardShell(props: Props): React.ReactNode {
  const { editMode, dragging, resizing, onRemove, onDeleteEntity, onStartResize, children } = props
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
        }}
      >
        <Box sx={{ height: '100%', minHeight: 0 }}>{children}</Box>
        {editMode ? (
          <Box sx={{ position: 'absolute', top: 8, right: 8, display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Tooltip title="拖拽排序">
              <IconButton
                size="small"
                aria-label="拖拽排序"
                className="hc-index-drag-handle"
                data-hc-no-drag="1"
                onPointerDown={e => e.stopPropagation()}
                sx={{
                  bgcolor: 'rgba(255,255,255,.95)',
                  border: '1px solid rgba(15,23,42,.10)',
                  boxShadow: '0 8px 18px rgba(15,23,42,.08)',
                  color: 'rgba(15,23,42,.66)',
                  cursor: 'grab',
                  '&:active': { cursor: 'grabbing' },
                }}
              >
                <MoreHorizRoundedIcon fontSize="small" sx={{ transform: 'rotate(90deg)' }} />
              </IconButton>
            </Tooltip>
            {onRemove || onDeleteEntity ? (
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
            {onStartResize ? (
              <Box
                onPointerDown={e => {
                  e.stopPropagation()
                  onStartResize(e)
                }}
                data-hc-no-drag="1"
                sx={{
                  width: 24,
                  height: 24,
                  borderRadius: 999,
                  border: '1px solid rgba(15,23,42,.12)',
                  bgcolor: 'rgba(255,255,255,.96)',
                  cursor: 'nwse-resize',
                  boxShadow: '0 8px 18px rgba(15,23,42,.08)',
                  position: 'relative',
                  '&::before': {
                    content: '""',
                    position: 'absolute',
                    inset: 6,
                    borderRight: '2px solid rgba(15,23,42,.42)',
                    borderBottom: '2px solid rgba(15,23,42,.42)',
                  },
                }}
              />
            ) : null}
          </Box>
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
