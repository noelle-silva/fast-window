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
        defaultProps: {
          disableElevation: true,
        },
        styleOverrides: {
          root: {
            textTransform: 'none',
            borderRadius: 12,
            boxShadow: 'none',
          },
          contained: {
            boxShadow: 'none',
          },
          outlined: {
            // 设计风格：看起来是“有底色”的按钮，但不显示描边。
            border: 0,
            backgroundColor: '#f0eee6',
            '&:hover': {
              border: 0,
              backgroundColor: '#e8e6dc',
            },
          },
          outlinedPrimary: {
            border: 0,
            backgroundColor: 'rgba(201,100,66,0.14)',
            '&:hover': {
              border: 0,
              backgroundColor: 'rgba(201,100,66,0.20)',
            },
          },
          outlinedError: {
            border: 0,
            backgroundColor: 'rgba(211,47,47,0.12)',
            '&:hover': {
              border: 0,
              backgroundColor: 'rgba(211,47,47,0.18)',
            },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            backgroundColor: '#ffffff',
            '& .MuiOutlinedInput-notchedOutline': {
              border: 0,
            },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              border: 0,
            },
            '&.Mui-focused': {
              boxShadow: '0 0 0 2px rgba(201,100,66,0.22)',
            },
            '&.Mui-disabled': {
              backgroundColor: '#f5f4ed',
            },
          },
        },
      },
    },
  })
}
