import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { DEFAULT_WALLPAPER_VIEW, type WallpaperSettings, type WallpaperView } from '../wallpaper'

export type HostSurfaceMode = 'solid' | 'glass'

export type HostAppearance = {
  wallpaper: WallpaperSettings | null
  glassEnabled: boolean
  surfaceMode: HostSurfaceMode
  wallpaperUrl: string
  wallpaperView: WallpaperView
  titlebarOpacity: number
  titlebarBlur: number
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const next = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.max(min, Math.min(max, next))
}

function resolveWallpaperView(wallpaper: WallpaperSettings | null): WallpaperView {
  const view = wallpaper?.view || null
  return {
    x: clampNumber(view?.x, DEFAULT_WALLPAPER_VIEW.x, 0, 100),
    y: clampNumber(view?.y, DEFAULT_WALLPAPER_VIEW.y, 0, 100),
    scale: clampNumber(view?.scale, DEFAULT_WALLPAPER_VIEW.scale, 1, 4),
  }
}

export function createHostAppearance(wallpaper: WallpaperSettings | null): HostAppearance {
  const glassEnabled = wallpaper?.enabled === true && !!wallpaper.filePath
  return {
    wallpaper,
    glassEnabled,
    surfaceMode: glassEnabled ? 'glass' : 'solid',
    wallpaperUrl: glassEnabled ? `${convertFileSrc('wallpaper', 'wallpaper')}?rev=${wallpaper.rev ?? 0}` : '',
    wallpaperView: resolveWallpaperView(wallpaper),
    titlebarOpacity: clampNumber(wallpaper?.titlebarOpacity, 0.62, 0, 1),
    titlebarBlur: clampNumber(wallpaper?.titlebarBlur, 12, 0, 40),
  }
}

export function useHostAppearanceValue(wallpaper: WallpaperSettings | null): HostAppearance {
  return useMemo(() => createHostAppearance(wallpaper), [wallpaper])
}

const HostAppearanceContext = createContext<HostAppearance | null>(null)

export function HostAppearanceProvider({ value, children }: { value: HostAppearance; children: ReactNode }) {
  return <HostAppearanceContext.Provider value={value}>{children}</HostAppearanceContext.Provider>
}

export function useHostAppearance(): HostAppearance {
  const appearance = useContext(HostAppearanceContext)
  if (!appearance) throw new Error('HostAppearanceProvider is required')
  return appearance
}
