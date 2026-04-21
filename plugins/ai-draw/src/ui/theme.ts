import { createTheme } from '@mui/material/styles'

export function createClaudeTheme() {
  return createTheme({
    palette: {
      mode: 'light',
      primary: { main: '#c96442' },
      background: { default: '#f5f4ed', paper: '#faf9f5' },
      text: { primary: '#141413', secondary: '#5e5d59' },
      divider: '#e8e6dc',
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily:
        'system-ui,-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC","Noto Sans CJK SC",Roboto,Arial,sans-serif',
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            border: '1px solid #f0eee6',
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            borderRadius: 12,
          },
        },
      },
    },
  })
}

