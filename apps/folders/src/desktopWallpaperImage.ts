import type { CSSProperties } from 'react'
import { normalizeDesktopWallpaperView } from './desktopWallpaperPresets'
import type { DesktopWallpaperView } from './types'

export function desktopWallpaperImageStyle(view: DesktopWallpaperView): CSSProperties {
  const normalized = normalizeDesktopWallpaperView(view)
  return {
    objectFit: 'cover',
    objectPosition: `${normalized.x}% ${normalized.y}%`,
    transform: `scale(${normalized.scale})`,
    transformOrigin: `${normalized.x}% ${normalized.y}%`,
    userSelect: 'none',
  }
}

export function desktopWallpaperImageSx(view: DesktopWallpaperView) {
  return desktopWallpaperImageStyle(view)
}
