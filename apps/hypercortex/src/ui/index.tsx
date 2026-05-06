import '../render/vendor'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { HyperCortexApp } from './App'
import type { WindowControlActions } from './StandaloneWindowControls'
import { StartupRecovery, type StartupRecoveryPhase } from './StartupRecovery'
import { getHyperCortexGateway, resetHyperCortexGateway } from '../gateway'
import type { DataDirStatus, HyperCortexGateway } from '../gateway'

const host = document.getElementById('app') || document.body
const TAURI_WINDOW = getCurrentWindow()

type FwLaunchInfo = {
  launched: boolean
  standalone: boolean
  mode: string
}

const WINDOW_CONTROL_ACTIONS: WindowControlActions = {
  minimize: () => TAURI_WINDOW.minimize(),
  toggleMaximize: () => TAURI_WINDOW.toggleMaximize(),
  closeToTray: () => invoke('hide_to_tray'),
}

const DEFAULT_LAUNCH_INFO: FwLaunchInfo = {
  launched: false,
  standalone: true,
  mode: 'standalone',
}

function errorMessage(error: unknown, fallback: string): string {
  return String((error as any)?.message || error || fallback)
}

function HyperCortexBootstrap() {
  const [launchInfo, setLaunchInfo] = React.useState<FwLaunchInfo>(DEFAULT_LAUNCH_INFO)
  const [initialCommand, setInitialCommand] = React.useState<string | null>(null)
  const [gateway, setGateway] = React.useState<HyperCortexGateway | null>(null)
  const [phase, setPhase] = React.useState<StartupRecoveryPhase>('starting')
  const [error, setError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<DataDirStatus | null>(null)
  const [busy, setBusy] = React.useState(false)
  const bootSeqRef = React.useRef(0)
  const appReadyRef = React.useRef(false)
  const gatewayReadyRef = React.useRef(false)

  const markAppReady = React.useCallback(() => {
    if (appReadyRef.current) return
    appReadyRef.current = true
    void invoke('app_ready').catch(() => {})
  }, [])

  const refreshStatus = React.useCallback(async (): Promise<DataDirStatus | null> => {
    try {
      const next = await invoke<DataDirStatus>('data_dir_status')
      setStatus(next)
      return next
    } catch {
      setStatus(null)
      return null
    }
  }, [])

  const connectGateway = React.useCallback(async (options?: { restartBackend?: boolean }) => {
    const seq = ++bootSeqRef.current
    setBusy(true)
    setGateway(null)
    setPhase('starting')
    setError(null)
    try {
      if (options?.restartBackend) await invoke('restart_backend')
      resetHyperCortexGateway()
      const nextGateway = await getHyperCortexGateway()
      if (seq !== bootSeqRef.current) return
      setGateway(nextGateway)
    } catch (e) {
      resetHyperCortexGateway()
      if (seq !== bootSeqRef.current) return
      await refreshStatus()
      setPhase('failed')
      setError(errorMessage(e, 'HyperCortex 后台未就绪'))
    } finally {
      if (seq === bootSeqRef.current) setBusy(false)
    }
  }, [refreshStatus])

  const handleRetry = React.useCallback(async () => {
    await connectGateway({ restartBackend: true })
  }, [connectGateway])

  const handlePickDataDir = React.useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const next = await invoke<DataDirStatus | null>('pick_data_dir')
      if (!next) return
      setStatus(next)
      await connectGateway()
    } catch (e) {
      await refreshStatus()
      setPhase('failed')
      setError(errorMessage(e, '切换数据目录后启动后台失败'))
    } finally {
      setBusy(false)
    }
  }, [connectGateway, refreshStatus])

  React.useEffect(() => {
    markAppReady()
  }, [markAppReady])

  React.useEffect(() => {
    gatewayReadyRef.current = Boolean(gateway)
  }, [gateway])

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
      if (cancelled) return
      await connectGateway()
    })()
    return () => {
      cancelled = true
    }
  }, [connectGateway, refreshStatus])

  React.useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false
    void listen<{ command?: string }>('fw-app-command', event => {
      const command = String(event.payload?.command || '').trim()
      if (!command) return
      if (!gatewayReadyRef.current) {
        setInitialCommand(command)
        return
      }
      window.dispatchEvent(new CustomEvent('hypercortex-command', { detail: { command } }))
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

  const windowControls = React.useMemo(() => ({
    standalone: launchInfo.standalone !== false,
    actions: WINDOW_CONTROL_ACTIONS,
  }), [launchInfo.standalone])

  if (gateway) {
    return (
      <HyperCortexApp
        gateway={gateway}
        initialCommand={initialCommand}
        windowControls={windowControls}
      />
    )
  }

  return (
    <StartupRecovery
      phase={phase}
      error={error}
      status={status}
      busy={busy}
      windowControls={windowControls}
      onRetry={handleRetry}
      onPickDataDir={handlePickDataDir}
      onStartDragging={() => TAURI_WINDOW.startDragging()}
    />
  )
}

function bootstrap() {
  if (!host) return
  const root = createRoot(host)
  root.render(<HyperCortexBootstrap />)
}

bootstrap()
