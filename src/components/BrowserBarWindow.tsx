import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Box, IconButton, Typography } from '@mui/material'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded'
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'

export default function BrowserBarWindow() {
  const [busy, setBusy] = useState(false)
  const [pinned, setPinned] = useState(false)

  useEffect(() => {
    void invoke<boolean>('browser_stack_get_pinned')
      .then(v => setPinned(Boolean(v)))
      .catch(() => {})
  }, [])

  const call = useCallback(async (cmd: string) => {
    if (busy) return
    try {
      setBusy(true)
      await invoke(cmd)
    } finally {
      setBusy(false)
    }
  }, [busy])

  const togglePinned = useCallback(async () => {
    if (busy) return
    try {
      setBusy(true)
      const next = await invoke<boolean>('browser_stack_toggle_pinned')
      setPinned(Boolean(next))
    } finally {
      setBusy(false)
    }
  }, [busy])

  return (
    <Box
      data-tauri-drag-region="true"
      onPointerDown={e => {
        if (e.button !== 0) return
        // drag-region 在某些环境下会偶发失效，这里用 startDragging 兜底。
        void getCurrentWindow().startDragging().catch(() => {})
      }}
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
        borderRadius: '16px 16px 0 0',
        overflow: 'hidden',
      }}
    >
      <Box
        data-tauri-drag-region="false"
        onPointerDown={e => e.stopPropagation()}
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
        <IconButton
          aria-label={pinned ? '取消图钉' : '图钉置顶'}
          size="small"
          color={pinned ? 'primary' : 'default'}
          onClick={() => void togglePinned()}
        >
          {pinned ? <PushPinRoundedIcon fontSize="small" /> : <PushPinOutlinedIcon fontSize="small" />}
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
