import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createDirectClient } from './directClient'
import { QuickBarTopbar, type QuickBarPage } from './QuickBarTopbar'
import { SettingsPage, type SettingsTab } from './SettingsPage'
import { CapabilityBrowser } from './CapabilityBrowser'
import { ButtonManagerPage } from './ButtonManagerPage'
import { ToolbarApp } from './ToolbarApp'
import { ResultPopupApp } from './ResultPopupApp'
import type {
  DataDirStatus,
  DirectClient,
  FwLaunchInfo,
  ShortcutStatus,
  ToolbarDisplayMode,
  ToolbarDisplayModeStatus,
} from './types'
import { DEFAULT_LAUNCH_INFO } from './types'
import './styles.css'

const appWindow = getCurrentWindow()
const view = new URLSearchParams(window.location.search).get('view')
document.body.dataset.quickbarView = view === 'toolbar' ? 'toolbar' : view === 'result' ? 'result' : 'main'

function errorMessage(error: unknown, fallback: string): string {
  return String((error as { message?: string })?.message || error || fallback)
}

function App() {
  const [page, setPage] = React.useState<QuickBarPage>('settings')
  const [settingsTab, setSettingsTab] = React.useState<SettingsTab>('overview')
  const [launchInfo, setLaunchInfo] = React.useState<FwLaunchInfo>(DEFAULT_LAUNCH_INFO)
  const [initialCommand, setInitialCommand] = React.useState<string | null>(null)
  const [runtimeCommand, setRuntimeCommand] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<DataDirStatus | null>(null)
  const [shortcutStatus, setShortcutStatus] = React.useState<ShortcutStatus | null>(null)
  const [displayModeStatus, setDisplayModeStatus] = React.useState<ToolbarDisplayModeStatus | null>(null)
  const [health, setHealth] = React.useState<Record<string, unknown> | null>(null)
  const [phase, setPhase] = React.useState<'starting' | 'ready' | 'failed'>('starting')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const clientRef = React.useRef<DirectClient | null>(null)

  const getClient = React.useCallback((): DirectClient => {
    const c = clientRef.current
    if (!c) throw new Error('后台未连接')
    return c
  }, [])

  const closeClient = React.useCallback(() => {
    clientRef.current?.close()
    clientRef.current = null
  }, [])

  const applyCommandView = React.useCallback((command: string | null) => {
    if (command === 'open-settings') {
      setPage('settings')
      setSettingsTab('overview')
      return
    }
    if (command === 'show-health') {
      setPage('settings')
      setSettingsTab('backend')
    }
  }, [])

  const refreshStatus = React.useCallback(async () => {
    const [next, nextShortcut, nextDisplayMode] = await Promise.all([
      invoke<DataDirStatus>('data_dir_status').catch(() => null),
      invoke<ShortcutStatus>('quick_bar_shortcut_status').catch(() => null),
      invoke<ToolbarDisplayModeStatus>('quick_bar_display_mode_status').catch(() => null),
    ])
    setStatus(next)
    setShortcutStatus(nextShortcut)
    setDisplayModeStatus(nextDisplayMode)
    return next
  }, [])

  const connect = React.useCallback(async (options?: { restartBackend?: boolean }) => {
    setBusy(true)
    setError(null)
    setPhase('starting')
    closeClient()
    let nextClient: DirectClient | null = null
    try {
      if (options?.restartBackend) await invoke('restart_backend')
      nextClient = await createDirectClient()
      const nextHealth = await nextClient.request<Record<string, unknown>>('quickBar.health')
      clientRef.current = nextClient
      nextClient = null
      setHealth(nextHealth)
      setPhase('ready')
      await refreshStatus()
    } catch (e) {
      nextClient?.close()
      setPhase('failed')
      setError(errorMessage(e, '启动 Quick Bar 后台失败'))
      await refreshStatus()
    } finally {
      setBusy(false)
    }
  }, [closeClient, refreshStatus])

  React.useEffect(() => {
    void invoke('quick_bar_app_ready').catch(() => {})
  }, [])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const [nextLaunchInfo, nextInitialCommand] = await Promise.all([
        invoke<FwLaunchInfo>('fw_launch_info').catch(() => DEFAULT_LAUNCH_INFO),
        invoke<string | null>('fw_initial_command').catch(() => null),
      ])
      if (cancelled) return
      setLaunchInfo(nextLaunchInfo)
      setInitialCommand(nextInitialCommand)
      applyCommandView(nextInitialCommand)
      await refreshStatus()
      if (!cancelled) await connect()
    })()
    return () => {
      cancelled = true
    }
  }, [applyCommandView, connect, refreshStatus])

  React.useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false
    void listen<{ command?: string }>('fw-app-command', event => {
      const command = String(event.payload?.command || '').trim()
      if (command) {
        setRuntimeCommand(command)
        applyCommandView(command)
      }
    })
      .then(nextUnlisten => {
        if (cancelled) nextUnlisten()
        else unlisten = nextUnlisten
      })
      .catch(() => {})
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [applyCommandView])

  React.useEffect(() => () => closeClient(), [closeClient])

  const pickDataDir = React.useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const next = await invoke<DataDirStatus | null>('pick_data_dir')
      if (next) setStatus(next)
      await connect()
    } catch (e) {
      setPhase('failed')
      setError(errorMessage(e, '切换数据目录失败'))
      await refreshStatus()
    } finally {
      setBusy(false)
    }
  }, [connect, refreshStatus])

  const saveShortcut = React.useCallback(async (shortcut: string) => {
    setBusy(true)
    setError(null)
    try {
      const next = await invoke<ShortcutStatus>('set_quick_bar_shortcut', { shortcut })
      setShortcutStatus(next)
    } catch (e) {
      const message = errorMessage(e, '保存 Quick Bar 快捷键失败')
      setError(message)
      await refreshStatus()
      throw new Error(message)
    } finally {
      setBusy(false)
    }
  }, [refreshStatus])

  const saveDisplayMode = React.useCallback(async (mode: ToolbarDisplayMode) => {
    setBusy(true)
    setError(null)
    try {
      const next = await invoke<ToolbarDisplayModeStatus>('set_quick_bar_display_mode', { mode })
      setDisplayModeStatus(next)
    } catch (e) {
      const message = errorMessage(e, '保存 Quick Bar 显示时机失败')
      setError(message)
      await refreshStatus()
      throw new Error(message)
    } finally {
      setBusy(false)
    }
  }, [refreshStatus])

  return (
    <main className="quickbar-app">
      <QuickBarTopbar
        page={page}
        standalone={launchInfo.standalone}
        onNavigate={nextPage => {
          if (nextPage === 'settings') setSettingsTab('overview')
          setPage(nextPage)
        }}
        onStartDragging={() => appWindow.startDragging()}
        windowActions={{
          minimize: () => appWindow.minimize(),
          toggleMaximize: () => appWindow.toggleMaximize(),
          closeToTray: () => invoke<void>('hide_to_tray'),
        }}
      />

      {page === 'settings' ? (
        <SettingsPage
          launchInfo={launchInfo}
          initialCommand={initialCommand}
          runtimeCommand={runtimeCommand}
          status={status}
          shortcutStatus={shortcutStatus}
          displayModeStatus={displayModeStatus}
          health={health}
          activeTab={settingsTab}
          phase={phase}
          busy={busy}
          error={error}
          onTabChange={setSettingsTab}
          onShortcutChange={saveShortcut}
          onDisplayModeChange={saveDisplayMode}
          onPickDataDir={pickDataDir}
          onRestartBackend={() => connect({ restartBackend: true })}
          client={phase === 'ready' ? getClient() : null}
        />
      ) : page === 'capabilities' ? (
        phase === 'ready' ? (
          <CapabilityBrowser client={getClient()} />
        ) : (
          <section className="quickbar-capability-loading" aria-label="后台连接中">
            后台连接中，请稍候...
          </section>
        )
      ) : page === 'buttons' ? (
        phase === 'ready' ? (
          <ButtonManagerPage client={getClient()} onOpenCapabilities={() => setPage('capabilities')} />
        ) : (
          <section className="quickbar-capability-loading" aria-label="后台连接中">
            后台连接中，请稍候...
          </section>
        )
      ) : null}
    </main>
  )
}

const host = document.getElementById('app')
if (host) {
  createRoot(host).render(view === 'toolbar' ? <ToolbarApp /> : view === 'result' ? <ResultPopupApp /> : <App />)
}
