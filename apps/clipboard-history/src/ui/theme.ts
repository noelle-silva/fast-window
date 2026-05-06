import { createTheme } from '@mui/material/styles'

export const clipboardHistoryTheme = createTheme({
  palette: {
    mode: 'light',
    background: {
      default: '#FAFAFA',
      paper: '#FFFFFF',
    },
    primary: {
      main: '#1976D2',
    },
    secondary: {
      main: '#006DFF',
    },
    error: {
      main: '#D32F2F',
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
      },
      styleOverrides: {
        root: {
          textTransform: 'none',
          minHeight: 30,
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        size: 'small',
      },
    },
  },
})
