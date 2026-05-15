import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { AiDrawApp, type AiDrawRuntimeCommand } from '../ui/App'
import { createAiDrawDirectGateway } from '../gateway/createAiDrawDirectGateway'
import type { AiDrawGateway, AiDrawWindowControlActions } from '../gateway/types'
import { AI_DRAW_DIRECT_PROTOCOL_VERSION } from '../shared/protocol'
import { tauriClipboard } from './tauriClipboard'

type BackendEndpoint = {
  url: string
  token: string
}

type DataDirStatus = {
  dataDir: string
  defaultDataDir: string
  configuredDataDir?: string | null
  writable: boolean
  error?: string | null
}

type BootStatus = 'booting' | 'ready' | 'error'
type ToastMessage = {
  id: number
  text: string
}

type FwLaunchInfo = {
  launched: boolean
  standalone: boolean
  mode: string
}

const TAURI_WINDOW = getCurrentWindow()

const WINDOW_CONTROL_ACTIONS: AiDrawWindowControlActions = {
  minimize: () => TAURI_WINDOW.minimize(),
  toggleMaximize: () => TAURI_WINDOW.toggleMaximize(),
  closeToTray: () => invoke('hide_to_tray'),
}

const COMMAND_LABELS: Record<string, string> = {
  'open-settings': '设置',
  'provider-settings': '绘图供应商设置',
}

function commandLabel(command: string | null | undefined) {
  const id = String(command || '').trim()
  if (!id) return ''
  return COMMAND_LABELS[id] || `未知命令：${id}`
}

export function App() {
  const [bootStatus, setBootStatus] = React.useState<BootStatus>('booting')
  const [bootError, setBootError] = React.useState('')
  const [dataDirStatus, setDataDirStatus] = React.useState<DataDirStatus | null>(null)
  const [repairing, setRepairing] = React.useState(false)
  const [pendingCommand, setPendingCommand] = React.useState<AiDrawRuntimeCommand | null>(null)
  const [gateway, setGateway] = React.useState<AiDrawGateway | null>(null)
  const [toast, setToast] = React.useState<ToastMessage | null>(null)
  const gatewayRef = React.useRef<AiDrawGateway | null>(null)
  const toastSeqRef = React.useRef(0)
  const commandSeqRef = React.useRef(0)

  const showToast = React.useCallback((message: unknown) => {
    const text = String((message as any)?.message || message || '').trim()
    if (!text) return
    setToast({ id: ++toastSeqRef.current, text })
  }, [])

  const handleCommand = React.useCallback((command: string | null | undefined) => {
    const id = String(command || '').trim()
    if (!id) return
    setPendingCommand({ id, seq: ++commandSeqRef.current })
  }, [])

  const handleCommandHandled = React.useCallback((seq: number) => {
    setPendingCommand(current => current?.seq === seq ? null : current)
  }, [])

  const bootGateway = React.useCallback(async () => {
    const gateway = await createAiDrawDirectGateway({
      loadEndpoint: loadBackendEndpoint,
      host: {
        back: () => invoke('hide_to_tray'),
        toast: showToast,
        startDragging: () => getCurrentWindow().startDragging(),
        clipboard: tauriClipboard,
        pickOutputDir: () => invoke<string | null>('pick_output_dir'),
        pickExportDir: () => invoke<string | null>('pick_export_dir'),
        openOutputDir: (path) => invoke('open_output_dir', { path }),
      },
    })
    return gateway
  }, [showToast])

  const refreshDataDirStatus = React.useCallback(async () => {
    const status = await invoke<DataDirStatus>('data_dir_status').catch(() => null)
    setDataDirStatus(status)
    return status
  }, [])

  const retryBoot = React.useCallback(async () => {
    setRepairing(true)
    setBootStatus('booting')
    setBootError('')
    try {
      const launchInfo = await invoke<FwLaunchInfo>('fw_launch_info').catch(() => null)
      const normalizedLaunchInfo = normalizeLaunchInfo(launchInfo)
      await invoke('restart_backend')
      const nextGateway = await bootGateway()
      nextGateway.windowControls = {
        standalone: normalizedLaunchInfo.standalone,
        actions: WINDOW_CONTROL_ACTIONS,
      }
      gatewayRef.current?.close?.()
      gatewayRef.current = nextGateway
      setGateway(nextGateway)
      setBootStatus('ready')
      await refreshDataDirStatus()
    } catch (error: any) {
      setGateway(null)
      setBootStatus('error')
      setBootError(String(error?.message || error || 'AI 绘图启动失败'))
      await refreshDataDirStatus()
    } finally {
      setRepairing(false)
    }
  }, [bootGateway, refreshDataDirStatus])

  const pickDataDirAndRetry = React.useCallback(async () => {
    setRepairing(true)
    try {
      const status = await invoke<DataDirStatus | null>('pick_data_dir')
      if (!status) return
      setDataDirStatus(status)
      await retryBoot()
    } catch (error: any) {
      setBootStatus('error')
      setBootError(String(error?.message || error || '数据目录修复失败'))
      await refreshDataDirStatus()
    } finally {
      setRepairing(false)
    }
  }, [refreshDataDirStatus, retryBoot])

  React.useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | null = null

    async function boot() {
      try {
        const info = await invoke<FwLaunchInfo>('fw_launch_info').catch(() => null)
        const normalizedLaunchInfo = normalizeLaunchInfo(info)
        const command = await invoke<string | null>('fw_initial_command').catch(() => null)
        if (!disposed) handleCommand(command)
        unlisten = await listen<{ command?: string }>('fw-app-command', event => handleCommand(event.payload?.command))
        await invoke('app_ready').catch(() => {})

        const gateway = await bootGateway()
        if (disposed) {
          gateway.close?.()
          return
        }
        gateway.windowControls = {
          standalone: normalizedLaunchInfo.standalone,
          actions: WINDOW_CONTROL_ACTIONS,
        }
        gatewayRef.current = gateway
        setGateway(gateway)
        setBootStatus('ready')
        setBootError('')
        await refreshDataDirStatus()
      } catch (error: any) {
        if (disposed) return
        setGateway(null)
        setBootStatus('error')
        setBootError(String(error?.message || error || 'AI 绘图启动失败'))
        await refreshDataDirStatus()
        await invoke('app_ready').catch(() => {})
      }
    }

    boot()
    return () => {
      disposed = true
      if (unlisten) unlisten()
      gatewayRef.current?.close?.()
      gatewayRef.current = null
    }
  }, [bootGateway, handleCommand, refreshDataDirStatus])

  React.useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(current => current?.id === toast.id ? null : current), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  return (
    <div className="appShell">
      {gateway && bootStatus === 'ready' ? (
        <AiDrawApp gateway={gateway} command={pendingCommand} onCommandHandled={handleCommandHandled} />
      ) : (
        <BootFallback
          status={bootStatus}
          issue={bootError}
          pendingCommand={commandLabel(pendingCommand?.id)}
          dataDirStatus={dataDirStatus}
          repairing={repairing}
          onRetry={retryBoot}
          onPickDataDir={pickDataDirAndRetry}
        />
      )}
      {toast ? <div className="toast" role="status" aria-live="polite">{toast.text}</div> : null}
    </div>
  )
}

