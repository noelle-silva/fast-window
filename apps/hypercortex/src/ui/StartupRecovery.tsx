import * as React from 'react'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import StorageRoundedIcon from '@mui/icons-material/StorageRounded'
import { Box, Button, CircularProgress, CssBaseline, Divider, GlobalStyles, Paper, ThemeProvider, Typography, createTheme } from '@mui/material'
import type { DataDirStatus } from '../gateway/types'
import { StandaloneWindowControls, type WindowControlActions } from './StandaloneWindowControls'

export type StartupRecoveryPhase = 'starting' | 'failed'

type StartupRecoveryProps = {
  phase: StartupRecoveryPhase
  error: string | null
  status: DataDirStatus | null
  busy: boolean
  windowControls?: {
    standalone: boolean
    actions: WindowControlActions
  }
  onRetry: () => Promise<void> | void
  onPickDataDir: () => Promise<void> | void
  onStartDragging?: () => Promise<void> | void
}

const startupTheme = createTheme({
  palette: {
    mode: 'light',
    background: { default: '#f7f4ee', paper: '#fffaf2' },
  },
  typography: {
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
  },
})

function isInteractiveTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element || typeof element.closest !== 'function') return false
  return !!element.closest('button, a, input, textarea, select, [role="button"], [data-window-controls="true"]')
}

function statusLine(status: DataDirStatus | null): string {
  if (!status) return '正在读取数据目录状态...'
  if (status.writable) return '数据目录可写，正在等待本地后台完成启动。'
  return `数据目录不可用：${status.error || '未知原因'}`
}

