import * as React from 'react'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import { Box, ButtonBase, IconButton, Typography } from '@mui/material'
import type { DesktopGridEntry, FoldersDoc } from '../types'
import { folderGroupLabel } from '../groupMembership'
import { DesktopIconVisual } from './DesktopIconVisual'
import type { FolderGridMetrics } from './iconLayout'
import {
  DESKTOP_ICON_DRAG_SHADOW,
  DESKTOP_ICON_TITLE_SHADOW,
  getDesktopIconPalette,
} from './desktopIconTokens'

type Props = {
  assetUrl?(assetId: string): string
  doc: FoldersDoc
  dragging: boolean
  entry: DesktopGridEntry
  groupCount: number
  metrics: FolderGridMetrics
  onOpen(): void
  onContextMenu(x: number, y: number): void
}

export function DesktopGridIcon(props: Props): React.ReactNode {
  const icon = props.entry.icon
  const color = icon?.kind === 'color' ? icon.color : undefined
  const palette = getDesktopIconPalette(`${props.entry.kind}:${props.entry.id}:${props.entry.name}`, color)
  const groupLabel = props.entry.kind === 'folder' && props.groupCount > 1 && props.entry.item ? folderGroupLabel(props.doc, props.entry.item) : null
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
        width: props.metrics.itemWidth,
        height: props.metrics.itemHeight,
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
          width: props.metrics.itemWidth,
          height: props.metrics.itemHeight,
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
            metrics={props.metrics}
          />
        ) : (
          <DesktopIconVisual
            assetUrl={props.assetUrl}
            className="desktop-grid-icon-surface"
            dragging={props.dragging}
            icon={icon}
            radius={props.metrics.iconRadius}
            seed={`folder:${props.entry.id}:${props.entry.name}`}
            size={props.metrics.iconSize}
          />
        )}
        <Box sx={{ width: '100%', minWidth: 0, display: 'grid', justifyItems: 'center', gap: 0.35 }}>
          <Typography
            component="span"
            title={props.entry.name}
            sx={{
              maxWidth: '100%',
              color: '#FFFFFF',
              fontSize: props.metrics.titleFontSize,
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
                fontSize: props.metrics.detailFontSize,
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
          top: props.metrics.menuTop,
          right: props.metrics.menuRight,
          width: props.metrics.menuSize,
          height: props.metrics.menuSize,
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

function ContainerFolderPreview(props: { assetUrl?(assetId: string): string; dragging: boolean; items: NonNullable<DesktopGridEntry['item']>[]; metrics: FolderGridMetrics }) {
  const slots = Array.from({ length: 4 }, (_, index) => props.items[index] || null)
  return (
    <Box
      className="desktop-grid-icon-surface"
      sx={{
        width: props.metrics.containerSurfaceSize,
        height: props.metrics.containerSurfaceSize,
        p: `${props.metrics.containerPreviewPadding}px`,
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: `${props.metrics.containerPreviewGap}px`,
        placeItems: 'center',
        borderRadius: `${props.metrics.containerSurfaceRadius}px`,
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
          glyphSize={Math.round(props.metrics.containerPreviewSize * 0.62)}
          icon={item.icon}
          radius={Math.max(8, Math.round(props.metrics.containerPreviewSize * 0.3))}
          seed={`folder:${item.id}:${item.name}`}
          shadow={false}
          size={props.metrics.containerPreviewSize}
        />
      ) : <Box key={`empty-${index}`} sx={{ width: props.metrics.containerPreviewSize, height: props.metrics.containerPreviewSize }} />)}
    </Box>
  )
}
