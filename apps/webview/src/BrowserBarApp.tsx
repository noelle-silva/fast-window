import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { buildShortcutFromEvent, isEditableTarget } from './keyboard'
import { WEBVIEW_SETTINGS_UPDATED_EVENT, type WebviewSettings, type WebviewVideoSpeedPreset } from './webviewSettings'

type SpeedCycleItem = {
  key: string
  label: string
  rate: number
}

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size}>
      <path fill="currentColor" d={d} />
    </svg>
  )
}

const ICON_PATH = {
  close: 'M18.3 5.71a.9959.9959 0 0 0-1.41 0L12 10.59 7.11 5.7a.9959.9959 0 0 0-1.41 0c-.39.39-.39 1.02 0 1.41L10.59 12l-4.89 4.89c-.39.39-.39 1.02 0 1.41.39.39 1.02.39 1.41 0L12 13.41l4.89 4.89c.39.39 1.02.39 1.41 0 .39-.39.39-1.02 0-1.41L13.41 12l4.89-4.89c.38-.38.38-1.02 0-1.4z',
  remove: 'M19 13H5v-2h14v2z',
  fullscreen: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  pinFilled:
    'M14 4v5c0 1.12.37 2.16 1 3H9c.65-.86 1-1.9 1-3V4h4m3-2H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3V4h1c.55 0 1-.45 1-1s-.45-1-1-1z',
  pinOutlined:
    'M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  forward: 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8-8-8z',
  refresh:
    'M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-5.99-2.69-5.99-6s2.68-6 5.99-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  speed:
    'M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.27-10.44zm-9.79 6.84a2 2 0 0 0 2.83 0l5.66-8.49-8.49 5.66a2 2 0 0 0 0 2.83z',
  chevronLeft:
    'M14.71 6.71a.9959.9959 0 0 0-1.41 0L8.71 11.3c-.39.39-.39 1.02 0 1.41l4.59 4.59c.39.39 1.02.39 1.41 0 .39-.39.39-1.02 0-1.41L10.83 12l3.88-3.88c.38-.39.38-1.03 0-1.41z',
  chevronRight:
    'M9.29 6.71c-.39.39-.39 1.02 0 1.41L13.17 12l-3.88 3.88c-.39.39-.39 1.02 0 1.41.39.39 1.02.39 1.41 0L15.41 12 9.7 6.71c-.38-.38-1.02-.38-1.41 0z',
} as const

