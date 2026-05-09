import * as React from 'react'
import { Box } from '@mui/material'
import { DefaultIconVisual, type DesktopGridIconSource } from './DefaultIconVisual'
import { DESKTOP_GRID_ICON_DRAG_SHADOW } from './iconTokens'

const SURFACE_SIZE = 108
const SURFACE_RADIUS = 30
const PREVIEW_SIZE = 34

export type DesktopGridPreviewItem = {
  id: string
  name: string
  icon?: DesktopGridIconSource
}

type Props = {
  dragging?: boolean
  items: DesktopGridPreviewItem[]
}

export function DefaultContainerPreview(props: Props): React.ReactNode {
  const slots = Array.from({ length: 4 }, (_, index) => props.items[index] || null)
  return (
    <Box
      className="desktop-grid-icon-surface"
      sx={{
        width: SURFACE_SIZE,
        height: SURFACE_SIZE,
        p: '12px',
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '10px',
        placeItems: 'center',
        borderRadius: `${SURFACE_RADIUS}px`,
        background: 'rgba(246, 249, 250, 0.92)',
        border: '1px solid rgba(255, 255, 255, 0.78)',
        boxShadow: props.dragging ? DESKTOP_GRID_ICON_DRAG_SHADOW : '0 18px 34px rgba(15, 23, 42, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.78)',
        backdropFilter: 'blur(18px) saturate(1.04)',
        WebkitBackdropFilter: 'blur(18px) saturate(1.04)',
        transition: props.dragging ? 'none' : 'transform .18s ease, box-shadow .18s ease',
      }}
    >
      {slots.map((item, index) => item ? (
        <DefaultIconVisual
          key={item.id}
          glyphSize={21}
          icon={item.icon}
          radius={10}
          seed={`container-preview:${item.id}:${item.name}`}
          shadow={false}
          size={PREVIEW_SIZE}
        />
      ) : <Box key={`empty-${index}`} sx={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }} />)}
    </Box>
  )
}
