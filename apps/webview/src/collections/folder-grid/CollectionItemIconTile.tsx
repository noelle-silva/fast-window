import * as React from 'react'
import { Box, ButtonBase, IconButton, Stack, Typography } from '@mui/material'
import { itemTargetValue } from '../categoryRegistry'
import type { CollectionItem } from '../types'
import { DesktopIconVisual } from './DesktopIconVisual'
import type { FolderGridMetrics } from './iconLayout'
import { DESKTOP_ICON_TITLE_SHADOW } from './desktopIconTokens'

type CollectionItemIconTileVariant = 'desktop' | 'container'

type Props = {
  action?: {
    ariaLabel: string
    icon: React.ReactNode
    title: string
    onClick(): void
  }
  assetUrl?(assetId: string): string
  dragging: boolean
  item: CollectionItem
  metrics: FolderGridMetrics
  variant: CollectionItemIconTileVariant
  onContextMenu(x: number, y: number): void
  onOpen(): void
}

export function CollectionItemIconTile(props: Props): React.ReactNode {
  const target = itemTargetValue(props.item)
  const isDesktop = props.variant === 'desktop'
  const contentWidth = isDesktop ? props.metrics.contentWidth : Math.max(props.metrics.contentWidth, Math.round(props.metrics.itemWidth * 0.84))
  const iconSize = isDesktop ? props.metrics.iconSize : Math.max(props.metrics.iconSize, 76)
  const iconRadius = isDesktop ? props.metrics.iconRadius : Math.max(props.metrics.iconRadius, 22)
  const titleColor = isDesktop ? '#FFFFFF' : 'text.primary'
  const titleShadow = isDesktop ? DESKTOP_ICON_TITLE_SHADOW : 'none'

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
        display: 'grid',
        justifyItems: 'center',
        alignContent: 'start',
        pt: isDesktop ? 0 : 0.5,
        cursor: props.dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
        transition: props.dragging ? 'none' : 'transform .16s ease, filter .16s ease',
        transform: props.dragging ? 'scale(1.06)' : 'scale(1)',
        '&:hover .collection-icon-action, &:focus-within .collection-icon-action': { opacity: 1, transform: 'translateY(0) scale(1)' },
      }}
    >
      <ButtonBase
        disableRipple
        onClick={props.onOpen}
        aria-label={`打开：${props.item.name}`}
        title={target}
        sx={{
          width: contentWidth,
          minWidth: 0,
          p: 0.5,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          alignItems: 'center',
          gap: isDesktop ? 0.9 : 1,
          borderRadius: isDesktop ? 4 : 5,
          color: 'inherit',
          textAlign: 'center',
          '&:hover .desktop-grid-icon-surface': {
            transform: 'translateY(-3px)',
          },
          '&:hover .desktop-grid-source-badge': {
            transform: 'translateY(-3px) scale(1.08)',
            bgcolor: 'rgba(37, 99, 235, 0.92)',
            boxShadow: '0 12px 24px rgba(37, 99, 235, 0.28), 0 8px 18px rgba(15, 23, 42, 0.24)',
          },
          '&:active .desktop-grid-icon-surface': {
            transform: 'translateY(0) scale(0.98)',
          },
          '&:active .desktop-grid-source-badge': {
            transform: 'translateY(0) scale(0.98)',
          },
          '&:focus-visible': {
            outline: isDesktop ? '2px solid rgba(255, 255, 255, 0.92)' : '2px solid rgba(37, 99, 235, 0.75)',
            outlineOffset: isDesktop ? 3 : 4,
            boxShadow: isDesktop ? '0 0 0 5px rgba(37, 99, 235, 0.34)' : 'none',
          },
        }}
      >
        <DesktopIconVisual
          assetUrl={props.assetUrl}
          className="desktop-grid-icon-surface"
          dragging={props.dragging}
          icon={props.item.icon}
          radius={iconRadius}
          seed={`url:${props.item.id}:${props.item.name}`}
          size={iconSize}
        />
        <Stack spacing={isDesktop ? 0.35 : 0.25} sx={{ minWidth: 0, width: '100%', alignItems: 'center' }}>
          <Typography
            component="span"
            title={props.item.name}
            sx={{
              maxWidth: '100%',
              color: titleColor,
              fontSize: props.metrics.titleFontSize,
              fontWeight: 850,
              lineHeight: 1.14,
              letterSpacing: '-0.01em',
              textShadow: titleShadow,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: isDesktop ? 2 : 1,
              overflowWrap: 'anywhere',
            }}
          >
            {props.item.name}
          </Typography>
          {!isDesktop ? (
            <Typography noWrap title={target} variant="caption" sx={{ display: 'block', maxWidth: '100%', color: 'rgba(15, 23, 42, 0.45)' }}>
              {target}
            </Typography>
          ) : null}
        </Stack>
      </ButtonBase>
      {props.action ? (
        <IconButton
          className="collection-icon-action"
          data-folder-grid-no-drag="1"
          aria-label={props.action.ariaLabel}
          title={props.action.title}
          onClick={event => { event.stopPropagation(); props.action?.onClick() }}
          size="small"
          sx={{
            position: 'absolute',
            top: -4,
            right: Math.max(10, Math.round((props.metrics.itemWidth - contentWidth) / 2)),
            opacity: { xs: 1, sm: 0 },
            transform: { xs: 'translateY(0) scale(1)', sm: 'translateY(-4px) scale(0.92)' },
            transition: 'opacity .16s ease, transform .16s ease, background-color .16s ease',
            bgcolor: 'rgba(255, 255, 255, 0.92)',
            boxShadow: '0 10px 22px rgba(15, 23, 42, 0.16)',
            '&:hover': { bgcolor: '#FFFFFF', color: 'primary.main' },
          }}
        >
          {props.action.icon}
        </IconButton>
      ) : null}
    </Box>
  )
}
