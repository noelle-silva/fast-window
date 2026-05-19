import type { SxProps, Theme, ThemeOptions } from '@mui/material/styles'

export const lineFreeComponentOverrides = {
  MuiButton: {
    styleOverrides: {
      root: {
        textTransform: 'none',
        boxShadow: 'none',
        '&:hover': { boxShadow: 'none' },
      },
      outlined: {
        borderColor: 'transparent',
        color: 'var(--hc-text-muted)',
        backgroundColor: 'var(--hc-surface-soft)',
        '&:hover': {
          borderColor: 'transparent',
          backgroundColor: 'var(--hc-surface-muted)',
        },
      },
    },
  },
  MuiOutlinedInput: {
    styleOverrides: {
      root: {
        borderRadius: 14,
        backgroundColor: 'var(--hc-surface-soft)',
        transition: 'background-color 120ms ease, box-shadow 120ms ease',
        '&:hover': { backgroundColor: 'var(--hc-surface-muted)' },
        '&.Mui-focused': {
          backgroundColor: 'var(--hc-primary-soft)',
          boxShadow: '0 12px 28px var(--hc-shadow)',
        },
      },
      notchedOutline: {
        borderColor: 'transparent',
      },
    },
  },
} satisfies ThemeOptions['components']

export const menuPaperSx = {
  borderRadius: 7,
  overflow: 'hidden',
  bgcolor: 'var(--hc-surface)',
  boxShadow: '0 18px 46px var(--hc-shadow-strong)',
} satisfies SxProps<Theme>

export const menuDangerItemSx = {
  mt: 0.5,
  color: 'var(--hc-danger)',
  bgcolor: 'var(--hc-danger-soft)',
  '&:hover': { bgcolor: 'var(--hc-accent-clay)' },
} satisfies SxProps<Theme>

export const softButtonSx = {
  borderRadius: 999,
  textTransform: 'none',
  fontWeight: 900,
  color: 'var(--hc-text-muted)',
  bgcolor: 'var(--hc-surface-soft)',
  boxShadow: 'none',
  '&:hover': {
    bgcolor: 'var(--hc-surface-muted)',
    boxShadow: 'none',
  },
  '&.Mui-disabled': {
    bgcolor: 'var(--hc-surface-soft)',
  },
} satisfies SxProps<Theme>

export const unstyledButtonSurfaceSx = {
  appearance: 'none',
  WebkitAppearance: 'none',
  border: 0,
  margin: 0,
  font: 'inherit',
  fontFamily: 'inherit',
  color: 'inherit',
  textTransform: 'none',
  textDecoration: 'none',
  outline: 'none',
  userSelect: 'none',
} satisfies SxProps<Theme>

export const softDangerButtonSx = {
  borderRadius: 999,
  textTransform: 'none',
  fontWeight: 900,
  color: 'var(--hc-danger)',
  bgcolor: 'var(--hc-danger-soft)',
  boxShadow: 'none',
  '&:hover': {
    bgcolor: 'var(--hc-accent-clay)',
    boxShadow: 'none',
  },
} satisfies SxProps<Theme>

export const floatingControlSx = {
  bgcolor: 'var(--hc-surface)',
  boxShadow: '0 10px 24px var(--hc-shadow)',
  color: 'var(--hc-text-muted)',
  '&:hover': {
    bgcolor: 'var(--hc-surface)',
    boxShadow: '0 14px 30px var(--hc-shadow-strong)',
  },
} satisfies SxProps<Theme>

export const darkFloatingControlSx = {
  bgcolor: 'var(--hc-text)',
  color: 'var(--hc-surface)',
  boxShadow: '0 12px 28px var(--hc-shadow-strong)',
  backdropFilter: 'blur(10px)',
  '&:hover': {
    bgcolor: 'var(--hc-text-muted)',
    boxShadow: '0 16px 34px var(--hc-shadow-strong)',
  },
} satisfies SxProps<Theme>

export const softCardSx = {
  bgcolor: 'var(--hc-surface)',
  boxShadow: '0 12px 30px var(--hc-shadow)',
} satisfies SxProps<Theme>

export const softPanelSx = {
  bgcolor: 'var(--hc-surface-soft)',
  boxShadow: '0 10px 26px var(--hc-shadow)',
} satisfies SxProps<Theme>

export const softFocusSx = {
  outline: 'none',
  bgcolor: 'var(--hc-primary-soft)',
  boxShadow: '0 12px 30px var(--hc-shadow)',
} satisfies SxProps<Theme>
