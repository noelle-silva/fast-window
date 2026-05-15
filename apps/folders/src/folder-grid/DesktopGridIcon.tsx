import * as React from 'react'
import { Box, ButtonBase, Typography } from '@mui/material'
import { categoryDefinition, itemTargetValue } from '../categoryRegistry'
import type { CategoryWorkspace, DesktopGridEntry } from '../types'
import { DesktopIconVisual } from './DesktopIconVisual'
import type { FolderGridMetrics } from './iconLayout'
import {
  DESKTOP_ICON_DRAG_SHADOW,
  DESKTOP_ICON_TITLE_SHADOW,
  getDesktopIconPalette,
} from './desktopIconTokens'

type Props = {
  assetUrl?(assetId: string): string
  workspace: CategoryWorkspace
  dragging: boolean
  entry: DesktopGridEntry
  metrics: FolderGridMetrics
  onOpen(): void
  onContextMenu(x: number, y: number): void
}

export function DesktopGridIcon(props: Props): React.ReactNode {
  const icon = props.entry.icon
  const color = icon?.kind === 'color' ? icon.color : undefined
  const palette = getDesktopIconPalette(`${props.entry.kind}:${props.entry.id}:${props.entry.name}`, color)
  const detailLabel = props.entry.kind === 'container' ? `${props.entry.itemCount || 0} 个项目` : null
  const sourceCategory = props.entry.item?.sourceCategoryId ? categoryDefinition(props.entry.item.sourceCategoryId) : null
  const containerItems = props.entry.kind === 'container' ? props.workspace.items.filter(item => item.containerId === props.entry.id).slice(0, 4) : []
  const surfaceShadow = props.entry.kind === 'container' ? '0 18px 34px rgba(15, 23, 42, 0.18)' : palette.shadow
  const title = props.entry.item ? itemTargetValue(props.entry.item) : props.entry.name

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
      }}
    >
      <ButtonBase
        disableRipple
        onClick={props.onOpen}
        aria-label={`打开：${props.entry.name}`}
        title={title}
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
            seed={`${props.entry.item?.target.kind || 'folder'}:${props.entry.id}:${props.entry.name}`}
            size={props.metrics.iconSize}
            targetKind={props.entry.item?.target.kind}
          />
        )}
        {sourceCategory ? <SourceCategoryBadge label={sourceCategory.label} /> : null}
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
    </Box>
  )
}

function SourceCategoryBadge(props: { label: string }) {
  return (
    <Box
      aria-label={`来源分类：${props.label}`}
      title={`来源分类：${props.label}`}
      sx={{
        position: 'absolute',
        right: 10,
        top: 44,
        maxWidth: 48,
        px: 0.6,
        py: 0.18,
        borderRadius: 999,
        bgcolor: 'rgba(15, 23, 42, 0.82)',
        border: '1px solid rgba(255, 255, 255, 0.72)',
        color: '#FFFFFF',
        fontSize: 10,
        fontWeight: 900,
        lineHeight: 1.25,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        boxShadow: '0 8px 18px rgba(15, 23, 42, 0.28)',
        pointerEvents: 'none',
      }}
    >
      {props.label}
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
          seed={`${item.target.kind}:${item.id}:${item.name}`}
          shadow={false}
          size={props.metrics.containerPreviewSize}
          targetKind={item.target.kind}
        />
      ) : <Box key={`empty-${index}`} sx={{ width: props.metrics.containerPreviewSize, height: props.metrics.containerPreviewSize }} />)}
    </Box>
  )
}
