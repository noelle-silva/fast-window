import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { dataDirAssetUrl } from './assetUrl'
import {
  BROWSER_PAGES_UPDATED_EVENT,
  type BrowserPageIcon,
  type BrowserPageInfo,
  type BrowserPagesPayload,
} from './browserPages'
import { buildShortcutFromEvent, isEditableTarget } from './keyboard'
import { WEBVIEW_SETTINGS_UPDATED_EVENT, type WebviewSettings, type WebviewVideoSpeedPreset } from './webviewSettings'

type SpeedCycleItem = {
  key: string
  label: string
  rate: number
}

const PAGE_ITEM_HEIGHT = 36
const PAGE_MENU_PADDING = 12
const PAGE_MENU_MAX_VISIBLE = 8

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
  chevronDown: 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z',
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  globe:
    'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z',
} as const

function PageMark({ icon, dataDir }: { icon?: BrowserPageIcon | null; dataDir: string | null }) {
  const kind = String(icon?.kind || '')
  if (kind === 'image' && icon?.assetId && dataDir) {
    return <img className="browser-bar-page-icon" src={dataDirAssetUrl(dataDir, icon.assetId)} alt="" />
  }
  if (kind === 'color' && icon?.color) {
    return <span className="browser-bar-page-icon browser-bar-page-icon-color" style={{ background: icon.color }} />
  }
  return (
    <span className="browser-bar-page-icon browser-bar-page-icon-fallback">
      <Icon d={ICON_PATH.globe} size={14} />
    </span>
  )
}

