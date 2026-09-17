import type { DesktopWallpaper, DesktopWallpaperPreset, DesktopWallpaperView } from './types'

export const DEFAULT_DESKTOP_WALLPAPER_VIEW: DesktopWallpaperView = { x: 50, y: 50, scale: 1 }

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function roundNumber(value: number, precision = 2): number {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

export function normalizeDesktopWallpaperView(view: Partial<DesktopWallpaperView> | null | undefined): DesktopWallpaperView {
  return {
    x: roundNumber(clampNumber(Number(view?.x ?? DEFAULT_DESKTOP_WALLPAPER_VIEW.x), 0, 100)),
    y: roundNumber(clampNumber(Number(view?.y ?? DEFAULT_DESKTOP_WALLPAPER_VIEW.y), 0, 100)),
    scale: roundNumber(clampNumber(Number(view?.scale ?? DEFAULT_DESKTOP_WALLPAPER_VIEW.scale), 1, 4)),
  }
}

export function createDesktopWallpaperPreset(input: { id: string; name: string; assetId: string; view?: Partial<DesktopWallpaperView> }): DesktopWallpaperPreset {
  return {
    id: input.id,
    name: input.name.trim(),
    assetId: input.assetId,
    view: normalizeDesktopWallpaperView(input.view),
  }
}

export function activeDesktopWallpaperPreset(wallpaper: DesktopWallpaper | null | undefined): DesktopWallpaperPreset | null {
  if (!wallpaper?.activeId) return null
  return wallpaper.presets.find(preset => preset.id === wallpaper.activeId) || null
}

export function upsertDesktopWallpaperPresetView(wallpaper: DesktopWallpaper, presetId: string, view: DesktopWallpaperView): DesktopWallpaper {
  return {
    ...wallpaper,
    presets: wallpaper.presets.map(preset => preset.id === presetId ? { ...preset, view: normalizeDesktopWallpaperView(view) } : preset),
  }
}
