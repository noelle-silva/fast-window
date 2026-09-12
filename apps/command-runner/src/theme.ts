import { createTheme } from '@mui/material/styles'

export const commandRunnerTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
    },
    background: {
      default: '#f4f5f7',
      paper: '#ffffff',
    },
    text: {
      primary: '#111827',
      secondary: '#6b7280',
    },
    divider: 'rgba(0, 0, 0, 0.12)',
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
    button: {
      fontWeight: 800,
      textTransform: 'none',
    },
  },
  components: {
    MuiButton: {
      defaultProps: {
        variant: 'text',
      },
      styleOverrides: {
        root: {
          borderRadius: 999,
          boxShadow: 'none',
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        variant: 'filled',
      },
    },
    MuiFilledInput: {
      defaultProps: {
        disableUnderline: true,
      },
      styleOverrides: {
        root: {
          borderRadius: 10,
          backgroundColor: 'rgba(17, 24, 39, 0.05)',
          transition: 'background-color 120ms ease',
          '&:hover:not(.Mui-disabled)': {
            backgroundColor: 'rgba(17, 24, 39, 0.08)',
          },
          '&.Mui-focused': {
            backgroundColor: 'rgba(25, 118, 210, 0.10)',
          },
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        filled: {
          '&.MuiInputLabel-shrink': {
            backgroundColor: 'transparent',
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        colorDefault: {
          backgroundColor: 'rgba(17, 24, 39, 0.07)',
          color: '#374151',
        },
        colorPrimary: {
          backgroundColor: 'rgba(25, 118, 210, 0.12)',
          color: '#1565c0',
        },
        colorSuccess: {
          backgroundColor: 'rgba(46, 125, 50, 0.12)',
          color: '#2e7d32',
        },
        colorWarning: {
          backgroundColor: 'rgba(237, 108, 2, 0.14)',
          color: '#b26a00',
        },
        colorError: {
          backgroundColor: 'rgba(211, 47, 47, 0.12)',
          color: '#c62828',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          backgroundImage: 'none',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          boxShadow: 'none',
          backgroundImage: 'none',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
  },
})
