import * as React from 'react'
import { Box } from '@mui/material'
import { desktopWallpaperImageSx } from './desktopWallpaperImage'
import { activeDesktopWallpaperPreset } from './desktopWallpaperPresets'
import type { DesktopWallpaper } from './types'

type Props = {
  assetUrl?(assetId: string): string
  wallpaper?: DesktopWallpaper
}

export function DesktopWallpaper(props: Props): React.ReactNode {
  const preset = activeDesktopWallpaperPreset(props.wallpaper)
  if (!props.assetUrl || !preset) return null

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
        src={props.assetUrl(preset.assetId)}
        alt=""
        draggable={false}
        decoding="async"
        loading="eager"
        sx={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          ...desktopWallpaperImageSx(preset.view),
        }}
      />
    </Box>
  )
}
