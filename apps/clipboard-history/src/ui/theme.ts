import { createTheme } from '@mui/material/styles'
import { DEFAULT_THEME_ID } from '../shared/constants'
import type { ClipboardHistoryThemeId } from '../shared/types'

type ThemeColors = {
  mode: 'light' | 'dark'
  background: string
  paper: string
  input: string
  primary: string
  primaryDark: string
  secondary: string
  error: string
  textPrimary: string
  textSecondary: string
  hover: string
  selected: string
  focusRing: string
  shadow: string
}

export type ClipboardHistoryThemePreset = {
  id: ClipboardHistoryThemeId
  label: string
  description: string
  source: string
  colors: ThemeColors
  swatches: string[]
}

export const CLIPBOARD_HISTORY_THEME_PRESETS: ClipboardHistoryThemePreset[] = [
  {
    id: 'calm-blue',
    label: '清爽蓝雾',
    description: '干净明亮，延续当前默认观感',
    source: '默认清爽风格',
    colors: {
      mode: 'light',
      background: '#F6F8FC',
      paper: '#FFFFFF',
      input: '#FFFFFF',
      primary: '#1976D2',
      primaryDark: '#1256A3',
      secondary: '#006DFF',
      error: '#D32F2F',
      textPrimary: '#172033',
      textSecondary: '#5E6A7D',
      hover: 'rgba(25, 118, 210, 0.08)',
      selected: 'rgba(25, 118, 210, 0.14)',
      focusRing: 'rgba(25, 118, 210, 0.22)',
      shadow: 'rgba(15, 23, 42, 0.08)',
    },
    swatches: ['#F6F8FC', '#FFFFFF', '#1976D2', '#006DFF', '#172033'],
  },
  {
    id: 'catppuccin-latte',
    label: '奶油拿铁',
    description: '柔和粉蓝，适合白天长时间使用',
    source: 'Catppuccin Latte',
    colors: {
      mode: 'light',
      background: '#EFF1F5',
      paper: '#F9FAFC',
      input: '#F7F8FB',
      primary: '#1E66F5',
      primaryDark: '#174FBF',
      secondary: '#8839EF',
      error: '#D20F39',
      textPrimary: '#4C4F69',
      textSecondary: '#6C6F85',
      hover: 'rgba(30, 102, 245, 0.09)',
      selected: 'rgba(114, 135, 253, 0.18)',
      focusRing: 'rgba(30, 102, 245, 0.24)',
      shadow: 'rgba(76, 79, 105, 0.12)',
    },
    swatches: ['#EFF1F5', '#F9FAFC', '#1E66F5', '#8839EF', '#4C4F69'],
  },
  {
    id: 'rose-pine-dawn',
    label: '玫瑰晨雾',
    description: '暖米色底，读起来更柔软',
    source: 'Rose Pine Dawn',
    colors: {
      mode: 'light',
      background: '#FAF4ED',
      paper: '#FFFAF3',
      input: '#F2E9E1',
      primary: '#286983',
      primaryDark: '#1F5367',
      secondary: '#907AA9',
      error: '#B4637A',
      textPrimary: '#575279',
      textSecondary: '#797593',
      hover: 'rgba(40, 105, 131, 0.09)',
      selected: 'rgba(40, 105, 131, 0.16)',
      focusRing: 'rgba(40, 105, 131, 0.24)',
      shadow: 'rgba(87, 82, 121, 0.12)',
    },
    swatches: ['#FAF4ED', '#FFFAF3', '#286983', '#907AA9', '#575279'],
  },
  {
    id: 'nord-night',
    label: '极夜冰蓝',
    description: '冷静暗色，夜间不刺眼',
    source: 'Nord',
    colors: {
      mode: 'dark',
      background: '#2E3440',
      paper: '#3B4252',
      input: '#434C5E',
      primary: '#88C0D0',
      primaryDark: '#5E81AC',
      secondary: '#8FBCBB',
      error: '#BF616A',
      textPrimary: '#ECEFF4',
      textSecondary: '#D8DEE9',
      hover: 'rgba(216, 222, 233, 0.08)',
      selected: 'rgba(136, 192, 208, 0.18)',
      focusRing: 'rgba(136, 192, 208, 0.26)',
      shadow: 'rgba(0, 0, 0, 0.28)',
    },
    swatches: ['#2E3440', '#3B4252', '#88C0D0', '#8FBCBB', '#ECEFF4'],
  },
  {
    id: 'catppuccin-mocha',
    label: '摩卡夜色',
    description: '低饱和暗色，柔和但有层次',
    source: 'Catppuccin Mocha',
    colors: {
      mode: 'dark',
      background: '#1E1E2E',
      paper: '#313244',
      input: '#45475A',
      primary: '#89B4FA',
      primaryDark: '#74C7EC',
      secondary: '#CBA6F7',
      error: '#F38BA8',
      textPrimary: '#CDD6F4',
      textSecondary: '#BAC2DE',
      hover: 'rgba(205, 214, 244, 0.08)',
      selected: 'rgba(137, 180, 250, 0.18)',
      focusRing: 'rgba(137, 180, 250, 0.26)',
      shadow: 'rgba(0, 0, 0, 0.32)',
    },
    swatches: ['#1E1E2E', '#313244', '#89B4FA', '#CBA6F7', '#CDD6F4'],
  },
]