export default function BrowserBarApp() {
  const [busy, setBusy] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [webview, setWebview] = useState<WebviewSettings | null>(null)
  const [currentRate, setCurrentRate] = useState<number>(1)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [speedIndex, setSpeedIndex] = useState<number>(0)
  const [pages, setPages] = useState<BrowserPageInfo[]>([])
  const [activeLabel, setActiveLabel] = useState<string | null>(null)
  const [pageMenuOpen, setPageMenuOpen] = useState(false)
  const [dataDir, setDataDir] = useState<string | null>(null)
  const currentRateRef = useRef(1)
  const defaultRateRef = useRef(1)
  const activeLabelRef = useRef<string | null>(null)
  const pageRateRestoredRef = useRef(false)
  const switcherButtonRef = useRef<HTMLButtonElement | null>(null)
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
    let cancelled = false
    void invoke<{ dataDir?: string }>('data_dir_status')
      .then(status => {
        if (!cancelled) setDataDir(status?.dataDir ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const applyPayload = useCallback((payload: BrowserPagesPayload | null | undefined, forceRate = false) => {
    const nextPages = Array.isArray(payload?.pages) ? payload.pages : []
    const nextActive = payload?.activeLabel ?? null
    setPages(nextPages)
    setActiveLabel(nextActive)
    // 切换页面或强制刷新时，用该页记录还原倍速显示；同页事件不打断正在进行的调整。
    if (forceRate || activeLabelRef.current !== nextActive) {
      activeLabelRef.current = nextActive
      const active = nextPages.find(page => page.label === nextActive)
      if (active && Number.isFinite(active.rate)) {
        setCurrentRate(active.rate as number)
        pageRateRestoredRef.current = true
      }
    }
  }, [])

  useEffect(() => {
    let unlisten: UnlistenFn | null = null
    let cancelled = false

    void invoke<BrowserPagesPayload>('browser_stack_pages')
      .then(payload => {
        if (!cancelled) applyPayload(payload)
      })
      .catch(() => {})
    void listen<BrowserPagesPayload>(BROWSER_PAGES_UPDATED_EVENT, event => applyPayload(event.payload))
      .then(nextUnlisten => {
        if (cancelled) nextUnlisten()
        else unlisten = nextUnlisten
      })
      .catch(() => {})

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [applyPayload])

  useEffect(() => {
    if (!activeLabelRef.current) return
    void invoke('browser_stack_set_active_rate', { rate: currentRate }).catch(() => {})
  }, [currentRate])

  useEffect(() => {
    toggleRef.current.activeKey = null
    toggleRef.current.prevRate = null
  }, [activeLabel])

  useEffect(() => {
    let unlisten: UnlistenFn | null = null

    void (async () => {
      const wv = await invoke<WebviewSettings>('get_webview_settings').catch(() => null)
      if (wv) {
        setWebview(wv)
        const dr = Number.isFinite(wv.video.defaultRate) ? wv.video.defaultRate : 1
        defaultRateRef.current = dr
        // 页面记录的倍速优先（bar 重建等场景下不被默认值覆盖）。
        if (!pageRateRestoredRef.current) setCurrentRate(dr)
      }

      unlisten = await listen<WebviewSettings>(WEBVIEW_SETTINGS_UPDATED_EVENT, event => {
        const payload = (event as any)?.payload as WebviewSettings | undefined
        if (!payload) return
        setWebview(payload)
        toggleRef.current.activeKey = null
        toggleRef.current.prevRate = null
        defaultRateRef.current = Number.isFinite(payload.video.defaultRate) ? payload.video.defaultRate : 1
        // 设置变更后页面已按各自记录恢复速率，以页面记录为准刷新显示。
        void invoke<BrowserPagesPayload>('browser_stack_pages')
          .then(pagePayload => applyPayload(pagePayload, true))
          .catch(() => {})
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

  const runBarCommand = useCallback(
    (cmd: string) => {
      setPageMenuOpen(false)
      setSpeedOpen(false)
      void call(cmd)
    },
    [call],
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

  const activePage = useMemo(
    () => pages.find(page => page.label === activeLabel) ?? null,
    [pages, activeLabel],
  )

  const panelHeightFor = useCallback((count: number) => {
    const visible = Math.max(1, Math.min(count, PAGE_MENU_MAX_VISIBLE))
    return visible * PAGE_ITEM_HEIGHT + PAGE_MENU_PADDING
  }, [])

  // 面板开合的唯一驱动：状态变化 → 通知 Rust 调整顶部栏窗口高度。
  useEffect(() => {
    const open = pageMenuOpen && pages.length > 0
    const panelHeight = open ? panelHeightFor(pages.length) : 0
    void invoke('browser_stack_set_bar_panel', { open, panelHeight }).catch(() => {})
  }, [pageMenuOpen, pages.length, panelHeightFor])

  useEffect(() => {
    const onBlur = () => setPageMenuOpen(false)
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (pageMenuOpen) {
        event.preventDefault()
        setPageMenuOpen(false)
        switcherButtonRef.current?.focus()
      }
      setSpeedOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pageMenuOpen])

  const refreshPages = useCallback(() => {
    void invoke<BrowserPagesPayload>('browser_stack_pages').then(applyPayload).catch(() => {})
  }, [applyPayload])

  const togglePageMenu = useCallback(() => {
    if (pageMenuOpen) {
      setPageMenuOpen(false)
      return
    }
    setSpeedOpen(false)
    void invoke<BrowserPagesPayload>('browser_stack_pages')
      .then(payload => {
        applyPayload(payload)
        setPageMenuOpen(true)
      })
      .catch(() => setPageMenuOpen(true))
  }, [pageMenuOpen, applyPayload])

  const activatePage = useCallback(
    (label: string) => {
      setPageMenuOpen(false)
      void invoke('browser_stack_activate_page', { label }).catch(refreshPages)
    },
    [refreshPages],
  )

  const closePage = useCallback(
    (label: string, event: ReactMouseEvent) => {
      event.stopPropagation()
      void invoke('browser_stack_close_page', { label }).catch(refreshPages)
    },
    [refreshPages],
  )

  const switchPage = useCallback(
    (delta: number) => {
      if (pages.length < 2) return
      const index = pages.findIndex(page => page.label === activeLabel)
      if (index < 0) return
      const next = pages[(index + delta + pages.length) % pages.length]
      if (!next) return
      setPageMenuOpen(false)
      void invoke('browser_stack_activate_page', { label: next.label }).catch(refreshPages)
    },
    [activeLabel, pages, refreshPages],
  )

  return (
    <div
      className="browser-bar-root"
      onPointerDown={e => {
        if (e.button !== 0) return
        void getCurrentWindow().startDragging().catch(() => {})
      }}
    >
      <div className="browser-bar-row">
        <div className="browser-bar-controls" onPointerDown={e => e.stopPropagation()}>
          <button
            type="button"
            className="browser-bar-switcher-btn browser-bar-home-btn"
            aria-label="回主窗口"
            title="回主窗口"
            onClick={() => runBarCommand('browser_stack_return_to_main')}
          >
            <Icon d={ICON_PATH.home} size={16} />
            <span className="browser-bar-switcher-name">主页</span>
          </button>
          <button type="button" className="browser-bar-btn" aria-label="后退" title="后退" onClick={() => runBarCommand('browser_go_back')}>
            <Icon d={ICON_PATH.back} />
          </button>
          <button type="button" className="browser-bar-btn" aria-label="前进" title="前进" onClick={() => runBarCommand('browser_go_forward')}>
            <Icon d={ICON_PATH.forward} />
          </button>
          <button
            type="button"
            className="browser-bar-btn"
            aria-label={`倍速 ${speedLabel}`}
            title={`倍速 ${speedLabel}`}
            onClick={() => {
              if (!speedOpen) setPageMenuOpen(false)
              setSpeedOpen(v => !v)
            }}
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

        <div className="browser-bar-switcher" onPointerDown={e => e.stopPropagation()}>
          <button
            type="button"
            className="browser-bar-btn"
            aria-label="上一个页面"
            title="上一个页面"
            disabled={pages.length < 2}
            onClick={() => switchPage(-1)}
          >
            <Icon d={ICON_PATH.chevronLeft} />
          </button>
          <button
            type="button"
            ref={switcherButtonRef}
            className="browser-bar-switcher-btn"
            aria-label="切换页面"
            aria-haspopup="menu"
            aria-expanded={pageMenuOpen}
            title={activePage?.name || '页面列表'}
            onClick={togglePageMenu}
          >
            <PageMark icon={activePage?.icon} dataDir={dataDir} />
            <span className="browser-bar-switcher-name">{activePage?.name || 'webview'}</span>
            <Icon d={ICON_PATH.chevronDown} size={16} />
          </button>
          <button
            type="button"
            className="browser-bar-btn"
            aria-label="下一个页面"
            title="下一个页面"
            disabled={pages.length < 2}
            onClick={() => switchPage(1)}
          >
            <Icon d={ICON_PATH.chevronRight} />
          </button>
        </div>

        <div className="browser-bar-controls browser-bar-controls-right" onPointerDown={e => e.stopPropagation()}>
          <button type="button" className="browser-bar-btn" aria-label="刷新" title="刷新" onClick={() => runBarCommand('browser_reload')}>
            <Icon d={ICON_PATH.refresh} />
          </button>
          <button
            type="button"
            className={`browser-bar-btn${pinned ? ' browser-bar-btn-active' : ''}`}
            aria-label={pinned ? '取消图钉' : '图钉置顶'}
            title={pinned ? '取消图钉' : '图钉置顶'}
            onClick={() => { setPageMenuOpen(false); setSpeedOpen(false); void togglePinned() }}
          >
            <Icon d={pinned ? ICON_PATH.pinFilled : ICON_PATH.pinOutlined} />
          </button>
          <button type="button" className="browser-bar-btn" aria-label="全屏切换" title="全屏切换" onClick={() => runBarCommand('browser_stack_toggle_fullscreen')}>
            <Icon d={ICON_PATH.fullscreen} />
          </button>
          <button type="button" className="browser-bar-btn" aria-label="隐藏浏览" title="隐藏浏览" onClick={() => runBarCommand('hide_browser_stack')}>
            <Icon d={ICON_PATH.remove} />
          </button>
          <button type="button" className="browser-bar-btn" aria-label="关闭浏览" title="关闭浏览" onClick={() => runBarCommand('close_browser_window')}>
            <Icon d={ICON_PATH.close} />
          </button>
        </div>
      </div>

      {pageMenuOpen ? (
        <div className="browser-bar-page-backdrop" onPointerDown={e => { e.stopPropagation(); setPageMenuOpen(false) }} />
      ) : null}

      {pageMenuOpen ? (
        <div className="browser-bar-page-panel" role="menu" aria-label="打开的页面" onPointerDown={e => e.stopPropagation()}>
          {pages.map(page => (
            <div
              key={page.label}
              role="none"
              className={`browser-bar-page-item${page.label === activeLabel ? ' browser-bar-page-item-active' : ''}`}
            >
              <button type="button" className="browser-bar-page-main" role="menuitem" title={page.name} onClick={() => activatePage(page.label)}>
                <PageMark icon={page.icon} dataDir={dataDir} />
                <span className="browser-bar-page-name">{page.name}</span>
              </button>
              <button
                type="button"
                className="browser-bar-page-close"
                aria-label={`关闭 ${page.name}`}
                title="关闭页面"
                onClick={event => closePage(page.label, event)}
              >
                <Icon d={ICON_PATH.close} size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
