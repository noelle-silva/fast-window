import * as React from 'react'
import { Box } from '@mui/material'
import type { DesktopWallpaper as DesktopWallpaperState } from './types'

type Props = {
  wallpaper?: DesktopWallpaperState
  assetUrl?(assetId: string): string
}

export function DesktopWallpaper(props: Props): React.ReactNode {
  const src = props.wallpaper?.assetId && props.assetUrl ? props.assetUrl(props.wallpaper.assetId) : null
  if (!src) return null

  return (
    <Box
      aria-hidden="true"
      sx={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <Box
        component="img"
        src={src}
        alt=""
        draggable={false}
        sx={{
          width: '100%',
          height: '100%',
          display: 'block',
          objectFit: 'cover',
          userSelect: 'none',
        }}
      />
    </Box>
  )
}
