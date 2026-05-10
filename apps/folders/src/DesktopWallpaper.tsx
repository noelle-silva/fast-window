import * as React from 'react'
import { Box } from '@mui/material'
import { desktopWallpaperImageSx } from './desktopWallpaperImage'
import { activeDesktopWallpaperPreset } from './desktopWallpaperPresets'
import type { CollectionCategoryId, DesktopWallpaperDeck as DesktopWallpaperDeckState } from './types'

type Props = {
  activeCategoryId: CollectionCategoryId
  assetUrl?(assetId: string): string
  deck?: DesktopWallpaperDeckState | null
}

export function DesktopWallpaper(props: Props): React.ReactNode {
  if (!props.assetUrl || !props.deck?.categories.length) return null

  const layers = props.deck.categories
    .map(category => ({ categoryId: category.categoryId, preset: activeDesktopWallpaperPreset(category.wallpaper) }))
    .filter((layer): layer is { categoryId: CollectionCategoryId; preset: NonNullable<typeof layer.preset> } => Boolean(layer.preset))

  if (!layers.length) return null

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
      {layers.map(layer => (
        <Box
          key={layer.categoryId}
          component="img"
          src={props.assetUrl?.(layer.preset.assetId)}
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
            opacity: layer.categoryId === props.activeCategoryId ? 1 : 0,
            transition: 'opacity 160ms ease',
            willChange: 'opacity',
            ...desktopWallpaperImageSx(layer.preset.view),
          }}
        />
      ))}
    </Box>
  )
}
