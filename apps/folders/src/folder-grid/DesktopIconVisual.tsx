import * as React from 'react'
import { Box } from '@mui/material'
import { categoryDefinition } from '../categoryRegistry'
import type { CollectionCategoryId, DesktopIcon } from '../types'
import {
  DESKTOP_ICON_DRAG_SHADOW,
  DESKTOP_ICON_SURFACE_RADIUS,
  DESKTOP_ICON_SURFACE_SIZE,
  getDesktopIconPalette,
} from './desktopIconTokens'

type Props = {
  assetUrl?(assetId: string): string
  className?: string
  dragging?: boolean
  glyphSize?: number
  icon?: DesktopIcon
  radius?: number
  seed: string
  shadow?: string | false
  size?: number
  targetKind?: CollectionCategoryId
}

export function DesktopIconVisual(props: Props): React.ReactNode {
  const size = props.size ?? DESKTOP_ICON_SURFACE_SIZE
  const radius = props.radius ?? DESKTOP_ICON_SURFACE_RADIUS
  const glyphSize = props.glyphSize ?? Math.round(size * 0.62)
  const color = props.icon?.kind === 'color' ? props.icon.color : undefined
  const palette = getDesktopIconPalette(props.seed, color)
  const imageSrc = props.icon?.kind === 'image' && props.assetUrl ? props.assetUrl(props.icon.assetId) : null
  const shadow = props.shadow === false ? 'none' : props.dragging ? DESKTOP_ICON_DRAG_SHADOW : props.shadow ?? palette.shadow
  const GlyphIcon = categoryDefinition(props.targetKind || 'folder').icon

  return (
    <Box
      className={props.className}
      sx={{
        position: 'relative',
        width: size,
        height: size,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        overflow: 'hidden',
        borderRadius: `${radius}px`,
        color: palette.foreground,
        background: imageSrc ? '#F8FAFC' : palette.surface,
        boxShadow: shadow,
        transition: props.dragging ? 'none' : 'transform .18s ease, box-shadow .18s ease',
      }}
    >
      {imageSrc ? (
        <Box component="img" src={imageSrc} alt="" draggable={false} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <GlyphIcon sx={{ fontSize: glyphSize, filter: 'drop-shadow(0 3px 7px rgba(15, 23, 42, 0.22))' }} />
      )}
    </Box>
  )
}
