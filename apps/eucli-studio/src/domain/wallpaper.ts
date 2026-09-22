export type WallpaperView = {
  x: number
  y: number
  scale: number
}

export type WallpaperPreset = {
  id: string
  relPath: string
  view: WallpaperView
}

export type WallpaperSettings = {
  enabled: boolean
  activeId: string
  presets: WallpaperPreset[]
}

export const WALLPAPER_DIR = 'wallpapers'
export const WALLPAPER_MAX_EDGE = 2560
export const WALLPAPER_MIN_SCALE = 1
export const WALLPAPER_MAX_SCALE = 4
export const DEFAULT_WALLPAPER_VIEW: WallpaperView = { x: 50, y: 50, scale: 1 }

const WALLPAPER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const WALLPAPER_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])

export function createWallpaperId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function createWallpaperRelPath(id: string, ext: string): string {
  return `${WALLPAPER_DIR}/${String(id || '').trim()}.${String(ext || 'webp').trim().toLowerCase()}`
}

export function isWallpaperRelPath(raw: unknown): boolean {
  const parts = String(raw || '').trim().split('/')
  if (parts.length !== 2 || parts[0] !== WALLPAPER_DIR) return false
  const dot = parts[1].lastIndexOf('.')
  if (dot <= 0 || dot === parts[1].length - 1) return false
  return WALLPAPER_ID_PATTERN.test(parts[1].slice(0, dot)) && WALLPAPER_EXTENSIONS.has(parts[1].slice(dot + 1).toLowerCase())
}

export function clampWallpaperFocus(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(100, Math.max(0, n))
}

export function clampWallpaperScale(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(WALLPAPER_MAX_SCALE, Math.max(WALLPAPER_MIN_SCALE, n))
}

// 壁纸启用即代表聊天背景按透明模式渲染，这里给出统一的“白纱”浓度（0-1）。
export function wallpaperVeilAlpha(chatBgOpacity: unknown, chatBgBlur: unknown): number {
  const opacity = Math.min(100, Math.max(0, Number(chatBgOpacity) || 0))
  const blur = Math.min(24, Math.max(0, Number(chatBgBlur) || 0))
  return Math.max(opacity / 100, blur > 0 ? 0.01 : 0)
}

export function normalizeWallpaperView(raw: unknown): WallpaperView {
  const box = raw && typeof raw === 'object' ? (raw as any) : {}
  return {
    x: clampWallpaperFocus(box.x, DEFAULT_WALLPAPER_VIEW.x),
    y: clampWallpaperFocus(box.y, DEFAULT_WALLPAPER_VIEW.y),
    scale: clampWallpaperScale(box.scale, DEFAULT_WALLPAPER_VIEW.scale),
  }
}

export function defaultWallpaperSettings(): WallpaperSettings {
  return { enabled: false, activeId: '', presets: [] }
}

export function normalizeWallpaperSettings(raw: unknown): WallpaperSettings {
  const box = raw && typeof raw === 'object' ? (raw as any) : {}
  const presets: WallpaperPreset[] = []
  const seen = new Set<string>()

  if (Array.isArray(box.presets)) {
    for (const item of box.presets) {
      const preset = item && typeof item === 'object' ? (item as any) : null
      const id = String(preset?.id || '').trim()
      const relPath = String(preset?.relPath || '').trim()
      if (!preset || !WALLPAPER_ID_PATTERN.test(id) || !isWallpaperRelPath(relPath) || seen.has(id)) continue
      seen.add(id)
      presets.push({ id, relPath, view: normalizeWallpaperView(preset.view) })
    }
  }

  const activeId = String(box.activeId || '').trim()
  return {
    enabled: box.enabled === true && presets.length > 0,
    activeId: seen.has(activeId) ? activeId : String(presets[0]?.id || ''),
    presets,
  }
}
