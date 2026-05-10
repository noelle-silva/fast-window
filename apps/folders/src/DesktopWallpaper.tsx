import * as React from 'react'
import { Box } from '@mui/material'
import { desktopWallpaperImageSx } from './desktopWallpaperImage'
import { activeDesktopWallpaperPreset } from './desktopWallpaperPresets'
import type { DesktopWallpaper as DesktopWallpaperState } from './types'

type Props = {
  wallpaper?: DesktopWallpaperState
  assetUrl?(assetId: string): string
}

export function DesktopWallpaper(props: Props): React.ReactNode {
  const preset = activeDesktopWallpaperPreset(props.wallpaper)
  if (!preset || !props.assetUrl) return null

  const src = props.assetUrl(preset.assetId)

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
          ...desktopWallpaperImageSx(preset.view),
        }}
      />
    </Box>
  )
}
