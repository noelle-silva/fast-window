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
  {
    id: 'solarized-paper',
    label: '日光羊皮纸',
    description: '暖纸底和青蓝点缀，低对比阅读感',
    source: 'Solarized inspired',
    colors: {
      mode: 'light',
      background: '#FDF6E3',
      paper: '#FFFBEA',
      input: '#EEE8D5',
      primary: '#0B6FA4',
      primaryDark: '#07557E',
      secondary: '#2AA198',
      error: '#DC322F',
      textPrimary: '#073642',
      textSecondary: '#586E75',
      hover: 'rgba(11, 111, 164, 0.09)',
      selected: 'rgba(42, 161, 152, 0.17)',
      focusRing: 'rgba(11, 111, 164, 0.24)',
      shadow: 'rgba(0, 43, 54, 0.12)',
    },
    swatches: ['#FDF6E3', '#EEE8D5', '#0B6FA4', '#2AA198', '#073642'],
  },
  {
    id: 'everforest-moss',
    label: '常青苔影',
    description: '森林绿暗色，温软不闷',
    source: 'Everforest',
    colors: {
      mode: 'dark',
      background: '#2D353B',
      paper: '#343F44',
      input: '#3D484D',
      primary: '#A7C080',
      primaryDark: '#83A598',
      secondary: '#83C092',
      error: '#E67E80',
      textPrimary: '#D3C6AA',
      textSecondary: '#A7B0A0',
      hover: 'rgba(211, 198, 170, 0.08)',
      selected: 'rgba(167, 192, 128, 0.18)',
      focusRing: 'rgba(167, 192, 128, 0.28)',
      shadow: 'rgba(0, 0, 0, 0.30)',
    },
    swatches: ['#2D353B', '#343F44', '#A7C080', '#83C092', '#D3C6AA'],
  },
  {
    id: 'gruvbox-ember',
    label: '复古琥珀',
    description: '棕黄复古终端感，厚实温暖',
    source: 'Gruvbox Material',
    colors: {
      mode: 'dark',
      background: '#1D2021',
      paper: '#32302F',
      input: '#3C3836',
      primary: '#D79921',
      primaryDark: '#B57614',
      secondary: '#B8BB26',
      error: '#FB4934',
      textPrimary: '#EBDBB2',
      textSecondary: '#D5C4A1',
      hover: 'rgba(235, 219, 178, 0.08)',
      selected: 'rgba(215, 153, 33, 0.20)',
      focusRing: 'rgba(215, 153, 33, 0.30)',
      shadow: 'rgba(0, 0, 0, 0.34)',
    },
    swatches: ['#1D2021', '#32302F', '#D79921', '#B8BB26', '#EBDBB2'],
  },
  {
    id: 'dracula-neon',
    label: '德古拉霓虹',
    description: '紫粉高亮，夜间更有戏剧感',
    source: 'Dracula',
    colors: {
      mode: 'dark',
      background: '#282A36',
      paper: '#343746',
      input: '#44475A',
      primary: '#BD93F9',
      primaryDark: '#9570D3',
      secondary: '#FF79C6',
      error: '#FF5555',
      textPrimary: '#F8F8F2',
      textSecondary: '#CFCFEA',
      hover: 'rgba(248, 248, 242, 0.08)',
      selected: 'rgba(255, 121, 198, 0.16)',
      focusRing: 'rgba(189, 147, 249, 0.30)',
      shadow: 'rgba(0, 0, 0, 0.32)',
    },
    swatches: ['#282A36', '#44475A', '#BD93F9', '#FF79C6', '#F8F8F2'],
  },
  {
    id: 'kanagawa-wave',
    label: '神奈川海浪',
    description: '墨蓝海面配金砂点缀，沉稳有东方感',
    source: 'Kanagawa',
    colors: {
      mode: 'dark',
      background: '#1F1F28',
      paper: '#2A2A37',
      input: '#223249',
      primary: '#7E9CD8',
      primaryDark: '#6A9589',
      secondary: '#E6C384',
      error: '#E46876',
      textPrimary: '#DCD7BA',
      textSecondary: '#C8C093',
      hover: 'rgba(220, 215, 186, 0.08)',
      selected: 'rgba(126, 156, 216, 0.18)',
      focusRing: 'rgba(126, 156, 216, 0.28)',
      shadow: 'rgba(0, 0, 0, 0.34)',
    },
    swatches: ['#1F1F28', '#223249', '#7E9CD8', '#E6C384', '#DCD7BA'],
  },
  {
    id: 'radix-graphite',
    label: '石墨鸢尾',
    description: '现代中性色底，干净利落的产品感',
    source: 'Radix Colors',
    colors: {
      mode: 'light',
      background: '#F9F9FB',
      paper: '#FFFFFF',
      input: '#F0F0F3',
      primary: '#3E63DD',
      primaryDark: '#2F4EB2',
      secondary: '#8E4EC6',
      error: '#E5484D',
      textPrimary: '#1C2024',
      textSecondary: '#60646C',
      hover: 'rgba(62, 99, 221, 0.08)',
      selected: 'rgba(142, 78, 198, 0.14)',
      focusRing: 'rgba(62, 99, 221, 0.22)',
      shadow: 'rgba(15, 23, 42, 0.10)',
    },
    swatches: ['#F9F9FB', '#FFFFFF', '#3E63DD', '#8E4EC6', '#1C2024'],
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
