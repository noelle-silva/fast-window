import { normalizeDesktopWallpaperView } from './desktopWallpaperPresets'
import type { DesktopWallpaperView } from './types'

export function desktopWallpaperImageSx(view: DesktopWallpaperView) {
  const normalized = normalizeDesktopWallpaperView(view)
  return {
    objectFit: 'cover',
    objectPosition: `${normalized.x}% ${normalized.y}%`,
    transform: `scale(${normalized.scale})`,
    transformOrigin: `${normalized.x}% ${normalized.y}%`,
    userSelect: 'none',
  } as const
}
