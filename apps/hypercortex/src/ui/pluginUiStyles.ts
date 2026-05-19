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
        color: 'rgba(15,23,42,.76)',
        backgroundColor: 'rgba(15,23,42,.06)',
        '&:hover': {
          borderColor: 'transparent',
          backgroundColor: 'rgba(15,23,42,.10)',
        },
      },
    },
  },
  MuiOutlinedInput: {
    styleOverrides: {
      root: {
        borderRadius: 14,
        backgroundColor: 'rgba(15,23,42,.045)',
        transition: 'background-color 120ms ease, box-shadow 120ms ease',
        '&:hover': { backgroundColor: 'rgba(15,23,42,.065)' },
        '&.Mui-focused': {
          backgroundColor: 'rgba(25,118,210,.08)',
          boxShadow: '0 12px 28px rgba(25,118,210,.13)',
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
  boxShadow: '0 18px 46px rgba(15,23,42,.18)',
} satisfies SxProps<Theme>

export const menuDangerItemSx = {
  mt: 0.5,
  color: '#d32f2f',
  bgcolor: 'rgba(211,47,47,.05)',
  '&:hover': { bgcolor: 'rgba(211,47,47,.10)' },
} satisfies SxProps<Theme>

export const softButtonSx = {
  borderRadius: 999,
  textTransform: 'none',
  fontWeight: 900,
  color: 'rgba(15,23,42,.76)',
  bgcolor: 'rgba(15,23,42,.06)',
  boxShadow: 'none',
  '&:hover': {
    bgcolor: 'rgba(15,23,42,.10)',
    boxShadow: 'none',
  },
  '&.Mui-disabled': {
    bgcolor: 'rgba(15,23,42,.035)',
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
  color: '#b42318',
  bgcolor: 'rgba(211,47,47,.08)',
  boxShadow: 'none',
  '&:hover': {
    bgcolor: 'rgba(211,47,47,.14)',
    boxShadow: 'none',
  },
} satisfies SxProps<Theme>

export const floatingControlSx = {
  bgcolor: 'rgba(255,255,255,.95)',
  boxShadow: '0 10px 24px rgba(15,23,42,.12)',
  color: 'rgba(15,23,42,.66)',
  '&:hover': {
    bgcolor: '#fff',
    boxShadow: '0 14px 30px rgba(15,23,42,.16)',
  },
} satisfies SxProps<Theme>

export const darkFloatingControlSx = {
  bgcolor: 'rgba(0,0,0,.38)',
  color: 'rgba(255,255,255,.92)',
  boxShadow: '0 12px 28px rgba(0,0,0,.28)',
  backdropFilter: 'blur(10px)',
  '&:hover': {
    bgcolor: 'rgba(0,0,0,.54)',
    boxShadow: '0 16px 34px rgba(0,0,0,.34)',
  },
} satisfies SxProps<Theme>

export const softCardSx = {
  bgcolor: '#fff',
  boxShadow: '0 12px 30px rgba(15,23,42,.07)',
} satisfies SxProps<Theme>

export const softPanelSx = {
  bgcolor: 'rgba(15,23,42,.035)',
  boxShadow: '0 10px 26px rgba(15,23,42,.05)',
} satisfies SxProps<Theme>

export const softFocusSx = {
  outline: 'none',
  bgcolor: 'rgba(25,118,210,.08)',
  boxShadow: '0 12px 30px rgba(25,118,210,.14)',
} satisfies SxProps<Theme>
