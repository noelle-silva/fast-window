import * as React from 'react'
import AppsRoundedIcon from '@mui/icons-material/AppsRounded'
import { Box } from '@mui/material'
import {
  DESKTOP_GRID_ICON_DRAG_SHADOW,
  DESKTOP_GRID_ICON_SURFACE_RADIUS,
  DESKTOP_GRID_ICON_SURFACE_SIZE,
  getDesktopGridIconPalette,
} from './iconTokens'

export type DesktopGridIconSource =
  | { kind: 'color'; color: string }
  | { kind: 'image'; src: string }

type Props = {
  className?: string
  dragging?: boolean
  glyphSize?: number
  icon?: DesktopGridIconSource
  radius?: number
  seed: string
  shadow?: string | false
  size?: number
}

export function DefaultIconVisual(props: Props): React.ReactNode {
  const size = props.size ?? DESKTOP_GRID_ICON_SURFACE_SIZE
  const radius = props.radius ?? DESKTOP_GRID_ICON_SURFACE_RADIUS
  const glyphSize = props.glyphSize ?? Math.round(size * 0.62)
  const color = props.icon?.kind === 'color' ? props.icon.color : undefined
  const palette = getDesktopGridIconPalette(props.seed, color)
  const imageSrc = props.icon?.kind === 'image' ? props.icon.src : null
  const shadow = props.shadow === false ? 'none' : props.dragging ? DESKTOP_GRID_ICON_DRAG_SHADOW : props.shadow ?? palette.shadow

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
        <AppsRoundedIcon sx={{ fontSize: glyphSize, filter: 'drop-shadow(0 3px 7px rgba(15, 23, 42, 0.22))' }} />
      )}
    </Box>
  )
}
