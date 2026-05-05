import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { AiDrawApp } from '../ui/App'
import { createAiDrawDirectGateway } from '../gateway/createAiDrawDirectGateway'
import type { AiDrawGateway, AiDrawWindowControlActions } from '../gateway/types'
import { AI_DRAW_DIRECT_PROTOCOL_VERSION } from '../shared/protocol'

type BackendEndpoint = {
  url: string
  token: string
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
  'open-draw': '打开 AI 绘图',
  'new-generation': '新建绘图',
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
  const [pendingCommand, setPendingCommand] = React.useState<string | null>(null)
  const [gateway, setGateway] = React.useState<AiDrawGateway | null>(null)
  const [toast, setToast] = React.useState<ToastMessage | null>(null)
  const gatewayRef = React.useRef<AiDrawGateway | null>(null)
  const toastSeqRef = React.useRef(0)

  const showToast = React.useCallback((message: unknown) => {
    const text = String((message as any)?.message || message || '').trim()
    if (!text) return
    setToast({ id: ++toastSeqRef.current, text })
  }, [])

  const handleCommand = React.useCallback((command: string | null | undefined) => {
    const id = String(command || '').trim()
    if (!id) return
    setPendingCommand(id)
  }, [])

  React.useEffect(() => {
    if (bootStatus !== 'ready' || !pendingCommand) return
    const command = pendingCommand
    setPendingCommand(null)

    if (command === 'open-draw') return
    if (command === 'new-generation') {
      showToast('已打开 AI 绘图')
      return
    }
    if (command === 'provider-settings') {
      showToast('请从右上角设置进入供应商配置')
      return
    }

    showToast(`未知命令：${command}`)
  }, [bootStatus, pendingCommand, showToast])

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

        const gateway = await createAiDrawDirectGateway({
          loadEndpoint: loadBackendEndpoint,
          host: {
            back: () => invoke('hide_to_tray'),
            toast: showToast,
            startDragging: () => getCurrentWindow().startDragging(),
            pickOutputDir: () => invoke<string | null>('pick_output_dir'),
            openOutputDir: (path) => invoke('open_output_dir', { path }),
          },
        })
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
      } catch (error: any) {
        if (disposed) return
        setGateway(null)
        setBootStatus('error')
        setBootError(String(error?.message || error || 'AI 绘图启动失败'))
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
  }, [handleCommand, showToast])

  React.useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(current => current?.id === toast.id ? null : current), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  return (
    <div className="appShell">
      {gateway && bootStatus === 'ready' ? (
        <AiDrawApp gateway={gateway} />
      ) : (
        <BootFallback status={bootStatus} issue={bootError} pendingCommand={commandLabel(pendingCommand)} />
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

function BootFallback(props: { status: BootStatus; issue: string; pendingCommand: string | null }) {
  const { status, issue, pendingCommand } = props
  const title = issue ? 'AI 绘图启动遇到问题' : 'AI 绘图正在启动'
  return (
    <main className="bootFallback" role={issue ? 'alert' : 'status'} aria-live="polite">
      <section className="bootFallbackCard">
        <div className="bootFallbackTitle">{title}</div>
        <div className="bootFallbackText">{status === 'booting' ? '正在连接本机后台，请稍等。' : '请处理下面的问题后重试。'}</div>
        {pendingCommand ? <div className="bootFallbackText">待处理命令：{pendingCommand}</div> : null}
        {issue ? <div className="bootFallbackIssue">{issue}</div> : null}
      </section>
    </main>
  )
}
