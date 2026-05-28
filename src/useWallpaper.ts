import { useRef, useState, useCallback } from 'react'
import {
  addWallpaperImage,
  cycleWallpaper as cycleWallpaperCmd,
  DEFAULT_WALLPAPER_VIEW,
  getWallpaperSettings,
  removeWallpaperItem,
  setActiveWallpaper,
  setWallpaperSettings,
  setWallpaperView,
  type WallpaperSettings,
} from './wallpaper'

export function useWallpaper() {
  const [wallpaper, setWallpaper] = useState<WallpaperSettings | null>(null)
  const [switching, setSwitching] = useState(false)
  const switchingRef = useRef(false)

  const load = useCallback(async () => {
    try {
      const wp = await getWallpaperSettings()
      setWallpaper(wp)
    } catch (error) {
      console.warn('[wallpaper] failed to load settings:', error)
      setWallpaper(null)
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

  const updateSettings = useCallback(async (payload: {
    enabled: boolean
    opacity: number
    blur: number
    titlebarOpacity?: number
    titlebarBlur?: number
  }) => {
    const next = await setWallpaperSettings(payload)
    setWallpaper(next)
    window.dispatchEvent(new CustomEvent('fast-window:wallpaper-changed'))
    return next
  }, [])

  const addImage = useCallback(async (dataUrl: string) => {
    const next = await addWallpaperImage(dataUrl)
    setWallpaper(next)
    window.dispatchEvent(new CustomEvent('fast-window:wallpaper-changed'))
    return next
  }, [])

  const selectImage = useCallback(async (id: string) => {
    const next = await setActiveWallpaper(id)
    setWallpaper(next)
    window.dispatchEvent(new CustomEvent('fast-window:wallpaper-changed'))
    return next
  }, [])

  const removeImage = useCallback(async (id: string) => {
    const next = await removeWallpaperItem(id)
    setWallpaper(next)
    window.dispatchEvent(new CustomEvent('fast-window:wallpaper-changed'))
    return next
  }, [])

  const updateView = useCallback(async (payload: { id?: string | null; x: number; y: number; scale: number }) => {
    const next = await setWallpaperView(payload)
    setWallpaper(next)
    window.dispatchEvent(new CustomEvent('fast-window:wallpaper-changed'))
    return next
  }, [])

  return { wallpaper, switching, load, cycle, updateSettings, addImage, selectImage, removeImage, updateView, setWallpaper }
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
