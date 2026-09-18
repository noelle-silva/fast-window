import { createTheme } from '@mui/material'
import type { ColorThemePreset } from '../domain/colorTheme'

const STUDIO_MAIN_BACKGROUND = '#fff'

export function colorThemeCssVariables(preset: ColorThemePreset) {
  const colors = preset.colors
  return {
    '--studio-canvas': STUDIO_MAIN_BACKGROUND,
    '--studio-paper': colors.paper,
    '--studio-paper-muted': colors.paperMuted,
    '--studio-paper-strong': colors.paperStrong,
    '--studio-app-background': STUDIO_MAIN_BACKGROUND,
    '--studio-topbar': colors.topbar,
    '--studio-composer': colors.composer,
    '--studio-field': colors.field,
    '--studio-field-hover': colors.fieldHover,
    '--studio-field-focus': colors.fieldFocus,
    '--studio-primary': colors.primary,
    '--studio-primary-hover': colors.primaryHover,
    '--studio-primary-soft': colors.primarySoft,
    '--studio-secondary': colors.secondary,
    '--studio-secondary-soft': colors.secondarySoft,
    '--studio-accent': colors.accent,
    '--studio-text-primary': colors.textPrimary,
    '--studio-text-secondary': colors.textSecondary,
    '--studio-border': colors.border,
    '--studio-shadow-soft': colors.shadowSoft,
    '--studio-shadow-strong': colors.shadowStrong,
    '--studio-focus': colors.focus,
    '--studio-code-background': colors.codeBackground,
    '--studio-code-text': colors.codeText,
    '--studio-success': colors.success,
    '--studio-danger': colors.danger,
    '--studio-warning': colors.warning,
  }
}

export function colorMixVar(cssVar: string, percent: number) {
  return `color-mix(in srgb, var(${cssVar}) ${Math.round(percent)}%, transparent)`
}

export function createStudioMuiTheme(preset: ColorThemePreset) {
  return createTheme({
    palette: {
      mode: preset.mode,
      primary: { main: preset.colors.primary },
      secondary: { main: preset.colors.secondary },
      success: { main: preset.colors.success },
      error: { main: preset.colors.danger },
      warning: { main: preset.colors.warning },
      background: {
        default: STUDIO_MAIN_BACKGROUND,
        paper: preset.colors.paper,
      },
      text: {
        primary: preset.colors.textPrimary,
        secondary: preset.colors.textSecondary,
      },
      divider: preset.colors.border,
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily:
        'system-ui,-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC","Noto Sans CJK SC",Roboto,Arial,sans-serif',
    },
    components: {
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 24,
            color: 'var(--studio-text-primary)',
            background: 'var(--studio-paper)',
            boxShadow: 'var(--studio-shadow-strong)',
            backgroundImage: 'none',
            overflow: 'hidden',
            '& .MuiOutlinedInput-root': {
              borderRadius: 16,
              backgroundColor: 'var(--studio-field)',
              boxShadow: 'var(--studio-shadow-soft)',
              transition: 'background-color .16s ease, box-shadow .16s ease',
            },
            '& .MuiOutlinedInput-root .MuiOutlinedInput-notchedOutline': { border: 0 },
            '& .MuiOutlinedInput-root:hover': {
              backgroundColor: 'var(--studio-field-hover)',
              boxShadow: 'var(--studio-shadow-soft)',
            },
            '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': { border: 0 },
            '& .MuiOutlinedInput-root.Mui-focused': {
              backgroundColor: 'var(--studio-field-focus)',
              boxShadow: 'var(--studio-focus)',
            },
            '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': { border: 0 },
            '& .MuiInputLabel-root': { fontWeight: 700, color: 'var(--studio-text-secondary)' },
            '& .MuiInputLabel-root.Mui-focused': { color: 'var(--studio-primary)' },
            '& .MuiPaper-outlined': {
              border: 0,
              borderRadius: 20,
              backgroundColor: 'var(--studio-field)',
              boxShadow: 'var(--studio-shadow-soft)',
            },
            '& .MuiButton-outlined': {
              border: 0,
              backgroundColor: 'var(--studio-field)',
              boxShadow: 'var(--studio-shadow-soft)',
            },
            '& .MuiButton-outlined:hover': {
              border: 0,
              backgroundColor: 'var(--studio-field-hover)',
              boxShadow: 'var(--studio-shadow-soft)',
            },
            '& .MuiChip-outlined': {
              border: 0,
              backgroundColor: 'var(--studio-paper-muted)',
              fontWeight: 800,
            },
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: {
            padding: '20px 24px 12px',
            fontWeight: 900,
          },
        },
      },
      MuiDialogContent: {
        styleOverrides: {
          root: {
            backgroundColor: 'var(--studio-paper-muted)',
            '&.MuiDialogContent-dividers': {
              borderTop: 0,
              borderBottom: 0,
            },
          },
        },
      },
      MuiDialogActions: {
        styleOverrides: {
          root: {
            padding: '12px 24px 20px',
            backgroundColor: 'var(--studio-paper-muted)',
            gap: 8,
          },
        },
      },
      MuiPopover: {
        styleOverrides: {
          paper: {
            borderRadius: 24,
            color: 'var(--studio-text-primary)',
            background: 'var(--studio-paper)',
            boxShadow: 'var(--studio-shadow-strong)',
            overflow: 'hidden',
            '& .MuiOutlinedInput-root': {
              borderRadius: 18,
              backgroundColor: 'var(--studio-field)',
              boxShadow: 'var(--studio-shadow-soft)',
            },
            '& .MuiOutlinedInput-root .MuiOutlinedInput-notchedOutline': { border: 0 },
            '& .MuiOutlinedInput-root:hover': {
              backgroundColor: 'var(--studio-field-hover)',
              boxShadow: 'var(--studio-shadow-soft)',
            },
            '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': { border: 0 },
            '& .MuiOutlinedInput-root.Mui-focused': {
              backgroundColor: 'var(--studio-field-focus)',
              boxShadow: 'var(--studio-focus)',
            },
            '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': { border: 0 },
            '& .MuiTabs-indicator': { display: 'none' },
            '& .MuiTab-root': {
              borderRadius: 16,
              minHeight: 40,
              fontWeight: 800,
            },
            '& .MuiTab-root.Mui-selected': {
              backgroundColor: 'var(--studio-primary-soft)',
            },
          },
        },
      },
    },
  })
}
