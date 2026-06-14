import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createDirectClient } from './directClient'
import { fetchRegistryButtons } from './registryClient'
import { QuickBarTopbar } from './QuickBarTopbar'
import { SettingsPage, type SettingsTab } from './SettingsPage'
import { CapabilityBrowser } from './CapabilityBrowser'
import { ToolbarApp } from './ToolbarApp'
import type { DataDirStatus, DirectClient, FwLaunchInfo, ShortcutStatus } from './types'
import { DEFAULT_LAUNCH_INFO } from './types'
import './styles.css'

const appWindow = getCurrentWindow()
const isToolbarView = new URLSearchParams(window.location.search).get('view') === 'toolbar'

function errorMessage(error: unknown, fallback: string): string {
  return String((error as { message?: string })?.message || error || fallback)
}

function App() {
  const [page, setPage] = React.useState<'home' | 'settings' | 'capabilities'>('home')
  const [settingsTab, setSettingsTab] = React.useState<SettingsTab>('overview')
  const [launchInfo, setLaunchInfo] = React.useState<FwLaunchInfo>(DEFAULT_LAUNCH_INFO)
  const [initialCommand, setInitialCommand] = React.useState<string | null>(null)
  const [runtimeCommand, setRuntimeCommand] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<DataDirStatus | null>(null)
  const [shortcutStatus, setShortcutStatus] = React.useState<ShortcutStatus | null>(null)
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
    const [next, nextShortcut] = await Promise.all([
      invoke<DataDirStatus>('data_dir_status').catch(() => null),
      invoke<ShortcutStatus>('quick_bar_shortcut_status').catch(() => null),
    ])
    setStatus(next)
    setShortcutStatus(nextShortcut)
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

  return (
    <main className="quickbar-app">
      <QuickBarTopbar
        page={page}
        standalone={launchInfo.standalone}
        onBack={() => setPage('home')}
        onOpenSettings={() => {
          setSettingsTab('overview')
          setPage('settings')
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
          health={health}
          activeTab={settingsTab}
          phase={phase}
          busy={busy}
          error={error}
          onTabChange={setSettingsTab}
          onShortcutChange={saveShortcut}
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
      ) : (
        <QuickBarHome
          phase={phase}
          runtimeCommand={runtimeCommand}
          shortcutStatus={shortcutStatus}
          onOpenSettings={() => {
            setSettingsTab('overview')
            setPage('settings')
          }}
          onOpenCapabilities={() => setPage('capabilities')}
          getClient={getClient}
        />
      )}
    </main>
  )
}

function QuickBarHome(props: {
  phase: 'starting' | 'ready' | 'failed'
  runtimeCommand: string | null
  shortcutStatus: ShortcutStatus | null
  onOpenSettings: () => void
  onOpenCapabilities: () => void
  getClient: () => DirectClient
}) {
  const [buttonCount, setButtonCount] = React.useState<number | null>(null)
  const [buttonCountError, setButtonCountError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setButtonCount(null)
    setButtonCountError(null)
    if (props.phase !== 'ready') return
    let cancelled = false
    void fetchRegistryButtons(props.getClient())
      .then(buttons => { if (!cancelled) setButtonCount(buttons.length) })
      .catch(e => {
        if (!cancelled) setButtonCountError(errorMessage(e, '读取已注册按钮失败'))
      })
    return () => { cancelled = true }
  }, [props.phase, props.getClient])

  return (
    <section className="quickbar-home" aria-label="Quick Bar 管理主页">
      <div className="quickbar-hero">
        <p className="quickbar-eyebrow">划词助手 · Phase 4</p>
        <h1>Quick Bar</h1>
        <p>选中文字后，按下 Quick Bar 自己保存的快捷键，在选区附近唤起一条轻量浮动工具栏。</p>
        <div className="quickbar-hero-actions">
          <button type="button" onClick={props.onOpenSettings}>配置与状态</button>
          <button type="button" onClick={props.onOpenCapabilities}>能力浏览</button>
        </div>
      </div>

      <div className="quickbar-home-grid">
        <article className="quickbar-panel quickbar-panel-dark">
          <h2>当前目标</h2>
          <p className="quickbar-muted">从宿主能力平台选取能力，注册为悬浮栏按钮，划词后点击按钮即可调用。</p>
        </article>
        <article className="quickbar-panel">
          <h2>运行状态</h2>
          <div className={`quickbar-status-badge quickbar-status-${props.phase}`}>
            {props.phase === 'ready' ? '后台可用' : props.phase === 'failed' ? '需要处理' : '启动中'}
          </div>
          <p className="quickbar-muted">最近命令：{props.runtimeCommand || '暂无'}</p>
          <p className="quickbar-muted">唤醒快捷键：{props.shortcutStatus?.shortcut || '读取中'}</p>
        </article>
        <article className="quickbar-panel quickbar-action-preview">
          <h2>已注册按钮</h2>
          <p className="quickbar-muted">
            {buttonCountError || (buttonCount === null ? '读取中...' : buttonCount === 0 ? '暂无已注册的能力按钮，请前往能力浏览选取。' : `已注册 ${buttonCount} 个按钮`)}
          </p>
        </article>
      </div>
    </section>
  )
}

const host = document.getElementById('app')
if (host) createRoot(host).render(isToolbarView ? <ToolbarApp /> : <App />)
