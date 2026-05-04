import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createDirectClient, type DirectClient } from './directClient'

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
  conversations?: Array<{ id: string; title: string; updatedAt: number }>
  providers?: Array<{ id: string; name: string; kind: string }>
  dataFile?: string
  updatedAt?: number
}

type BootStatus = 'booting' | 'ready' | 'error'

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
  const clientRef = React.useRef<DirectClient | null>(null)

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
    clientRef.current?.close()
    clientRef.current = null
    const endpoint = await invoke<{ url: string; token: string }>('backend_endpoint')
    const client = await createDirectClient(endpoint)
    clientRef.current = client
    const result = await client.invoke<BootstrapState>('studio.bootstrap')
    setBootstrap(result)
    setBootStatus('ready')
    setBootError('')
    return client
  }, [])

  const handleCommand = React.useCallback((command: string | null | undefined) => {
    const id = String(command || '').trim()
    if (!id) return
    setPendingCommand(COMMAND_LABELS[id] || `未知命令：${id}`)
  }, [])

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
      clientRef.current?.close()
      clientRef.current = null
    }
  }, [connectBackend, handleCommand, refreshDataDirStatus])

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
  const conversationCount = bootstrap?.conversations?.length ?? 0
  const providerCount = bootstrap?.providers?.length ?? 0

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
        <section className="heroCard">
          <div>
            <p className="eyebrow">v5 App Skeleton</p>
            <h1>AI Studio 正在 App 化</h1>
            <p className="heroText">当前阶段已接入独立 Tauri 壳、Go sidecar、v5 运行时控制和数据目录机制。完整 AI 聊天业务将在下一阶段从旧插件模块迁移进来。</p>
          </div>
          <StatusBadge status={bootStatus} />
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
            <button type="button" onClick={pickDataDir}>选择可写数据目录</button>
          </section>
        ) : null}

        <section className="grid">
          <InfoCard title="后台状态" value={bootStatus === 'ready' ? '已连接' : bootStatus === 'booting' ? '连接中' : '异常'} detail="Go sidecar 通过本机 WebSocket 提供业务 API" />
          <InfoCard title="会话数量" value={String(conversationCount)} detail="第一阶段只建立数据主链路，业务迁移后接入完整会话" />
          <InfoCard title="Provider" value={String(providerCount)} detail="模型提供商设置将在业务迁移阶段接入" />
        </section>

        <section className="dataCard">
          <h2>数据目录</h2>
          <dl>
            <dt>当前目录</dt>
            <dd>{dataDirStatus?.dataDir || '读取中...'}</dd>
            <dt>默认目录</dt>
            <dd>{dataDirStatus?.defaultDataDir || '读取中...'}</dd>
            <dt>业务文件</dt>
            <dd>{bootstrap?.dataFile || '后台连接后显示'}</dd>
          </dl>
        </section>
      </main>
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

function WindowControls() {
  return (
    <div className="windowControls" aria-label="窗口控制">
      <button type="button" onClick={() => getCurrentWindow().minimize()} aria-label="最小化">−</button>
      <button type="button" onClick={() => getCurrentWindow().toggleMaximize()} aria-label="最大化或还原">□</button>
      <button className="close" type="button" onClick={() => getCurrentWindow().hide()} aria-label="关闭到托盘">×</button>
    </div>
  )
}
