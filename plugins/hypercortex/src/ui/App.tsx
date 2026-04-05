import * as React from 'react'
import { AppBar, Box, CssBaseline, GlobalStyles, IconButton, InputBase, ThemeProvider, Toolbar, Tooltip, Typography, createTheme } from '@mui/material'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import HomeRoundedIcon from '@mui/icons-material/HomeRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded'
import NotesRoundedIcon from '@mui/icons-material/NotesRounded'
import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded'
import { getApi } from '../core'

type PageId = 'home' | 'new-note' | 'attachments' | 'all-notes' | 'index' | 'settings'

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
  const [newNoteTitle, setNewNoteTitle] = React.useState('新建笔记')
  const [newNoteContent, setNewNoteContent] = React.useState('')

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
            <IconButton
              onClick={backToHost}
              size="small"
              aria-label="返回主界面"
              data-tauri-drag-region="false"
              sx={{ WebkitAppRegion: 'no-drag' }}
            >
              <ArrowBackRoundedIcon fontSize="small" />
            </IconButton>

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
            <Tooltip title="主页" placement="right">
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

            <Tooltip title="新建笔记" placement="right">
              <IconButton
                size="small"
                aria-label="新建笔记"
                onClick={() => setPage('new-note')}
                sx={{
                  borderRadius: 2,
                  bgcolor: page === 'new-note' ? 'rgba(25,118,210,.10)' : 'transparent',
                  '&:hover': { bgcolor: page === 'new-note' ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
                }}
              >
                <AddRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title="索引" placement="right">
              <IconButton
                size="small"
                aria-label="索引"
                onClick={() => setPage('index')}
                sx={{
                  borderRadius: 2,
                  bgcolor: page === 'index' ? 'rgba(25,118,210,.10)' : 'transparent',
                  '&:hover': { bgcolor: page === 'index' ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
                }}
              >
                <AccountTreeRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title="附件" placement="right">
              <IconButton
                size="small"
                aria-label="附件"
                onClick={() => setPage('attachments')}
                sx={{
                  borderRadius: 2,
                  bgcolor: page === 'attachments' ? 'rgba(25,118,210,.10)' : 'transparent',
                  '&:hover': { bgcolor: page === 'attachments' ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
                }}
              >
                <AttachFileRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title="全部笔记" placement="right">
              <IconButton
                size="small"
                aria-label="全部笔记"
                onClick={() => setPage('all-notes')}
                sx={{
                  borderRadius: 2,
                  bgcolor: page === 'all-notes' ? 'rgba(25,118,210,.10)' : 'transparent',
                  '&:hover': { bgcolor: page === 'all-notes' ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
                }}
              >
                <NotesRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title="设置" placement="right">
              <IconButton
                size="small"
                aria-label="设置"
                onClick={() => setPage('settings')}
                sx={{
                  borderRadius: 2,
                  bgcolor: page === 'settings' ? 'rgba(25,118,210,.10)' : 'transparent',
                  '&:hover': { bgcolor: page === 'settings' ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
                }}
              >
                <SettingsRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Box sx={{ flex: 1 }} />
          </Box>

          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, p: 2 }}>
            {page === 'home' ? <Typography color="text.secondary">这是主页页面。</Typography> : null}
            {page === 'new-note' ? (
              <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <Box
                  sx={{
                    width: '100%',
                    maxWidth: 240,
                    pb: 0.5,
                    borderBottom: '1px solid',
                    borderColor: 'rgba(0,0,0,.16)',
                  }}
                >
                  <InputBase
                    value={newNoteTitle}
                    onChange={e => setNewNoteTitle(e.target.value)}
                    placeholder="输入标题"
                    fullWidth
                    inputProps={{ 'aria-label': '笔记标题' }}
                    sx={{
                      fontSize: 28,
                      lineHeight: 1.2,
                      fontWeight: 900,
                      color: '#111',
                      '& input': {
                        p: 0,
                      },
                    }}
                  />
                </Box>

                <InputBase
                  value={newNoteContent}
                  onChange={e => setNewNoteContent(e.target.value)}
                  placeholder="开始输入正文..."
                  fullWidth
                  multiline
                  minRows={12}
                  inputProps={{ 'aria-label': '笔记正文' }}
                  sx={{
                    mt: 2,
                    width: '100%',
                    flex: 1,
                    alignItems: 'flex-start',
                    fontSize: 16,
                    lineHeight: 1.8,
                    color: '#222',
                    '& textarea': {
                      padding: 0,
                      resize: 'none',
                    },
                  }}
                />
              </Box>
            ) : null}
            {page === 'attachments' ? <Typography color="text.secondary">这是附件页面。</Typography> : null}
            {page === 'all-notes' ? <Typography color="text.secondary">这是全部笔记页面。</Typography> : null}
            {page === 'index' ? <Typography color="text.secondary">这是索引页面。</Typography> : null}
            {page === 'settings' ? <Typography color="text.secondary">这是设置页面。</Typography> : null}
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  )
}