export function getClipboardHistoryThemePreset(themeId: unknown): ClipboardHistoryThemePreset {
  return CLIPBOARD_HISTORY_THEME_PRESETS.find((preset) => preset.id === themeId) || CLIPBOARD_HISTORY_THEME_PRESETS.find((preset) => preset.id === DEFAULT_THEME_ID)!
}

export function createClipboardHistoryTheme(themeId: unknown = DEFAULT_THEME_ID) {
  const preset = getClipboardHistoryThemePreset(themeId)
  const colors = preset.colors

  return createTheme({
    palette: {
      mode: colors.mode,
      background: {
        default: colors.background,
        paper: colors.paper,
      },
      primary: {
        main: colors.primary,
        dark: colors.primaryDark,
        contrastText: colors.mode === 'dark' ? '#172033' : '#FFFFFF',
      },
      secondary: {
        main: colors.secondary,
      },
      error: {
        main: colors.error,
      },
      text: {
        primary: colors.textPrimary,
        secondary: colors.textSecondary,
      },
      action: {
        hover: colors.hover,
        selected: colors.selected,
      },
    },
    shape: {
      borderRadius: 10,
    },
    typography: {
      fontFamily: [
        'Inter',
        'system-ui',
        '-apple-system',
        'BlinkMacSystemFont',
        'Segoe UI',
        'sans-serif',
      ].join(','),
      fontSize: 13,
    },
    components: {
      MuiButton: {
        defaultProps: {
          size: 'small',
          variant: 'text',
          disableElevation: true,
        },
        styleOverrides: {
          root: {
            textTransform: 'none',
            minHeight: 30,
          },
          contained: {
            boxShadow: 'none',
          },
        },
      },
      MuiTextField: {
        defaultProps: {
          size: 'small',
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            border: 0,
          },
          outlined: {
            border: 0,
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: colors.input,
            '& .MuiOutlinedInput-notchedOutline': {
              border: 0,
            },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              border: 0,
            },
            '&.Mui-focused': {
              boxShadow: `0 0 0 3px ${colors.focusRing}`,
            },
            '&.Mui-disabled': {
              backgroundColor: colors.selected,
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            border: 0,
          },
          outlined: {
            border: 0,
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: 10,
          },
          outlined: {
            border: 0,
          },
        },
      },
    },
  })
}

export const clipboardHistoryTheme = createClipboardHistoryTheme(DEFAULT_THEME_ID)
