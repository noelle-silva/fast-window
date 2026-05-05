import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { AiChatApp } from '../ui/App'
import { StandaloneWindowControls, type WindowControlActions } from '../ui/components/StandaloneWindowControls'
import type { AiChatController } from '../controller/types'
import { createAiChatAppRuntime, type AiChatAppRuntime } from './aiChatAppHost'

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

const WINDOW_CONTROL_ACTIONS: WindowControlActions = {
  minimize: () => TAURI_WINDOW.minimize(),
  toggleMaximize: () => TAURI_WINDOW.toggleMaximize(),
  closeToTray: () => invoke('hide_to_tray'),
}

function commandLabel(command: string | null | undefined) {
  const id = String(command || '').trim()
  if (!id) return ''
  return COMMAND_LABELS[id] || `未知命令：${id}`
}

const COMMAND_LABELS: Record<string, string> = {
  'new-chat': '新建对话',
  'open-studio': '打开 AI Studio',
  'provider-settings': '模型提供商设置',
}

export function App() {
  const [dataDirStatus, setDataDirStatus] = React.useState<DataDirStatus | null>(null)
  const [dataDirBusy, setDataDirBusy] = React.useState(false)
  const [bootStatus, setBootStatus] = React.useState<BootStatus>('booting')
  const [bootError, setBootError] = React.useState('')
  const [pendingCommand, setPendingCommand] = React.useState<string | null>(null)
  const [controller, setController] = React.useState<AiChatController | null>(null)
  const [toast, setToast] = React.useState<ToastMessage | null>(null)
  const [launchInfo, setLaunchInfo] = React.useState<FwLaunchInfo>({ launched: false, standalone: true, mode: 'standalone' })
  const runtimeRef = React.useRef<AiChatAppRuntime | null>(null)
  const toastSeqRef = React.useRef(0)

  const showToast = React.useCallback((message: unknown) => {
    const text = String((message as any)?.message || message || '').trim()
    if (!text) return
    setToast({ id: ++toastSeqRef.current, text })
  }, [])

  const refreshDataDirStatus = React.useCallback(async () => {
    const status = await invoke<DataDirStatus>('data_dir_status').catch(error => ({
      dataDir: '',
      defaultDataDir: '',
      writable: false,
      error: String((error as any)?.message || error || '读取数据目录状态失败'),
    }))
    setDataDirStatus(status)
    return status
  }, [])

  const connectBackend = React.useCallback(async () => {
    runtimeRef.current?.dispose()
    runtimeRef.current = null
    setController(null)
    const runtime = await createAiChatAppRuntime({
      showToast,
      onBack: () => getCurrentWindow().hide(),
    })
    runtimeRef.current = runtime
    setController(runtime.controller)
    setBootStatus('ready')
    setBootError('')
    return runtime
  }, [showToast])

  const handleCommand = React.useCallback((command: string | null | undefined) => {
    const id = String(command || '').trim()
    if (!id) return
    setPendingCommand(id)
  }, [])

  React.useEffect(() => {
    if (!controller || bootStatus !== 'ready' || !pendingCommand) return
    const command = pendingCommand
    setPendingCommand(null)

    if (command === 'open-studio') return
    if (command === 'new-chat') {
      Promise.resolve(controller.actions.createChat?.()).catch(error => showToast(error))
      return
    }
    if (command === 'provider-settings') {
      Promise.resolve(controller.actions.openProviders?.()).catch(error => showToast(error))
      return
    }

    showToast(`未知命令：${command}`)
  }, [bootStatus, controller, pendingCommand, showToast])

  React.useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | null = null

    async function boot() {
      try {
        const info = await invoke<FwLaunchInfo>('fw_launch_info').catch(() => null)
        if (!disposed && info) setLaunchInfo(normalizeLaunchInfo(info))
        const command = await invoke<string | null>('fw_initial_command').catch(() => null)
        if (!disposed) handleCommand(command)
        unlisten = await listen<{ command?: string }>('fw-app-command', event => handleCommand(event.payload?.command))
        await invoke('app_ready').catch(() => {})
        await refreshDataDirStatus()
        if (!disposed) setBootStatus('booting')
        await connectBackend()
      } catch (error: any) {
        if (disposed) return
        setBootStatus('error')
        setBootError(String(error?.message || error || 'AI Studio 启动失败'))
        await refreshDataDirStatus()
        await invoke('app_ready').catch(() => {})
      }
    }

    boot()
    return () => {
      disposed = true
      if (unlisten) unlisten()
      runtimeRef.current?.dispose()
      runtimeRef.current = null
    }
  }, [connectBackend, handleCommand, refreshDataDirStatus])

  React.useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(current => current?.id === toast.id ? null : current), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function pickDataDir() {
    const previousStatus = bootStatus
    try {
      setDataDirBusy(true)
      setBootError('')
      const picked = await invoke<DataDirStatus | null>('pick_data_dir')
      if (!picked) {
        setBootStatus(controller ? 'ready' : previousStatus)
        return
      }
      setDataDirStatus(picked)
      await connectBackend()
    } catch (error: any) {
      setBootStatus('error')
      setBootError(String(error?.message || error || '选择数据目录失败'))
      await refreshDataDirStatus()
    } finally {
      setDataDirBusy(false)
    }
  }

  const issue = bootError || dataDirStatus?.error || (dataDirStatus && !dataDirStatus.writable ? '数据目录不可写' : '')

  return (
    <div className="appShell">
      {controller && bootStatus === 'ready' && !issue ? (
        <div id="fast-window-ai-chat-root" className="chatHost">
          <AiChatApp
            controller={controller}
            dataDirectory={{
              status: dataDirStatus,
              busy: dataDirBusy,
              onPick: pickDataDir,
              onRefresh: refreshDataDirStatus,
            }}
            windowControls={{
              standalone: launchInfo.standalone,
              actions: WINDOW_CONTROL_ACTIONS,
            }}
          />
        </div>
      ) : (
        <BootFallback
          status={bootStatus}
          issue={issue || ''}
          pendingCommand={commandLabel(pendingCommand)}
          standalone={launchInfo.standalone}
          windowControlActions={WINDOW_CONTROL_ACTIONS}
          onPickDataDir={pickDataDir}
        />
      )}
      {toast ? <div className="toast" role="status" aria-live="polite">{toast.text}</div> : null}
    </div>
  )
}