function normalizeLaunchInfo(raw: FwLaunchInfo | null): FwLaunchInfo {
  return {
    launched: !!raw?.launched,
    standalone: raw?.standalone !== false,
    mode: String(raw?.mode || (raw?.standalone === false ? 'default' : 'standalone')),
  }
}

async function loadBackendEndpoint() {
  const endpoint = await invoke<BackendEndpoint>('backend_endpoint')
  return {
    mode: 'direct',
    transport: 'local-websocket',
    protocolVersion: AI_DRAW_DIRECT_PROTOCOL_VERSION,
    url: endpoint.url,
    token: endpoint.token,
  }
}

function BootFallback(props: {
  status: BootStatus
  issue: string
  pendingCommand: string | null
  dataDirStatus: DataDirStatus | null
  repairing: boolean
  onRetry: () => void
  onPickDataDir: () => void
}) {
  const { status, issue, pendingCommand, dataDirStatus, repairing, onRetry, onPickDataDir } = props
  const title = issue ? 'AI 绘图启动遇到问题' : 'AI 绘图正在启动'
  const canRepair = status === 'error'
  return (
    <main className="bootFallback" role={issue ? 'alert' : 'status'} aria-live="polite">
      <section className="bootFallbackCard">
        <div className="bootFallbackTitle">{title}</div>
        <div className="bootFallbackText">{status === 'booting' ? '正在连接本机后台，请稍等。' : '请处理下面的问题后重试。'}</div>
        {pendingCommand ? <div className="bootFallbackText">待处理命令：{pendingCommand}</div> : null}
        {dataDirStatus ? <div className="bootFallbackText">当前数据目录：{dataDirStatus.dataDir}</div> : null}
        {issue ? <div className="bootFallbackIssue">{issue}</div> : null}
        {canRepair ? (
          <div className="bootFallbackActions">
            <button type="button" className="bootFallbackButton" onClick={onPickDataDir} disabled={repairing}>
              选择新数据目录并重试
            </button>
            <button type="button" className="bootFallbackButton secondary" onClick={onRetry} disabled={repairing}>
              重新启动后台
            </button>
          </div>
        ) : null}
      </section>
    </main>
  )
}
