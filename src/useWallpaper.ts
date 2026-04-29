import { useState, useCallback } from 'react'
import { cycleWallpaper as cycleWallpaperCmd, DEFAULT_WALLPAPER_VIEW, getWallpaperSettings, type WallpaperSettings } from './wallpaper'

export function useWallpaper() {
  const [wallpaper, setWallpaper] = useState<WallpaperSettings | null>(null)
  const [switching, setSwitching] = useState(false)
  const switchingRef = { current: false }

  const load = useCallback(async () => {
    try {
      const wp = await getWallpaperSettings()
      setWallpaper(wp)
    } catch (_) {
      setWallpaper({ enabled: false, opacity: 0.65, blur: 0, titlebarOpacity: 0.62, titlebarBlur: 12, filePath: null })
    }
  }, [])

  const cycle = useCallback(async (delta: number) => {
    if (switchingRef.current) return
    switchingRef.current = true
    setSwitching(true)
    try {
      const wp = await cycleWallpaperCmd(delta)
      setWallpaper(wp)
      window.dispatchEvent(new CustomEvent('fast-window:wallpaper-changed'))
    } catch (e) {
      console.warn('[wallpaper] failed to cycle:', e)
    } finally {
      switchingRef.current = false
      setSwitching(false)
    }
  }, [])

  return { wallpaper, switching, load, cycle }
}

export function getWallpaperView(wallpaper: WallpaperSettings | null) {
  const v: any = wallpaper?.view || null
  const x = typeof v?.x === 'number' ? v.x : DEFAULT_WALLPAPER_VIEW.x
  const y = typeof v?.y === 'number' ? v.y : DEFAULT_WALLPAPER_VIEW.y
  const scale = typeof v?.scale === 'number' ? v.scale : DEFAULT_WALLPAPER_VIEW.scale
  return {
    x: Math.max(0, Math.min(100, x)),
    y: Math.max(0, Math.min(100, y)),
    scale: Math.max(1, Math.min(4, scale)),
  }
}
