import * as React from 'react'
import { Box } from '@mui/material'
import { activeDesktopWallpaperPreset } from './desktopWallpaperPresets'
import { useDesktopWallpaperSurfaces, type DesktopWallpaperSurfaceSlot } from './useDesktopWallpaperSurfaces'
import type { CollectionViewCategoryId, DesktopWallpaperDeck as DesktopWallpaperDeckState } from './types'

type Props = {
  activeCategoryId: CollectionViewCategoryId
  assetUrl?(assetId: string): string
  deck?: DesktopWallpaperDeckState | null
}

export function DesktopWallpaper(props: Props): React.ReactNode {
  const [containerNode, setContainerNode] = React.useState<HTMLDivElement | null>(null)
  const frame = useWallpaperFrameSize(containerNode)

  const slots = React.useMemo<DesktopWallpaperSurfaceSlot[]>(() => {
    if (!props.assetUrl || !props.deck?.categories.length) return []
    const resolveUrl = props.assetUrl
    return props.deck.categories.flatMap(category => {
      const preset = activeDesktopWallpaperPreset(category.wallpaper)
      if (!preset) return []
      return [{ categoryId: category.categoryId, url: resolveUrl(preset.assetId), view: preset.view }]
    })
  }, [props.assetUrl, props.deck])

  const { setSurfaceCanvas } = useDesktopWallpaperSurfaces({
    slots,
    frameWidth: frame.width,
    frameHeight: frame.height,
    pixelRatio: frame.pixelRatio,
  })

  if (!slots.length) return null

  return (
    <Box
      ref={setContainerNode}
      aria-hidden="true"
      sx={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      {slots.map(slot => (
        <Box
          key={slot.categoryId}
          component="canvas"
          ref={setSurfaceCanvas(slot.categoryId)}
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            display: 'block',
            opacity: slot.categoryId === props.activeCategoryId ? 1 : 0,
            transition: 'opacity 160ms ease',
          }}
        />
      ))}
    </Box>
  )
}

function useWallpaperFrameSize(node: HTMLDivElement | null) {
  const [frame, setFrame] = React.useState(() => ({ width: 0, height: 0, pixelRatio: currentPixelRatio() }))

  React.useLayoutEffect(() => {
    if (!node) return undefined

    const update = () => {
      const next = {
        width: Math.max(0, node.clientWidth),
        height: Math.max(0, node.clientHeight),
        pixelRatio: currentPixelRatio(),
      }
      setFrame(current => current.width === next.width && current.height === next.height && current.pixelRatio === next.pixelRatio ? current : next)
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])

  return frame
}

function currentPixelRatio(): number {
  const ratio = Number(window.devicePixelRatio)
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1
}
