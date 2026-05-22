import { alpha, type Theme } from '@mui/material/styles'

export type HostSurfaceSx = (theme: Theme) => object

type HostSurfaceTone = 'panel' | 'toolbar' | 'item' | 'field' | 'notice'

type HostSurfaceOptions = {
  tone?: HostSurfaceTone
  dense?: boolean
}

const SURFACE_RADIUS = {
  panel: 3,
  toolbar: 3,
  item: 2.5,
  field: 2.25,
  notice: 2.5,
} as const satisfies Record<HostSurfaceTone, number>

const SURFACE_PADDING = {
  panel: { px: 1.5, py: 1.35 },
  toolbar: { px: 1, py: 0.75 },
  item: { px: 1.15, py: 1 },
  field: { px: 1, py: 0.75 },
  notice: { px: 1.15, py: 1 },
} as const satisfies Record<HostSurfaceTone, { px: number; py: number }>

function surfaceBackground(theme: Theme, wallpaperEnabled: boolean, tone: HostSurfaceTone) {
  if (wallpaperEnabled) {
    const opacity = tone === 'item' ? 0.52 : tone === 'toolbar' ? 0.58 : 0.64
    return alpha(theme.palette.background.paper, opacity)
  }

  if (tone === 'panel') return alpha(theme.palette.background.paper, 0.94)
  if (tone === 'toolbar') return alpha(theme.palette.action.hover, 0.7)
  if (tone === 'field') return alpha(theme.palette.action.hover, 0.72)
  if (tone === 'notice') return alpha(theme.palette.action.selected, 0.78)
  return alpha(theme.palette.action.hover, 0.62)
}

export function hostSurfaceSx(wallpaperEnabled: boolean, options: HostSurfaceOptions = {}): HostSurfaceSx {
  const tone = options.tone ?? 'panel'
  const padding = SURFACE_PADDING[tone]

  return theme => ({
    borderRadius: SURFACE_RADIUS[tone],
    px: options.dense ? Math.max(0.75, padding.px - 0.25) : padding.px,
    py: options.dense ? Math.max(0.5, padding.py - 0.25) : padding.py,
    bgcolor: surfaceBackground(theme, wallpaperEnabled, tone),
    backdropFilter: wallpaperEnabled ? 'blur(12px)' : undefined,
    boxShadow: wallpaperEnabled
      ? `0 12px 34px ${alpha(theme.palette.common.black, 0.07)}`
      : tone === 'panel'
        ? `0 10px 28px ${alpha(theme.palette.common.black, 0.045)}`
        : 'none',
  })
}

export const hostPageRootSx = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
} as const

export const hostPageScrollSx = {
  p: 2,
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  boxSizing: 'border-box',
} as const

export const hostButtonSx = {
  borderRadius: 999,
  boxShadow: 'none',
  textTransform: 'none',
  '&.MuiButton-text': {
    bgcolor: (theme: Theme) => alpha(theme.palette.text.primary, 0.06),
    color: 'text.primary',
    '&:hover': { bgcolor: (theme: Theme) => alpha(theme.palette.text.primary, 0.1) },
  },
  '&.MuiButton-contained': {
    boxShadow: 'none',
    '&:hover': { boxShadow: 'none' },
  },
} as const

export const hostDangerButtonSx = {
  ...hostButtonSx,
  '&.MuiButton-text': {
    bgcolor: (theme: Theme) => alpha(theme.palette.error.main, 0.09),
    color: 'error.main',
    '&:hover': { bgcolor: (theme: Theme) => alpha(theme.palette.error.main, 0.14) },
  },
} as const

export const hostTextFieldSx = {
  '& .MuiOutlinedInput-root': {
    borderRadius: 2.25,
    bgcolor: (theme: Theme) => alpha(theme.palette.text.primary, 0.055),
    '& .MuiOutlinedInput-notchedOutline': { border: 0 },
    '&:hover .MuiOutlinedInput-notchedOutline': { border: 0 },
    '&.Mui-focused': {
      boxShadow: (theme: Theme) => `0 0 0 3px ${alpha(theme.palette.primary.main, 0.2)}`,
    },
  },
} as const

export const hostSelectSx = {
  borderRadius: 2.25,
  bgcolor: (theme: Theme) => alpha(theme.palette.text.primary, 0.055),
  '& .MuiOutlinedInput-notchedOutline': { border: 0 },
  '&:hover .MuiOutlinedInput-notchedOutline': { border: 0 },
  '&.Mui-focused': {
    boxShadow: (theme: Theme) => `0 0 0 3px ${alpha(theme.palette.primary.main, 0.2)}`,
  },
} as const

export const hostToggleGroupSx = {
  gap: 0.75,
  flexWrap: 'wrap',
  '& .MuiToggleButton-root': {
    border: 0,
    borderRadius: '999px !important',
    px: 1.25,
    bgcolor: (theme: Theme) => alpha(theme.palette.text.primary, 0.055),
    '&:hover': { bgcolor: (theme: Theme) => alpha(theme.palette.text.primary, 0.09) },
    '&.Mui-selected': {
      bgcolor: (theme: Theme) => alpha(theme.palette.primary.main, 0.14),
      color: 'primary.main',
      '&:hover': { bgcolor: (theme: Theme) => alpha(theme.palette.primary.main, 0.2) },
    },
  },
} as const

export const hostTabsSx = {
  minHeight: 40,
  '& .MuiTabs-indicator': { display: 'none' },
  '& .MuiTab-root': {
    minHeight: 36,
    borderRadius: 999,
    textTransform: 'none',
    mx: 0.25,
    color: 'text.secondary',
    '&.Mui-selected': {
      bgcolor: (theme: Theme) => alpha(theme.palette.primary.main, 0.14),
      color: 'primary.main',
    },
  },
} as const

export const hostSoftChipSx = {
  border: 0,
  bgcolor: (theme: Theme) => alpha(theme.palette.text.primary, 0.07),
  color: 'text.secondary',
} as const