function normalizeLaunchInfo(raw: FwLaunchInfo): FwLaunchInfo {
  return {
    launched: !!raw?.launched,
    standalone: raw?.standalone !== false,
    mode: String(raw?.mode || (raw?.standalone === false ? 'default' : 'standalone')),
  }
}

function BootFallback(props: {
  status: BootStatus
  issue: string
  pendingCommand: string | null
  standalone: boolean
  windowControlActions: WindowControlActions
  onPickDataDir: () => void
}) {
  const { status, issue, pendingCommand, standalone, windowControlActions, onPickDataDir } = props
  const title = issue ? 'AI Studio 启动遇到问题' : 'AI Studio 正在启动'
  return (
    <main className="bootFallback" role={issue ? 'alert' : 'status'} aria-live="polite">
      <header className="bootFallbackTopbar" data-tauri-drag-region="true">
        <div className="bootFallbackBrand">AI Studio</div>
        {standalone ? <StandaloneWindowControls actions={windowControlActions} /> : null}
      </header>
      <section className="bootFallbackCard">
        <div className="bootFallbackTitle">{title}</div>
        <div className="bootFallbackText">{status === 'booting' ? '正在连接本机后台，请稍等。' : '请处理下面的问题后重试。'}</div>
      {pendingCommand ? (
          <div className="bootFallbackText">待处理命令：{pendingCommand}</div>
      ) : null}
      {issue ? (
          <>
            <div className="bootFallbackIssue">{issue}</div>
            <button type="button" onClick={onPickDataDir}>选择可写数据目录</button>
          </>
      ) : null}
      </section>
    </main>
  )
}