export default function BrowserBarApp() {
  const [busy, setBusy] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [webview, setWebview] = useState<WebviewSettings | null>(null)
  const [currentRate, setCurrentRate] = useState<number>(1)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [speedIndex, setSpeedIndex] = useState<number>(0)
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

  const speedItems: SpeedCycleItem[] = useMemo(() => {
    if (!webview) return []
    const items: SpeedCycleItem[] = []
    const dr = Number.isFinite(webview.video.defaultRate) ? webview.video.defaultRate : 1
    items.push({ key: 'default', label: `默认（${dr}x）`, rate: dr })

    for (let i = 0; i < (webview.video.presets || []).length; i++) {
      const p = webview.video.presets[i]
      if (!p) continue
      const label = (p.label || `${p.rate}x`).trim() || `${p.rate}x`
      items.push({ key: `preset:${i}`, label, rate: p.rate })
    }

    return items.filter(it => Number.isFinite(it.rate))
  }, [webview])

  const findSpeedIndex = useCallback(
    (rate: number) => {
      const eps = 0.001
      for (let i = 0; i < speedItems.length; i++) {
        if (Math.abs(speedItems[i].rate - rate) < eps) return i
      }
      return -1
    },
    [speedItems],
  )

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
        void invoke('browser_video_toggle_preset', { shortcut: shot, rate: p.rate }).catch(() => {})
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

  const call = useCallback(
    async (cmd: string) => {
      if (busy) return
      try {
        setBusy(true)
        await invoke(cmd)
      } finally {
        setBusy(false)
      }
    },
    [busy],
  )

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

  const speedLabel = `${(Number.isFinite(currentRate) ? currentRate : 1).toFixed(2).replace(/\.00$/, '')}x`

  useEffect(() => {
    if (!speedOpen) return
    const idx = findSpeedIndex(currentRateRef.current)
    setSpeedIndex(idx >= 0 ? idx : 0)
  }, [speedOpen, findSpeedIndex])

  return (
    <div
      className="browser-bar-root"
      data-tauri-drag-region="true"
      onPointerDown={e => {
        if (e.button !== 0) return
        void getCurrentWindow().startDragging().catch(() => {})
      }}
    >
      <div className="browser-bar-controls" onPointerDown={e => e.stopPropagation()}>
        <button type="button" className="browser-bar-btn" aria-label="关闭浏览" title="关闭浏览" onClick={() => call('close_browser_window')}>
          <Icon d={ICON_PATH.close} />
        </button>
        <button type="button" className="browser-bar-btn" aria-label="隐藏浏览" title="隐藏浏览" onClick={() => call('hide_browser_stack')}>
          <Icon d={ICON_PATH.remove} />
        </button>
        <button type="button" className="browser-bar-btn" aria-label="全屏切换" title="全屏切换" onClick={() => call('browser_stack_toggle_fullscreen')}>
          <Icon d={ICON_PATH.fullscreen} />
        </button>
        <button
          type="button"
          className={`browser-bar-btn${pinned ? ' browser-bar-btn-active' : ''}`}
          aria-label={pinned ? '取消图钉' : '图钉置顶'}
          title={pinned ? '取消图钉' : '图钉置顶'}
          onClick={() => void togglePinned()}
        >
          <Icon d={pinned ? ICON_PATH.pinFilled : ICON_PATH.pinOutlined} />
        </button>
        <button type="button" className="browser-bar-btn" aria-label="后退" title="后退" onClick={() => call('browser_go_back')}>
          <Icon d={ICON_PATH.back} />
        </button>
        <button type="button" className="browser-bar-btn" aria-label="前进" title="前进" onClick={() => call('browser_go_forward')}>
          <Icon d={ICON_PATH.forward} />
        </button>
        <button type="button" className="browser-bar-btn" aria-label="刷新" title="刷新" onClick={() => call('browser_reload')}>
          <Icon d={ICON_PATH.refresh} />
        </button>
        <button
          type="button"
          className="browser-bar-btn"
          aria-label={`倍速 ${speedLabel}`}
          title={`倍速 ${speedLabel}`}
          onClick={() => setSpeedOpen(v => !v)}
          disabled={!webview}
        >
          <Icon d={ICON_PATH.speed} />
        </button>

        {speedOpen ? (
          <div className="browser-bar-speed-menu" onPointerDown={e => e.stopPropagation()}>
            <button
              type="button"
              className="browser-bar-btn"
              aria-label="上一个倍速预设"
              title="上一个倍速预设"
              disabled={!speedItems.length}
              onClick={() => {
                if (!speedItems.length) return
                const next = (speedIndex - 1 + speedItems.length) % speedItems.length
                setSpeedIndex(next)
                toggleRef.current.activeKey = null
                toggleRef.current.prevRate = null
                const item = speedItems[next]
                void invoke('browser_video_set_rate', { rate: item.rate }).catch(() => {})
                setCurrentRate(item.rate)
              }}
            >
              <Icon d={ICON_PATH.chevronLeft} />
            </button>

            <div className="browser-bar-speed-label">
              <div className="browser-bar-speed-label-main">{speedItems[speedIndex]?.label || `当前：${speedLabel}`}</div>
              <div className="browser-bar-speed-label-sub">{speedItems.length ? `${speedIndex + 1}/${speedItems.length}` : '-'}</div>
            </div>

            <button
              type="button"
              className="browser-bar-btn"
              aria-label="下一个倍速预设"
              title="下一个倍速预设"
              disabled={!speedItems.length}
              onClick={() => {
                if (!speedItems.length) return
                const next = (speedIndex + 1) % speedItems.length
                setSpeedIndex(next)
                toggleRef.current.activeKey = null
                toggleRef.current.prevRate = null
                const item = speedItems[next]
                void invoke('browser_video_set_rate', { rate: item.rate }).catch(() => {})
                setCurrentRate(item.rate)
              }}
            >
              <Icon d={ICON_PATH.chevronRight} />
            </button>

            <button type="button" className="browser-bar-btn" aria-label="关闭倍速菜单" title="关闭倍速菜单" onClick={() => setSpeedOpen(false)}>
              <Icon d={ICON_PATH.close} />
            </button>
          </div>
        ) : null}
      </div>

      <div className="browser-bar-title">webview</div>
    </div>
  )
}
