import { alpha, createTheme } from '@mui/material/styles'

export const foldersTheme = createTheme({
  palette: {
    mode: 'light',
    background: {
      default: '#F6F8FB',
      paper: '#FFFFFF',
    },
    primary: {
      main: '#2563EB',
      dark: '#1D4ED8',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#0F766E',
    },
    error: {
      main: '#DC2626',
    },
    success: {
      main: '#16A34A',
    },
    warning: {
      main: '#D97706',
    },
    text: {
      primary: '#172033',
      secondary: '#64748B',
    },
    divider: 'rgba(100, 116, 139, 0.18)',
    action: {
      hover: 'rgba(37, 99, 235, 0.08)',
      selected: 'rgba(37, 99, 235, 0.14)',
    },
  },
  shape: {
    borderRadius: 14,
  },
  typography: {
    fontFamily: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Microsoft YaHei', 'sans-serif'].join(','),
    fontSize: 13,
    h1: { fontSize: 17, fontWeight: 900, letterSpacing: '-0.02em' },
    h2: { fontSize: 15, fontWeight: 900, letterSpacing: '-0.01em' },
    h3: { fontSize: 13, fontWeight: 800 },
  },
  components: {
    MuiButton: {
      defaultProps: {
        size: 'small',
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          minHeight: 32,
          borderRadius: 10,
          fontWeight: 800,
          textTransform: 'none',
        },
      },
    },
    MuiIconButton: {
      defaultProps: { size: 'small' },
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: 10,
          color: theme.palette.text.secondary,
          '&:hover': { color: theme.palette.text.primary },
        }),
      },
    },
    MuiTextField: {
      defaultProps: {
        variant: 'filled',
        size: 'small',
      },
    },
    MuiFilledInput: {
      defaultProps: {
        disableUnderline: true,
      },
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: theme.palette.background.paper,
          borderRadius: 12,
          overflow: 'hidden',
          transition: 'box-shadow .16s ease, background-color .16s ease',
          '&:hover': { backgroundColor: theme.palette.background.paper },
          '&.Mui-focused': {
            boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.14)}`,
          },
        }),
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: '0 12px 34px rgba(15, 23, 42, 0.08)',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 18,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 800 },
      },
    },
  },
})
