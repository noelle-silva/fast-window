import { invoke } from '@tauri-apps/api/core'

export type WallpaperView = {
  x: number
  y: number
  scale: number
}

export const DEFAULT_WALLPAPER_VIEW: WallpaperView = { x: 50, y: 50, scale: 1 }

export type WallpaperItem = {
  id: string
  rev: number
}

export type WallpaperSettings = {
  enabled: boolean
  opacity: number
  blur: number
  titlebarOpacity: number
  titlebarBlur: number
  filePath?: string | null
  rev?: number
  items?: WallpaperItem[]
  activeId?: string | null
  view?: WallpaperView | null
}

export function getWallpaperSettings() {
  return invoke<WallpaperSettings>('get_wallpaper_settings')
}

export function setWallpaperSettings(payload: {
  enabled: boolean
  opacity: number
  blur: number
  titlebarOpacity?: number
  titlebarBlur?: number
}) {
  return invoke<WallpaperSettings>('set_wallpaper_settings', payload)
}

export function addWallpaperImage(dataUrl: string) {
  return invoke<WallpaperSettings>('set_wallpaper_image', { dataUrl })
}

export function removeAllWallpapers() {
  return invoke<WallpaperSettings>('remove_wallpaper')
}

export function setActiveWallpaper(id: string) {
  return invoke<WallpaperSettings>('set_active_wallpaper', { id })
}

export function removeWallpaperItem(id: string) {
  return invoke<WallpaperSettings>('remove_wallpaper_item', { id })
}

export function cycleWallpaper(delta: number) {
  return invoke<WallpaperSettings>('cycle_wallpaper', { delta })
}

export function setWallpaperView(payload: { id?: string | null; x: number; y: number; scale: number }) {
  return invoke<WallpaperSettings>('set_wallpaper_view', payload)
}
