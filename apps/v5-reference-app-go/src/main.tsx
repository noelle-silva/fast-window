import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createDirectClient } from './directClient'
import { ReferenceTopbar } from './ReferenceTopbar'
import { SettingsPage } from './SettingsPage'
import type { DataDirStatus, DirectClient, FwLaunchInfo, ReferenceSettings } from './types'
import { DEFAULT_LAUNCH_INFO } from './types'
import './styles.css'

const appWindow = getCurrentWindow()

function errorMessage(error: unknown, fallback: string): string {
  return String((error as { message?: string })?.message || error || fallback)
}

function App() {
  const [page, setPage] = React.useState<'home' | 'settings'>('home')
  const [launchInfo, setLaunchInfo] = React.useState<FwLaunchInfo>(DEFAULT_LAUNCH_INFO)
  const [initialCommand, setInitialCommand] = React.useState<string | null>(null)
  const [runtimeCommand, setRuntimeCommand] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<DataDirStatus | null>(null)
  const [settings, setSettings] = React.useState<ReferenceSettings | null>(null)
  const [message, setMessage] = React.useState('')
  const [health, setHealth] = React.useState<Record<string, unknown> | null>(null)
  const [client, setClient] = React.useState<DirectClient | null>(null)
  const [phase, setPhase] = React.useState<'starting' | 'ready' | 'failed'>('starting')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const readyRef = React.useRef(false)

  const markAppReady = React.useCallback(() => {
    if (readyRef.current) return
    readyRef.current = true
    void invoke('app_ready').catch(() => {})
  }, [])

  const refreshStatus = React.useCallback(async () => {
    const next = await invoke<DataDirStatus>('data_dir_status').catch(() => null)
    setStatus(next)
    return next
  }, [])

  const connect = React.useCallback(async (options?: { restartBackend?: boolean }) => {
    setBusy(true)
    setError(null)
    setPhase('starting')
    client?.close()
    setClient(null)
    try {
      if (options?.restartBackend) await invoke('restart_backend')
      const nextClient = await createDirectClient()
      const [nextSettings, nextHealth] = await Promise.all([
        nextClient.request<ReferenceSettings>('reference.settings.get'),
        nextClient.request<Record<string, unknown>>('reference.health'),
      ])
      setClient(nextClient)
      setSettings(nextSettings)
      setMessage(nextSettings.message)
      setHealth(nextHealth)
      setPhase('ready')
      await refreshStatus()
    } catch (e) {
      setPhase('failed')
      setError(errorMessage(e, '启动 v5 reference Go 后台失败'))
      await refreshStatus()
    } finally {
      setBusy(false)
    }
  }, [client, refreshStatus])

  React.useEffect(() => {
    markAppReady()
  }, [markAppReady])

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
      await refreshStatus()
      if (!cancelled) await connect()
    })()
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false
    void listen<{ command?: string }>('fw-app-command', event => {
      const command = String(event.payload?.command || '').trim()
      if (command) setRuntimeCommand(command)
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
  }, [])

  React.useEffect(() => () => client?.close(), [client])

  const saveSettings = React.useCallback(async () => {
    if (!client) return
    setBusy(true)
    setError(null)
    try {
      const saved = await client.request<ReferenceSettings>('reference.settings.save', { message })
      setSettings(saved)
    } catch (e) {
      setError(errorMessage(e, '保存设置失败'))
    } finally {
      setBusy(false)
    }
  }, [client, message])

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

  return (
    <main className="reference-app">
      <ReferenceTopbar
        page={page}
        standalone={launchInfo.standalone}
        onBack={() => setPage('home')}
        onOpenSettings={() => setPage('settings')}
        onStartDragging={() => appWindow.startDragging()}
        windowActions={{
          minimize: () => appWindow.minimize(),
          toggleMaximize: () => appWindow.toggleMaximize(),
          closeToTray: () => invoke('hide_to_tray'),
        }}
      />

      {page === 'settings' ? (
        <SettingsPage
          launchInfo={launchInfo}
          initialCommand={initialCommand}
          runtimeCommand={runtimeCommand}
          status={status}
          settings={settings}
          message={message}
          health={health}
          client={client}
          phase={phase}
          busy={busy}
          error={error}
          onMessageChange={setMessage}
          onSaveSettings={saveSettings}
          onPickDataDir={pickDataDir}
          onRestartBackend={() => connect({ restartBackend: true })}
        />
      ) : null}
    </main>
  )
}

const host = document.getElementById('app')
if (host) createRoot(host).render(<App />)
