import * as React from 'react'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import { Box, ButtonBase, IconButton, Typography } from '@mui/material'
import type { DesktopGridEntry, FoldersDoc } from '../types'
import { groupName } from '../utils'
import { FOLDER_GRID_ITEM_HEIGHT, FOLDER_GRID_ITEM_WIDTH } from './constants'
import { DesktopIconVisual } from './DesktopIconVisual'
import {
  DESKTOP_ICON_DRAG_SHADOW,
  DESKTOP_ICON_SURFACE_SIZE,
  DESKTOP_ICON_TITLE_SHADOW,
  getDesktopIconPalette,
} from './desktopIconTokens'

const CONTAINER_FOLDER_SURFACE_SIZE = 108
const CONTAINER_FOLDER_RADIUS = 30
const CONTAINER_FOLDER_PREVIEW_SIZE = 34

type Props = {
  assetUrl?(assetId: string): string
  doc: FoldersDoc
  dragging: boolean
  entry: DesktopGridEntry
  groupCount: number
  onOpen(): void
  onContextMenu(x: number, y: number): void
}

export function DesktopGridIcon(props: Props): React.ReactNode {
  const icon = props.entry.icon
  const color = icon?.kind === 'color' ? icon.color : undefined
  const palette = getDesktopIconPalette(`${props.entry.kind}:${props.entry.id}:${props.entry.name}`, color)
  const groupLabel = props.entry.kind === 'folder' && props.groupCount > 1 && props.entry.item ? groupName(props.doc, props.entry.item.groupId) : null
  const detailLabel = props.entry.kind === 'folder' ? groupLabel : null
  const containerItems = props.entry.kind === 'container' ? props.doc.items.filter(item => item.containerId === props.entry.id).slice(0, 4) : []
  const surfaceShadow = props.entry.kind === 'container' ? '0 18px 34px rgba(15, 23, 42, 0.18)' : palette.shadow

  return (
    <Box
      onContextMenu={event => {
        event.preventDefault()
        event.stopPropagation()
        props.onContextMenu(event.clientX, event.clientY)
      }}
      sx={{
        position: 'relative',
        width: FOLDER_GRID_ITEM_WIDTH,
        height: FOLDER_GRID_ITEM_HEIGHT,
        cursor: props.dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
        transition: props.dragging ? 'none' : 'transform .16s ease, filter .16s ease',
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
            boxShadow: surfaceShadow,
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
        {props.entry.kind === 'container' ? (
          <ContainerFolderPreview
            assetUrl={props.assetUrl}
            dragging={props.dragging}
            items={containerItems}
          />
        ) : (
          <DesktopIconVisual
            assetUrl={props.assetUrl}
            className="desktop-grid-icon-surface"
            dragging={props.dragging}
            icon={icon}
            seed={`folder:${props.entry.id}:${props.entry.name}`}
          />
        )}
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

function ContainerFolderPreview(props: { assetUrl?(assetId: string): string; dragging: boolean; items: NonNullable<DesktopGridEntry['item']>[] }) {
  const slots = Array.from({ length: 4 }, (_, index) => props.items[index] || null)
  return (
    <Box
      className="desktop-grid-icon-surface"
      sx={{
        width: CONTAINER_FOLDER_SURFACE_SIZE,
        height: CONTAINER_FOLDER_SURFACE_SIZE,
        p: '12px',
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '10px',
        placeItems: 'center',
        borderRadius: `${CONTAINER_FOLDER_RADIUS}px`,
        background: 'rgba(246, 249, 250, 0.92)',
        border: '1px solid rgba(255, 255, 255, 0.78)',
        boxShadow: props.dragging ? DESKTOP_ICON_DRAG_SHADOW : '0 18px 34px rgba(15, 23, 42, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.78)',
        backdropFilter: 'blur(18px) saturate(1.04)',
        WebkitBackdropFilter: 'blur(18px) saturate(1.04)',
        transition: props.dragging ? 'none' : 'transform .18s ease, box-shadow .18s ease',
      }}
    >
      {slots.map((item, index) => item ? (
        <DesktopIconVisual
          key={item.id}
          assetUrl={props.assetUrl}
          glyphSize={21}
          icon={item.icon}
          radius={10}
          seed={`folder:${item.id}:${item.name}`}
          shadow={false}
          size={CONTAINER_FOLDER_PREVIEW_SIZE}
        />
      ) : <Box key={`empty-${index}`} sx={{ width: CONTAINER_FOLDER_PREVIEW_SIZE, height: CONTAINER_FOLDER_PREVIEW_SIZE }} />)}
    </Box>
  )
}
