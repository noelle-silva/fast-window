import { useCallback, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Box, IconButton, Typography } from '@mui/material'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'

export default function BrowserBarWindow() {
  const [busy, setBusy] = useState(false)

  const call = useCallback(async (cmd: string) => {
    if (busy) return
    try {
      setBusy(true)
      await invoke(cmd)
    } finally {
      setBusy(false)
    }
  }, [busy])

  return (
    <Box
      data-tauri-drag-region="true"
      sx={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        position: 'relative',
        px: 0.5,
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
        WebkitAppRegion: 'drag',
        userSelect: 'none',
      }}
    >
      <Box
        data-tauri-drag-region="false"
        sx={{ position: 'absolute', left: 6, display: 'flex', alignItems: 'center', gap: 0.5, WebkitAppRegion: 'no-drag' }}
      >
        <IconButton aria-label="关闭浏览" size="small" onClick={() => call('close_browser_window')}>
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
        <IconButton aria-label="隐藏浏览" size="small" onClick={() => call('hide_browser_stack')}>
          <RemoveRoundedIcon fontSize="small" />
        </IconButton>
        <IconButton aria-label="全屏切换" size="small" onClick={() => call('browser_stack_toggle_fullscreen')}>
          <FullscreenRoundedIcon fontSize="small" />
        </IconButton>
        <IconButton aria-label="后退" size="small" onClick={() => call('browser_go_back')}>
          <ArrowBackRoundedIcon fontSize="small" />
        </IconButton>
        <IconButton aria-label="前进" size="small" onClick={() => call('browser_go_forward')}>
          <ArrowForwardRoundedIcon fontSize="small" />
        </IconButton>
        <IconButton aria-label="刷新" size="small" onClick={() => call('browser_reload')}>
          <RefreshRoundedIcon fontSize="small" />
        </IconButton>
      </Box>

      <Typography
        variant="body2"
        color="text.secondary"
        sx={{
          width: '100%',
          textAlign: 'center',
          fontWeight: 600,
          letterSpacing: 0.2,
          px: 4,
          pointerEvents: 'none',
        }}
      >
        Web
      </Typography>
    </Box>
  )
}
