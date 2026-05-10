import * as React from 'react'
import { Box, ButtonBase, Typography } from '@mui/material'
import { DESKTOP_GRID_ITEM_HEIGHT, DESKTOP_GRID_ITEM_WIDTH } from '../core/constants'
import { DESKTOP_GRID_ICON_DRAG_SHADOW, DESKTOP_GRID_ICON_TITLE_SHADOW } from '../visual/iconTokens'

type Props = {
  detail?: string | null
  dragging?: boolean
  icon: React.ReactNode
  name: string
  onContextMenu?(x: number, y: number): void
  onOpen(): void
  title?: string
}

export function DesktopGridItem(props: Props): React.ReactNode {
  return (
    <Box
      onContextMenu={event => {
        if (!props.onContextMenu) return
        event.preventDefault()
        event.stopPropagation()
        props.onContextMenu(event.clientX, event.clientY)
      }}
      sx={{
        position: 'relative',
        width: DESKTOP_GRID_ITEM_WIDTH,
        height: DESKTOP_GRID_ITEM_HEIGHT,
        cursor: props.dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
        transition: props.dragging ? 'none' : 'transform .16s ease, filter .16s ease',
        transform: props.dragging ? 'scale(1.06)' : 'scale(1)',
        filter: props.dragging ? `drop-shadow(${DESKTOP_GRID_ICON_DRAG_SHADOW})` : 'none',
      }}
    >
      <ButtonBase
        disableRipple
        onClick={props.onOpen}
        aria-label={`Open ${props.name}`}
        title={props.title || props.name}
        sx={{
          width: DESKTOP_GRID_ITEM_WIDTH,
          height: DESKTOP_GRID_ITEM_HEIGHT,
          p: 0.5,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          alignItems: 'center',
          gap: 0.9,
          borderRadius: 4,
          color: 'inherit',
          textAlign: 'center',
          '&:hover .desktop-grid-icon-surface': { transform: 'translateY(-3px)' },
          '&:active .desktop-grid-icon-surface': { transform: 'translateY(0) scale(0.98)' },
          '&:focus-visible': {
            outline: '2px solid rgba(255, 255, 255, 0.92)',
            outlineOffset: 3,
            boxShadow: '0 0 0 5px rgba(37, 99, 235, 0.34)',
          },
        }}
      >
        {props.icon}
        <Box sx={{ width: '100%', minWidth: 0, display: 'grid', justifyItems: 'center', gap: 0.35 }}>
          <Typography
            component="span"
            title={props.name}
            sx={{
              maxWidth: '100%',
              color: '#FFFFFF',
              fontSize: 13.5,
              fontWeight: 850,
              lineHeight: 1.14,
              letterSpacing: '-0.01em',
              textShadow: DESKTOP_GRID_ICON_TITLE_SHADOW,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
              overflowWrap: 'anywhere',
            }}
          >
            {props.name}
          </Typography>
          {props.detail ? (
            <Typography
              component="span"
              title={props.detail}
              sx={{
                maxWidth: '86%',
                px: 0.75,
                py: 0.15,
                borderRadius: 999,
                color: '#FFFFFF',
                fontSize: 10.5,
                fontWeight: 800,
                lineHeight: 1.35,
                textShadow: '0 1px 2px rgba(15, 23, 42, 0.72)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {props.detail}
            </Typography>
          ) : null}
        </Box>
      </ButtonBase>
    </Box>
  )
}
