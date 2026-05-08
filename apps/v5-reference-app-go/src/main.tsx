import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './styles.css'

const appWindow = getCurrentWindow()

type FwLaunchInfo = {
  launched: boolean
  standalone: boolean
  mode: string
}

type DataDirStatus = {
  dataDir: string
  defaultDataDir: string
  configuredDataDir?: string | null
  writable: boolean
  error?: string | null
}

type BackendEndpoint = {
  mode: 'direct'
  transport: 'local-websocket'
  url: string
  token: string
  protocolVersion: number
}

type ReferenceSettings = {
  schemaVersion: number
  dataVersion: number
  message: string
  updatedAt: string
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type DirectClient = {
  request<T>(method: string, params?: unknown): Promise<T>
  close(): void
}

const DEFAULT_LAUNCH_INFO: FwLaunchInfo = {
  launched: false,
  standalone: true,
  mode: 'standalone',
}

const OPEN_TIMEOUT_MS = 15_000
const REQUEST_TIMEOUT_MS = 30_000

function errorMessage(error: unknown, fallback: string): string {
  return String((error as { message?: string })?.message || error || fallback)
}

function endpointUrlWithToken(endpoint: BackendEndpoint): string {
  if (endpoint.mode !== 'direct') throw new Error('后台 endpoint mode 必须是 direct')
  if (endpoint.transport !== 'local-websocket') throw new Error('后台 endpoint transport 必须是 local-websocket')
  if (endpoint.protocolVersion !== 1) throw new Error('后台 endpoint protocolVersion 必须是 1')
  if (!endpoint.url.startsWith('ws://127.0.0.1:')) throw new Error('后台 endpoint 必须绑定 127.0.0.1')
  if (!endpoint.token) throw new Error('后台 endpoint token 缺失')
  const sep = endpoint.url.includes('?') ? '&' : '?'
  return `${endpoint.url}${sep}token=${encodeURIComponent(endpoint.token)}`
}

function waitForOpen(ws: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('后台连接超时')), OPEN_TIMEOUT_MS)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('后台连接失败'))
    }, { once: true })
  })
}

async function createDirectClient(): Promise<DirectClient> {
  const endpoint = await invoke<BackendEndpoint>('backend_endpoint')
  const ws = new WebSocket(endpointUrlWithToken(endpoint))
  await waitForOpen(ws)

  let seq = 0
  const pending = new Map<string, PendingRequest>()

  function rejectPending(error: Error) {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    pending.clear()
  }

  ws.addEventListener('message', event => {
    let frame: any = null
    try {
      frame = JSON.parse(String(event.data))
    } catch {
      return
    }
    if (!frame || frame.type !== 'response') return
    const id = String(frame.id || '')
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    clearTimeout(entry.timer)
    if (frame.ok) entry.resolve(frame.result)
    else entry.reject(new Error(String(frame.error?.message || '后台请求失败')))
  })

  ws.addEventListener('close', () => rejectPending(new Error('后台连接已关闭')))
  ws.addEventListener('error', () => rejectPending(new Error('后台连接异常')))

  return {
    request<T>(method: string, params?: unknown): Promise<T> {
      if (ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('后台未连接'))
      const id = `ref-${Date.now()}-${++seq}`
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error('后台请求超时'))
        }, REQUEST_TIMEOUT_MS)
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
        ws.send(JSON.stringify({ id, type: 'request', method, params: params ?? {} }))
      })
    },
    close() {
      rejectPending(new Error('后台连接已关闭'))
      ws.close()
    },
  }
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('button,input,select,textarea,a,[role="button"],[data-window-control]'))
}

function App() {
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

  const onTopbarPointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return
    void appWindow.startDragging()
  }, [])

  return (
    <main className="app-shell">
      <header className="topbar" onPointerDown={onTopbarPointerDown}>
        <div className="brand-mark" aria-hidden="true">v5</div>
        <div className="title-block">
          <div className="eyebrow">Fast Window Registered App Reference</div>
          <h1>v5 Reference App Go</h1>
        </div>
        <div className="mode-pill">{launchInfo.standalone ? 'standalone' : `FW ${launchInfo.mode}`}</div>
        {launchInfo.standalone ? (
          <div className="window-controls" data-window-control>
            <button type="button" onClick={() => appWindow.minimize()} aria-label="最小化">-</button>
            <button type="button" onClick={() => appWindow.toggleMaximize()} aria-label="最大化或还原">□</button>
            <button type="button" onClick={() => invoke('hide_to_tray')} aria-label="隐藏到托盘">×</button>
          </div>
        ) : null}
      </header>

      <section className="hero-card">
        <div>
          <p className="eyebrow">模范标准</p>
          <h2>只包含 v5 App 通用框架能力</h2>
          <p>这个 App 用来作为 Go sidecar 版本的标准模板：FW 控制、单实例、托盘、数据目录、最小 direct 协议、migration 骨架和构建脚本都在这里。</p>
        </div>
        <div className={`status-badge ${phase}`}>{phase === 'ready' ? 'Backend Ready' : phase === 'failed' ? 'Needs Attention' : 'Starting'}</div>
      </section>

      <section className="grid">
        <article className="panel">
          <h3>启动信息</h3>
          <dl>
            <dt>启动来源</dt><dd>{launchInfo.launched ? 'FW launched' : 'Standalone'}</dd>
            <dt>窗口模式</dt><dd>{launchInfo.mode}</dd>
            <dt>初始命令</dt><dd>{initialCommand || '无'}</dd>
            <dt>运行中命令</dt><dd>{runtimeCommand || '无'}</dd>
          </dl>
        </article>

        <article className="panel">
          <h3>数据目录</h3>
          <dl>
            <dt>当前目录</dt><dd>{status?.dataDir || '读取中'}</dd>
            <dt>默认目录</dt><dd>{status?.defaultDataDir || '读取中'}</dd>
            <dt>可写状态</dt><dd>{status?.writable ? '可写' : '不可写或未知'}</dd>
          </dl>
          {status?.error ? <p className="error-text">{status.error}</p> : null}
          <div className="actions">
            <button type="button" onClick={pickDataDir} disabled={busy}>选择数据目录</button>
            <button type="button" onClick={() => void connect({ restartBackend: true })} disabled={busy}>重启后台</button>
          </div>
        </article>

        <article className="panel">
          <h3>后台健康</h3>
          <pre>{JSON.stringify(health, null, 2) || '后台连接中'}</pre>
        </article>

        <article className="panel">
          <h3>示例设置</h3>
          <label className="field">
            <span>message</span>
            <input value={message} onChange={event => setMessage(event.target.value)} />
          </label>
          <div className="actions">
            <button type="button" onClick={saveSettings} disabled={!client || busy}>保存设置</button>
          </div>
          <p className="muted">最后保存：{settings?.updatedAt || '尚未保存'}</p>
        </article>
      </section>

      {error ? <section className="error-card">{error}</section> : null}
    </main>
  )
}

const host = document.getElementById('app')
if (host) createRoot(host).render(<App />)
