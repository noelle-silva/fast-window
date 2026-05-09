import * as React from 'react'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import { Box, ButtonBase, IconButton, Typography } from '@mui/material'
import type { DesktopGridEntry, FoldersDoc } from '../types'
import { groupName } from '../utils'
import { FOLDER_GRID_ITEM_HEIGHT, FOLDER_GRID_ITEM_WIDTH } from './constants'
import {
  DESKTOP_ICON_DRAG_SHADOW,
  DESKTOP_ICON_SURFACE_RADIUS,
  DESKTOP_ICON_SURFACE_SIZE,
  DESKTOP_ICON_TITLE_SHADOW,
  getDesktopIconPalette,
} from './desktopIconTokens'
import type { FolderGridPixelRect } from './layout'

type Props = {
  assetUrl?(assetId: string): string
  doc: FoldersDoc
  dragging: boolean
  entry: DesktopGridEntry
  groupCount: number
  rect: FolderGridPixelRect
  onBeginDrag(event: React.PointerEvent): void
  onOpen(): void
  onContextMenu(x: number, y: number): void
}

export function DesktopGridIcon(props: Props): React.ReactNode {
  const icon = props.entry.icon
  const color = icon?.kind === 'color' ? icon.color : undefined
  const palette = getDesktopIconPalette(`${props.entry.kind}:${props.entry.id}:${props.entry.name}`, color)
  const groupLabel = props.entry.kind === 'folder' && props.groupCount > 1 && props.entry.item ? groupName(props.doc, props.entry.item.groupId) : null
  const detailLabel = props.entry.kind === 'container' ? `${props.entry.itemCount || 0} 个` : groupLabel
  const imageSrc = icon?.kind === 'image' && props.assetUrl ? props.assetUrl(icon.assetId) : null

  return (
    <Box
      onPointerDown={props.onBeginDrag}
      onContextMenu={event => {
        event.preventDefault()
        event.stopPropagation()
        props.onContextMenu(event.clientX, event.clientY)
      }}
      sx={{
        position: 'absolute',
        left: props.rect.left,
        top: props.rect.top,
        width: props.rect.width,
        height: props.rect.height,
        zIndex: props.dragging ? 4 : 1,
        cursor: props.dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
        transition: props.dragging ? 'none' : 'left .16s ease, top .16s ease, transform .16s ease, filter .16s ease',
        transform: props.dragging ? 'scale(1.06)' : 'scale(1)',
        filter: props.dragging ? `drop-shadow(${DESKTOP_ICON_DRAG_SHADOW})` : 'none',
        '&:hover .desktop-grid-icon-menu, &:focus-within .desktop-grid-icon-menu': {
          opacity: 1,
          pointerEvents: 'auto',
          transform: 'translateY(0) scale(1)',
        },
      }}
    >
      <ButtonBase
        disableRipple
        onClick={props.onOpen}
        aria-label={`打开：${props.entry.name}`}
        title={props.entry.item?.path || props.entry.name}
        sx={{
          width: FOLDER_GRID_ITEM_WIDTH,
          height: FOLDER_GRID_ITEM_HEIGHT,
          p: 0.5,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          alignItems: 'center',
          gap: 0.9,
          borderRadius: 4,
          color: 'inherit',
          textAlign: 'center',
          '&:hover .desktop-grid-icon-surface': {
            transform: 'translateY(-3px)',
            boxShadow: palette.shadow,
          },
          '&:active .desktop-grid-icon-surface': {
            transform: 'translateY(0) scale(0.98)',
          },
          '&:focus-visible': {
            outline: '2px solid rgba(255, 255, 255, 0.92)',
            outlineOffset: 3,
            boxShadow: '0 0 0 5px rgba(37, 99, 235, 0.34)',
          },
        }}
      >
        <Box
          className="desktop-grid-icon-surface"
          sx={{
            position: 'relative',
            width: DESKTOP_ICON_SURFACE_SIZE,
            height: DESKTOP_ICON_SURFACE_SIZE,
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
            overflow: 'hidden',
            borderRadius: `${DESKTOP_ICON_SURFACE_RADIUS}px`,
            color: palette.foreground,
            background: palette.surface,
            boxShadow: props.dragging ? DESKTOP_ICON_DRAG_SHADOW : palette.shadow,
            transition: props.dragging ? 'none' : 'transform .18s ease, box-shadow .18s ease',
          }}
        >
          {imageSrc ? (
            <Box component="img" src={imageSrc} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <>
              <FolderRoundedIcon sx={{ fontSize: 54, filter: 'drop-shadow(0 3px 7px rgba(15, 23, 42, 0.22))' }} />
              {props.entry.kind === 'container' ? <ContainerGlyph /> : null}
            </>
          )}
        </Box>
        <Box sx={{ width: '100%', minWidth: 0, display: 'grid', justifyItems: 'center', gap: 0.35 }}>
          <Typography
            component="span"
            title={props.entry.name}
            sx={{
              maxWidth: '100%',
              color: '#FFFFFF',
              fontSize: 13.5,
              fontWeight: 850,
              lineHeight: 1.14,
              letterSpacing: '-0.01em',
              textShadow: DESKTOP_ICON_TITLE_SHADOW,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
              overflowWrap: 'anywhere',
            }}
          >
            {props.entry.name}
          </Typography>
          {detailLabel ? (
            <Typography
              component="span"
              title={detailLabel}
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
              {detailLabel}
            </Typography>
          ) : null}
        </Box>
      </ButtonBase>
      <IconButton
        className="desktop-grid-icon-menu"
        data-folder-grid-no-drag="1"
        aria-label={`更多操作：${props.entry.name}`}
        onClick={event => {
          event.stopPropagation()
          const rect = event.currentTarget.getBoundingClientRect()
          props.onContextMenu(rect.left, rect.bottom + 4)
        }}
        sx={{
          position: 'absolute',
          top: 4,
          right: 18,
          width: 28,
          height: 28,
          opacity: 0,
          pointerEvents: 'none',
          transform: 'translateY(-2px) scale(0.92)',
          transition: 'opacity .16s ease, transform .16s ease, background-color .16s ease',
          color: 'text.primary',
          bgcolor: 'rgba(255, 255, 255, 0.9)',
          boxShadow: '0 8px 18px rgba(15, 23, 42, 0.12)',
          '&:hover': {
            color: 'primary.main',
            bgcolor: 'rgba(255, 255, 255, 0.96)',
          },
          '@media (hover: none)': {
            opacity: 0.92,
            pointerEvents: 'auto',
            transform: 'translateY(0) scale(1)',
          },
        }}
      >
        <MoreVertRoundedIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}

function ContainerGlyph() {
  return (
    <Box sx={{ position: 'absolute', right: 13, bottom: 13, display: 'grid', gridTemplateColumns: 'repeat(2, 8px)', gap: '4px' }}>
      {[0, 1, 2, 3].map(index => <Box key={index} sx={{ width: 8, height: 8, borderRadius: 1, bgcolor: 'rgba(255, 255, 255, 0.82)' }} />)}
    </Box>
  )
}
