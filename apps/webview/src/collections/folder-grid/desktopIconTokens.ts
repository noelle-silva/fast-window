export type DesktopIconPalette = {
  surface: string
  foreground: string
  shadow: string
}

export const DESKTOP_ICON_SURFACE_SIZE = 88
export const DESKTOP_ICON_SURFACE_RADIUS = 26
export const DESKTOP_ICON_TITLE_SHADOW = '0 1px 2px rgba(15, 23, 42, 0.92), 0 3px 10px rgba(15, 23, 42, 0.62)'
export const DESKTOP_ICON_DRAG_SHADOW = '0 26px 46px rgba(15, 23, 42, 0.28)'

export const DESKTOP_ICON_COLORS = [
  '#8FA99B',
  '#8FA6B8',
  '#A79AB4',
  '#B7A38C',
  '#A9A18E',
  '#9AA38F',
  '#A08F8F',
  '#8F9FA3',
] as const

const DESKTOP_ICON_PALETTES: DesktopIconPalette[] = DESKTOP_ICON_COLORS.map(color => ({
  surface: color,
  foreground: '#F8FAFC',
  shadow: '0 16px 34px rgba(15, 23, 42, 0.20)',
}))

export function getDesktopIconPalette(seed: string, color?: string): DesktopIconPalette {
  const normalizedColor = color?.toUpperCase()
  if (normalizedColor && DESKTOP_ICON_COLORS.includes(normalizedColor as (typeof DESKTOP_ICON_COLORS)[number])) {
    return { surface: normalizedColor, foreground: '#F8FAFC', shadow: '0 16px 34px rgba(15, 23, 42, 0.20)' }
  }

  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0
  }

  return DESKTOP_ICON_PALETTES[Math.abs(hash) % DESKTOP_ICON_PALETTES.length]
}
