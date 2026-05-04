import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { AiChatApp } from '../ui/App'
import type { AiChatController } from '../controller/types'
import { createAiChatAppRuntime, type AiChatAppRuntime } from './aiChatAppHost'

type DataDirStatus = {
  dataDir: string
  defaultDataDir: string
  configuredDataDir?: string | null
  writable: boolean
  error?: string | null
}

type LaunchInfo = {
  launched: boolean
  standalone: boolean
  mode: string
}

type BootstrapState = {
  schemaVersion?: number
  dataFile?: string
  updatedAt?: number
}

type BootStatus = 'booting' | 'ready' | 'error'
type ToastMessage = {
  id: number
  text: string
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
  const [launchInfo, setLaunchInfo] = React.useState<LaunchInfo>({ launched: false, standalone: true, mode: 'standalone' })
  const [dataDirStatus, setDataDirStatus] = React.useState<DataDirStatus | null>(null)
  const [bootstrap, setBootstrap] = React.useState<BootstrapState | null>(null)
  const [bootStatus, setBootStatus] = React.useState<BootStatus>('booting')
  const [bootError, setBootError] = React.useState('')
  const [pendingCommand, setPendingCommand] = React.useState<string | null>(null)
  const [controller, setController] = React.useState<AiChatController | null>(null)
  const [toast, setToast] = React.useState<ToastMessage | null>(null)
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
    setBootstrap((runtime.bootstrap && typeof runtime.bootstrap === 'object' ? runtime.bootstrap : {}) as BootstrapState)
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
        const info = await invoke<LaunchInfo>('fw_launch_info').catch(() => ({ launched: false, standalone: true, mode: 'standalone' }))
        if (!disposed) setLaunchInfo(info)
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
    try {
      setBootStatus('booting')
      setBootError('')
      const picked = await invoke<DataDirStatus | null>('pick_data_dir')
      if (!picked) {
        setBootStatus(bootstrap ? 'ready' : 'error')
        return
      }
      setDataDirStatus(picked)
      await connectBackend()
    } catch (error: any) {
      setBootStatus('error')
      setBootError(String(error?.message || error || '选择数据目录失败'))
      await refreshDataDirStatus()
    }
  }

  const issue = bootError || dataDirStatus?.error || (dataDirStatus && !dataDirStatus.writable ? '数据目录不可写' : '')

  return (
    <div className="appShell">
      <header className="titlebar" data-tauri-drag-region="true">
        <button className="ghostButton" type="button" onClick={() => getCurrentWindow().hide()} aria-label="隐藏窗口">←</button>
        <div className="titleBlock">
          <div className="appName">AI Studio</div>
          <div className="appMode">{launchInfo.launched ? `FW 受控模式：${launchInfo.mode}` : 'Standalone 桌面模式'}</div>
        </div>
        <button className="ghostButton" type="button" onClick={pickDataDir}>数据目录</button>
        {launchInfo.standalone ? <WindowControls /> : null}
      </header>

      <main className="content">
        {controller && bootStatus === 'ready' && !issue ? (
          <div id="fast-window-ai-chat-root" className="chatHost">
            <AiChatApp controller={controller} />
          </div>
        ) : (
          <StartupPanel
            status={bootStatus}
            issue={issue || ''}
            pendingCommand={commandLabel(pendingCommand)}
            dataDirStatus={dataDirStatus}
            bootstrap={bootstrap}
            onPickDataDir={pickDataDir}
          />
        )}
      </main>
      {toast ? <div className="toast" role="status" aria-live="polite">{toast.text}</div> : null}
    </div>
  )
}

function StatusBadge({ status }: { status: BootStatus }) {
  const label = status === 'ready' ? 'Ready' : status === 'booting' ? 'Starting' : 'Needs Attention'
  return <div className={`statusBadge ${status}`}>{label}</div>
}

function InfoCard(props: { title: string; value: string; detail: string }) {
  return (
    <article className="infoCard">
      <div className="infoTitle">{props.title}</div>
      <div className="infoValue">{props.value}</div>
      <div className="infoDetail">{props.detail}</div>
    </article>
  )
}

function StartupPanel(props: {
  status: BootStatus
  issue: string
  pendingCommand: string | null
  dataDirStatus: DataDirStatus | null
  bootstrap: BootstrapState | null
  onPickDataDir: () => void
}) {
  const { status, issue, pendingCommand, dataDirStatus, bootstrap, onPickDataDir } = props
  return (
    <div className="startupPanel">
      <section className="heroCard">
        <div>
          <p className="eyebrow">v5 App</p>
          <h1>AI Studio 正在启动</h1>
          <p className="heroText">正在连接本机 Go sidecar，并装配旧 AI Chat 的前端业务。窗口先显示，业务状态随后异步恢复。</p>
        </div>
        <StatusBadge status={status} />
      </section>

      {pendingCommand ? (
        <section className="noticeCard">
          <strong>收到命令</strong>
          <span>{pendingCommand}</span>
        </section>
      ) : null}

      {issue ? (
        <section className="errorCard">
          <strong>需要处理</strong>
          <span>{issue}</span>
          <button type="button" onClick={onPickDataDir}>选择可写数据目录</button>
        </section>
      ) : null}

      <section className="grid">
        <InfoCard title="后台状态" value={status === 'ready' ? '已连接' : status === 'booting' ? '连接中' : '异常'} detail="Go sidecar 通过本机 WebSocket 提供业务 API" />
        <InfoCard title="窗口状态" value="已显示" detail="v5 要求前端壳层先显示，不硬等业务加载完成" />
        <InfoCard title="数据状态" value={dataDirStatus?.writable ? '可写' : '检查中'} detail="业务数据写入 AI Studio 自己的数据目录" />
      </section>

      <section className="dataCard">
        <h2>数据目录</h2>
        <dl>
          <dt>当前目录</dt>
          <dd>{dataDirStatus?.dataDir || '读取中...'}</dd>
          <dt>默认目录</dt>
          <dd>{dataDirStatus?.defaultDataDir || '读取中...'}</dd>
          <dt>业务文件</dt>
          <dd>{bootstrap?.dataFile || 'split storage 文件布局'}</dd>
        </dl>
      </section>
    </div>
  )
}

function WindowControls() {
  return (
    <div className="windowControls" aria-label="窗口控制">
      <button type="button" onClick={() => getCurrentWindow().minimize()} aria-label="最小化">−</button>
      <button type="button" onClick={() => getCurrentWindow().toggleMaximize()} aria-label="最大化或还原">□</button>
      <button className="close" type="button" onClick={() => getCurrentWindow().hide()} aria-label="关闭到托盘">×</button>
    </div>
  )
}
