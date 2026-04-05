import * as React from 'react'
import { AppBar, Box, CssBaseline, GlobalStyles, IconButton, ThemeProvider, Toolbar, Tooltip, Typography, createTheme } from '@mui/material'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import HomeRoundedIcon from '@mui/icons-material/HomeRounded'
import { getApi } from '../core'

type PageId = 'home'

const theme = createTheme({
  palette: {
    mode: 'light',
    background: { default: '#ffffff', paper: '#ffffff' },
  },
  typography: {
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
  },
})

function isInteractiveTarget(target: EventTarget | null): boolean {
  const t = target as any
  if (!t || typeof t.closest !== 'function') return false
  return !!t.closest('button, a, input, textarea, select, [role="button"]')
}

export function HyperCortexApp() {
  const api = React.useMemo(() => getApi(), [])
  const [page, setPage] = React.useState<PageId>('home')

  const backToHost = React.useCallback(() => {
    try {
      if (typeof api.ui?.back === 'function') return void api.ui.back()
      if (typeof api.host?.back === 'function') return void api.host.back()
      return void api.ui?.showToast?.('无法返回')
    } catch (e: any) {
      api.ui?.showToast?.(String(e?.message || e))
    }
  }, [api])

  const onTopbarPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      if (isInteractiveTarget(e.target)) return
      api.ui?.startDragging?.()
    },
    [api],
  )

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles
        styles={{
          html: { height: '100%' },
          body: { height: '100%', margin: 0, backgroundColor: '#fff' },
          '#app': { height: '100%' },
        }}
      />

      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#fff' }}>
        <AppBar position="static" elevation={0} sx={{ bgcolor: '#fff', color: 'text.primary' }}>
          <Toolbar
            variant="dense"
            data-tauri-drag-region="true"
            sx={{
              gap: 0.5,
              minHeight: 40,
              px: 1,
              '&.MuiToolbar-root': { minHeight: 40 },
              WebkitAppRegion: 'drag',
            }}
            onPointerDown={onTopbarPointerDown}
          >
            <Tooltip title="返回主界面">
              <IconButton
                onClick={backToHost}
                size="small"
                aria-label="返回主界面"
                data-tauri-drag-region="false"
                sx={{ WebkitAppRegion: 'no-drag' }}
              >
                <ArrowBackRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
              HyperCortex
            </Typography>

            <Box sx={{ flex: 1 }} />
          </Toolbar>
        </AppBar>

        <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <Box
            sx={{
              width: 52,
              py: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 0.5,
            }}
          >
            <Tooltip title="主页">
              <IconButton
                size="small"
                aria-label="主页"
                onClick={() => setPage('home')}
                sx={{
                  borderRadius: 2,
                  bgcolor: page === 'home' ? 'rgba(25,118,210,.10)' : 'transparent',
                  '&:hover': { bgcolor: page === 'home' ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
                }}
              >
                <HomeRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>

          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, p: 2 }}>
            {page === 'home' ? (
              <Typography color="text.secondary">主页（占位）。下一步按你的指挥继续搭 UI。</Typography>
            ) : null}
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  )
}