export function StartupRecovery(props: StartupRecoveryProps) {
  const { phase, error, status, busy, windowControls, onRetry, onPickDataDir, onStartDragging } = props
  const isStarting = phase === 'starting'

  const run = React.useCallback((action: () => Promise<void> | void) => {
    if (busy) return
    Promise.resolve(action()).catch(() => {})
  }, [busy])

  const handlePointerDown = React.useCallback((event: React.PointerEvent) => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return
    Promise.resolve(onStartDragging?.()).catch(() => {})
  }, [onStartDragging])

  return (
    <ThemeProvider theme={startupTheme}>
      <CssBaseline />
      <GlobalStyles
        styles={{
          html: { height: '100%', overflow: 'hidden' },
          body: { height: '100%', overflow: 'hidden', background: '#f7f4ee' },
          '#app': { minHeight: '100%' },
        }}
      />
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'radial-gradient(circle at 16% 12%, rgba(255,202,128,.55), transparent 32%), radial-gradient(circle at 84% 18%, rgba(120,145,255,.22), transparent 30%), linear-gradient(135deg, #fffaf2 0%, #f2efe9 100%)',
          color: '#211b15',
        }}
      >
        <Box
          onPointerDown={handlePointerDown}
          sx={{
            height: 46,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 1.25,
            flex: '0 0 auto',
            userSelect: 'none',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: 99, bgcolor: isStarting ? '#1976d2' : '#d84315', boxShadow: isStarting ? '0 0 0 5px rgba(25,118,210,.12)' : '0 0 0 5px rgba(216,67,21,.12)' }} />
            <Typography sx={{ fontSize: 13, fontWeight: 900, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(33,27,21,.74)' }}>
              HyperCortex
            </Typography>
          </Box>
          {windowControls?.standalone ? <StandaloneWindowControls actions={windowControls.actions} /> : null}
        </Box>

        <Box sx={{ flex: '1 1 auto', display: 'grid', placeItems: 'center', p: { xs: 2, sm: 3 } }}>
          <Paper
            elevation={0}
            sx={{
              width: 'min(760px, 100%)',
              borderRadius: { xs: 4, sm: 5 },
              border: '1px solid rgba(91,70,45,.14)',
              overflow: 'hidden',
              boxShadow: '0 28px 80px rgba(67,48,28,.16)',
              bgcolor: 'rgba(255,250,242,.92)',
              backdropFilter: 'blur(14px)',
            }}
          >
            <Box sx={{ p: { xs: 2.25, sm: 3.5 }, display: 'flex', flexDirection: 'column', gap: 2.25 }}>
              <Box sx={{ display: 'flex', gap: 1.75, alignItems: 'flex-start' }}>
                <Box
                  sx={{
                    width: 52,
                    height: 52,
                    borderRadius: 4,
                    display: 'grid',
                    placeItems: 'center',
                    color: isStarting ? '#0d47a1' : '#bf360c',
                    bgcolor: isStarting ? 'rgba(25,118,210,.10)' : 'rgba(216,67,21,.10)',
                    flex: '0 0 auto',
                  }}
                >
                  {isStarting ? <CircularProgress size={24} thickness={5} /> : <ErrorOutlineRoundedIcon />}
                </Box>
                <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  <Typography component="h1" sx={{ fontSize: { xs: 25, sm: 34 }, lineHeight: 1.08, fontWeight: 950, letterSpacing: '-.04em' }}>
                    {isStarting ? '正在启动知识库后台' : '后台还没准备好'}
                  </Typography>
                  <Typography sx={{ fontSize: { xs: 14, sm: 15 }, lineHeight: 1.75, color: 'rgba(33,27,21,.66)' }}>
                    {isStarting
                      ? '正在连接本机 HyperCortex 后台。页面会先保持可操作，避免启动过程卡成白屏。'
                      : '本机后台没有在预期时间内完成连接。你可以直接重试，或者换一个可写的数据目录后再启动。'}
                  </Typography>
                </Box>
              </Box>

              <Divider sx={{ borderColor: 'rgba(91,70,45,.12)' }} />

              <Box sx={{ display: 'grid', gap: 1.25 }}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', color: status?.writable === false ? '#bf360c' : 'rgba(33,27,21,.72)' }}>
                  <StorageRoundedIcon fontSize="small" />
                  <Typography sx={{ fontSize: 13, lineHeight: 1.6, fontWeight: 750 }}>{statusLine(status)}</Typography>
                </Box>
                <Box sx={{ display: 'grid', gap: 0.75, p: 1.5, borderRadius: 3, bgcolor: 'rgba(255,255,255,.58)', border: '1px solid rgba(91,70,45,.10)' }}>
                  <Typography sx={{ fontSize: 12, color: 'rgba(33,27,21,.58)', lineHeight: 1.55, wordBreak: 'break-all' }}>
                    当前目录：{status?.dataDir || '读取中'}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: 'rgba(33,27,21,.58)', lineHeight: 1.55, wordBreak: 'break-all' }}>
                    默认目录：{status?.defaultDataDir || '读取中'}
                  </Typography>
                </Box>
              </Box>

              {error ? (
                <Box sx={{ p: 1.5, borderRadius: 3, bgcolor: 'rgba(216,67,21,.08)', color: '#9f2f0a', border: '1px solid rgba(216,67,21,.18)' }}>
                  <Typography sx={{ fontSize: 12.5, lineHeight: 1.7, wordBreak: 'break-word' }}>{error}</Typography>
                </Box>
              ) : null}

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                <Button
                  variant="contained"
                  startIcon={<RefreshRoundedIcon />}
                  onClick={() => run(onRetry)}
                  disabled={busy}
                  sx={{ borderRadius: 999, px: 2.25, fontWeight: 900, boxShadow: 'none' }}
                >
                  {busy ? '处理中...' : '重试启动'}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<FolderOpenRoundedIcon />}
                  onClick={() => run(onPickDataDir)}
                  disabled={busy}
                  sx={{ borderRadius: 999, px: 2.25, fontWeight: 900, borderColor: 'rgba(33,27,21,.22)', color: '#211b15' }}
                >
                  切换数据目录
                </Button>
              </Box>
            </Box>
          </Paper>
        </Box>
      </Box>
    </ThemeProvider>
  )
}
