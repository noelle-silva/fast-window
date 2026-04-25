import * as React from 'react'
import { Box, Button, IconButton, Tooltip } from '@mui/material'
import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'

type Props = {
  editMode: boolean
  dragging?: boolean
  resizing?: boolean
  onStartDrag?: (e: React.PointerEvent) => void
  onRemove?: () => void
  onDeleteEntity?: () => void
  onStartResize?: (e: React.PointerEvent) => void
  children: React.ReactNode
}

export function IndexCardShell(props: Props): React.ReactNode {
  const { editMode, dragging, resizing, onStartDrag, onRemove, onDeleteEntity, onStartResize, children } = props

  return (
    <Box
      sx={{
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        opacity: dragging ? 0.78 : 1,
        transform: dragging ? 'scale(1.01)' : 'none',
        transition: resizing ? 'none' : 'transform .12s ease, opacity .12s ease, box-shadow .12s ease',
      }}
    >
      <Box
        onPointerDown={editMode ? onStartDrag : undefined}
        sx={{
          position: 'relative',
          minHeight: 100,
          flex: 1,
          cursor: editMode ? 'grab' : 'default',
          '&:active': editMode ? { cursor: 'grabbing' } : undefined,
        }}
      >
        <Box sx={{ height: '100%' }}>{children}</Box>
        {editMode && onRemove ? (
          <Tooltip title="移除引用">
            <IconButton
              size="small"
              aria-label="移除引用"
              data-hc-no-drag="1"
              onPointerDown={e => e.stopPropagation()}
              onClick={e => {
                e.stopPropagation()
                onRemove()
              }}
              sx={{
                position: 'absolute',
                right: 6,
                bottom: 6,
                bgcolor: 'rgba(255,255,255,.92)',
                boxShadow: '0 1px 2px rgba(0,0,0,.10)',
                color: 'rgba(0,0,0,.55)',
                '&:hover': { bgcolor: 'rgba(211,47,47,.10)', color: '#d32f2f' },
              }}
            >
              <DeleteOutlineRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
        {editMode && onStartResize ? (
          <Box
            onPointerDown={e => {
              e.stopPropagation()
              onStartResize(e)
            }}
            data-hc-no-drag="1"
            sx={{
              position: 'absolute',
              right: 6,
              top: 6,
              width: 18,
              height: 18,
              borderRadius: 999,
              border: '1px solid rgba(0,0,0,.18)',
              bgcolor: 'rgba(255,255,255,.95)',
              cursor: 'nwse-resize',
              boxShadow: '0 1px 2px rgba(0,0,0,.10)',
              '&::before': {
                content: '""',
                position: 'absolute',
                inset: 4,
                borderRight: '2px solid rgba(0,0,0,.35)',
                borderBottom: '2px solid rgba(0,0,0,.35)',
              },
            }}
          />
        ) : null}
      </Box>
      {editMode && onDeleteEntity ? (
        <Button
          size="small"
          color="error"
          startIcon={<DeleteForeverRoundedIcon fontSize="small" />}
          data-hc-no-drag="1"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation()
            onDeleteEntity()
          }}
          sx={{ mt: 0.75, alignSelf: 'flex-end', borderRadius: 999, textTransform: 'none' }}
        >
          删除实体
        </Button>
      ) : null}
    </Box>
  )
}
