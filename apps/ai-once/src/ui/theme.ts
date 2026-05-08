import { createTheme } from '@mui/material/styles'

export const aiOnceTheme = createTheme({
  palette: {
    mode: 'light',
    background: {
      default: '#F6F8FC',
      paper: '#FFFFFF',
    },
    primary: {
      main: '#2563EB',
      dark: '#1D4ED8',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#14B8A6',
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
    action: {
      hover: 'rgba(37, 99, 235, 0.08)',
      selected: 'rgba(37, 99, 235, 0.14)',
    },
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Microsoft YaHei', 'sans-serif'].join(','),
    fontSize: 13,
  },
  components: {
    MuiButton: {
      defaultProps: {
        size: 'small',
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          textTransform: 'none',
          minHeight: 32,
          fontWeight: 700,
        },
        contained: {
          boxShadow: 'none',
        },
      },
    },
    MuiIconButton: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiTextField: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: '#FFFFFF',
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(100, 116, 139, 0.22)',
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(37, 99, 235, 0.38)',
          },
          '&.Mui-focused': {
            boxShadow: '0 0 0 3px rgba(37, 99, 235, 0.16)',
          },
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
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 18,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 800,
        },
      },
    },
  },
})
