import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { Box, IconButton, Menu, MenuItem, Typography } from '@mui/material'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded'
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import SpeedRoundedIcon from '@mui/icons-material/SpeedRounded'

type WebviewVideoSpeedPreset = {
  label: string
  rate: number
  shortcut?: string | null
}

type WebviewSettings = {
  video: {
    defaultRate: number
    maxRate: number
    presets: WebviewVideoSpeedPreset[]
  }
}

const WEBVIEW_SETTINGS_UPDATED_EVENT = 'fast-window:webview-settings-updated'

function buildShortcutFromEvent(e: KeyboardEvent): string | null {
  const code = typeof e.code === 'string' ? e.code : ''
  if (!code || code === 'Unidentified') return null

  const parts: string[] = []
  if (e.ctrlKey) parts.push('control')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  if (e.metaKey) parts.push('super')
  parts.push(code)
  return parts.join('+')
}

function isEditableTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null
  if (!el || typeof (el as any).tagName !== 'string') return false
  const tag = el.tagName.toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if ((el as any).isContentEditable) return true
  if (typeof (el as any).closest === 'function' && (el as any).closest('[contenteditable="true"],[role="textbox"]')) return true
  return false
}

export default function BrowserBarWindow() {
  const [busy, setBusy] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [webview, setWebview] = useState<WebviewSettings | null>(null)
  const [currentRate, setCurrentRate] = useState<number>(1)
  const [speedAnchor, setSpeedAnchor] = useState<HTMLElement | null>(null)
  const currentRateRef = useRef(1)
  const defaultRateRef = useRef(1)
  const toggleRef = useRef<{ activeKey: string | null; prevRate: number | null }>({ activeKey: null, prevRate: null })

  useEffect(() => {
    void invoke<boolean>('browser_stack_get_pinned')
      .then(v => setPinned(Boolean(v)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    currentRateRef.current = currentRate
  }, [currentRate])

  useEffect(() => {
    let unlisten: UnlistenFn | null = null

    void (async () => {
      const wv = await invoke<WebviewSettings>('get_webview_settings').catch(() => null)
      if (wv) {
        setWebview(wv)
        const dr = Number.isFinite(wv.video.defaultRate) ? wv.video.defaultRate : 1
        defaultRateRef.current = dr
        setCurrentRate(dr)
      }

      unlisten = await listen<WebviewSettings>(WEBVIEW_SETTINGS_UPDATED_EVENT, event => {
        const payload = (event as any)?.payload as WebviewSettings | undefined
        if (!payload) return
        setWebview(payload)
        toggleRef.current.activeKey = null
        toggleRef.current.prevRate = null
        defaultRateRef.current = Number.isFinite(payload.video.defaultRate) ? payload.video.defaultRate : 1
        setCurrentRate(prev => {
          const max = Number.isFinite(payload.video.maxRate) ? payload.video.maxRate : 16
          const next = Math.min(Math.max(prev, 0.25), Math.min(16, Math.max(0.25, max)))
          return Number.isFinite(next) ? next : 1
        })
      })
    })()

    return () => {
      if (unlisten) unlisten()
    }
  }, [])

  const presetByShortcut = useMemo(() => {
    const list = webview?.video.presets || []
    const map = new Map<string, WebviewVideoSpeedPreset>()
    for (const p of list) {
      if (!p?.shortcut) continue
      map.set(p.shortcut, p)
    }
    return map
  }, [webview])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (isEditableTarget(e.target)) return
      const shot = buildShortcutFromEvent(e)
      if (!shot) return
      const p = presetByShortcut.get(shot)
      if (!p) return

      e.preventDefault()
      e.stopPropagation()
      ;(e as any).stopImmediatePropagation?.()

      const toggle = toggleRef.current
      if (toggle.activeKey === shot) {
        const back = Number.isFinite(toggle.prevRate ?? NaN) ? (toggle.prevRate as number) : defaultRateRef.current
        toggle.activeKey = null
        toggle.prevRate = null
        void invoke('browser_video_set_rate', { rate: back }).catch(() => {})
        setCurrentRate(back)
      } else {
        toggle.activeKey = shot
        toggle.prevRate = currentRateRef.current
        void invoke('browser_video_toggle_preset', { shortcut: shot, rate: p.rate }).catch(() => {})
        setCurrentRate(p.rate)
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [presetByShortcut])

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

  const presets = webview?.video.presets || []
  const defaultRate = webview?.video.defaultRate ?? 1
  const speedOpen = Boolean(speedAnchor)
  const speedLabel = `${(Number.isFinite(currentRate) ? currentRate : 1).toFixed(2).replace(/\.00$/, '')}x`

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
        <IconButton
          aria-label={`倍速 ${speedLabel}`}
          size="small"
          onClick={e => setSpeedAnchor(e.currentTarget)}
          disabled={!webview}
        >
          <SpeedRoundedIcon fontSize="small" />
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

      <Menu
        anchorEl={speedAnchor}
        open={speedOpen}
        onClose={() => setSpeedAnchor(null)}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <MenuItem
          selected={Math.abs(currentRate - defaultRate) < 0.001}
          onClick={() => {
            setSpeedAnchor(null)
            toggleRef.current.activeKey = null
            toggleRef.current.prevRate = null
            void invoke('browser_video_set_rate', { rate: defaultRate }).catch(() => {})
            setCurrentRate(defaultRate)
          }}
        >
          默认（{`${defaultRate}x`}）
        </MenuItem>
        {presets.map((p, idx) => (
          <MenuItem
            key={`${idx}-${p.label}-${p.rate}`}
            selected={Math.abs(currentRate - p.rate) < 0.001}
            onClick={() => {
              setSpeedAnchor(null)
              toggleRef.current.activeKey = null
              toggleRef.current.prevRate = null
              void invoke('browser_video_set_rate', { rate: p.rate }).catch(() => {})
              setCurrentRate(p.rate)
            }}
          >
            {p.label || `${p.rate}x`}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  )
}
