import * as React from 'react'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import StorageRoundedIcon from '@mui/icons-material/StorageRounded'
import { Box, Button, CircularProgress, CssBaseline, GlobalStyles, Paper, ThemeProvider, Typography } from '@mui/material'
import type { DataDirStatus } from '../gateway/types'
import { StandaloneWindowControls, type WindowControlActions } from './StandaloneWindowControls'
import { lineFreeComponentOverrides, softButtonSx } from './pluginUiStyles'
import { colorPresetCssVars, createHyperCortexTheme, getColorPreset, DEFAULT_COLOR_PRESET_ID } from './colorPresets'

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

const startupColorPreset = getColorPreset(DEFAULT_COLOR_PRESET_ID)
const startupTheme = createHyperCortexTheme(startupColorPreset)
const startupColorVars = colorPresetCssVars(startupColorPreset)

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
          ':root': startupColorVars,
          body: { height: '100%', overflow: 'hidden', background: 'var(--hc-app-bg)' },
          '#app': { minHeight: '100%' },
        }}
      />
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--hc-app-bg)',
          color: 'var(--hc-text)',
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
            <Box sx={{ width: 10, height: 10, borderRadius: 99, bgcolor: isStarting ? 'var(--hc-primary)' : 'var(--hc-danger)', boxShadow: isStarting ? '0 0 0 5px var(--hc-primary-soft)' : '0 0 0 5px var(--hc-danger-soft)' }} />
            <Typography sx={{ fontSize: 13, fontWeight: 900, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--hc-text-muted)' }}>
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
              overflow: 'hidden',
              boxShadow: '0 30px 90px rgba(67,48,28,.18)',
              bgcolor: 'var(--hc-surface)',
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
                    color: isStarting ? 'var(--hc-primary)' : 'var(--hc-danger)',
                    bgcolor: isStarting ? 'var(--hc-primary-soft)' : 'var(--hc-danger-soft)',
                    flex: '0 0 auto',
                  }}
                >
                  {isStarting ? <CircularProgress size={24} thickness={5} /> : <ErrorOutlineRoundedIcon />}
                </Box>
                <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  <Typography component="h1" sx={{ fontSize: { xs: 25, sm: 34 }, lineHeight: 1.08, fontWeight: 950, letterSpacing: '-.04em' }}>
                    {isStarting ? '正在启动知识库后台' : '后台还没准备好'}
                  </Typography>
                  <Typography sx={{ fontSize: { xs: 14, sm: 15 }, lineHeight: 1.75, color: 'var(--hc-text-muted)' }}>
                    {isStarting
                      ? '正在连接本机 HyperCortex 后台。页面会先保持可操作，避免启动过程卡成白屏。'
                      : '本机后台没有在预期时间内完成连接。你可以直接重试，或者换一个可写的数据目录后再启动。'}
                  </Typography>
                </Box>
              </Box>

              <Box sx={{ display: 'grid', gap: 1.25 }}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', color: status?.writable === false ? 'var(--hc-danger)' : 'var(--hc-text-muted)' }}>
                  <StorageRoundedIcon fontSize="small" />
                  <Typography sx={{ fontSize: 13, lineHeight: 1.6, fontWeight: 750 }}>{statusLine(status)}</Typography>
                </Box>
                <Box sx={{ display: 'grid', gap: 0.75, p: 1.5, borderRadius: 3, bgcolor: 'var(--hc-surface-soft)', boxShadow: '0 12px 26px var(--hc-shadow)' }}>
                  <Typography sx={{ fontSize: 12, color: 'var(--hc-text-subtle)', lineHeight: 1.55, wordBreak: 'break-all' }}>
                    当前目录：{status?.dataDir || '读取中'}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: 'var(--hc-text-subtle)', lineHeight: 1.55, wordBreak: 'break-all' }}>
                    默认目录：{status?.defaultDataDir || '读取中'}
                  </Typography>
                </Box>
              </Box>

              {error ? (
                <Box sx={{ p: 1.5, borderRadius: 3, bgcolor: 'var(--hc-danger-soft)', color: 'var(--hc-danger)', boxShadow: '0 12px 26px var(--hc-shadow)' }}>
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
                  variant="text"
                  startIcon={<FolderOpenRoundedIcon />}
                  onClick={() => run(onPickDataDir)}
                  disabled={busy}
                  sx={{ ...softButtonSx, px: 2.25 }}
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
