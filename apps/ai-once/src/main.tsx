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

type AiOnceSettings = {
  schemaVersion: number
  dataVersion: number
  providerName: string
  baseUrl: string
  apiKey: string
  model: string
  systemPrompt: string
  temperature?: number
  updatedAt: string
}

type HistoryEntry = {
  id: string
  prompt: string
  answer: string
  model: string
  providerName: string
  createdAt: string
  error?: string
}

type HistoryDoc = {
  schemaVersion: number
  dataVersion: number
  items: HistoryEntry[]
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

const DEFAULT_LAUNCH_INFO: FwLaunchInfo = { launched: false, standalone: true, mode: 'standalone' }
const OPEN_TIMEOUT_MS = 15_000
const REQUEST_TIMEOUT_MS = 75_000

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
    ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('后台连接失败')) }, { once: true })
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
    try { frame = JSON.parse(String(event.data)) } catch { return }
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
      const id = `ai-once-${Date.now()}-${++seq}`
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

function defaultSettings(): AiOnceSettings {
  return { schemaVersion: 1, dataVersion: 1, providerName: 'OpenAI Compatible', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: '', systemPrompt: '你是一个严谨、直接、可执行的助手。', temperature: 0.2, updatedAt: '' }
}

function App() {
  const [launchInfo, setLaunchInfo] = React.useState<FwLaunchInfo>(DEFAULT_LAUNCH_INFO)
  const [initialCommand, setInitialCommand] = React.useState<string | null>(null)
  const [runtimeCommand, setRuntimeCommand] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<DataDirStatus | null>(null)
  const [settings, setSettings] = React.useState<AiOnceSettings>(defaultSettings())
  const [draftSettings, setDraftSettings] = React.useState<AiOnceSettings>(defaultSettings())
  const [history, setHistory] = React.useState<HistoryEntry[]>([])
  const [health, setHealth] = React.useState<Record<string, unknown> | null>(null)
  const [client, setClient] = React.useState<DirectClient | null>(null)
  const [phase, setPhase] = React.useState<'starting' | 'ready' | 'failed'>('starting')
  const [view, setView] = React.useState<'ask' | 'settings'>('ask')
  const [prompt, setPrompt] = React.useState('')
  const [answer, setAnswer] = React.useState('')
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

  const applyCommand = React.useCallback((command: string | null) => {
    if (command === 'open-settings') setView('settings')
    if (command === 'ask-once' || command === 'new-prompt') {
      setView('ask')
      setPrompt('')
      setAnswer('')
      setError(null)
    }
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
      const [nextSettings, nextHistory, nextHealth] = await Promise.all([
        nextClient.request<AiOnceSettings>('aiOnce.settings.get'),
        nextClient.request<HistoryDoc>('aiOnce.history.list'),
        nextClient.request<Record<string, unknown>>('aiOnce.health'),
      ])
      setClient(nextClient)
      setSettings(nextSettings)
      setDraftSettings(nextSettings)
      setHistory(nextHistory.items || [])
      setHealth(nextHealth)
      setPhase('ready')
      await refreshStatus()
    } catch (e) {
      setPhase('failed')
      setError(errorMessage(e, '启动 AI Once 后台失败'))
      await refreshStatus()
    } finally {
      setBusy(false)
    }
  }, [client, refreshStatus])

  React.useEffect(() => { markAppReady() }, [markAppReady])

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
      applyCommand(nextInitialCommand)
      await refreshStatus()
      if (!cancelled) await connect()
    })()
    return () => { cancelled = true }
  }, [])

  React.useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false
    void listen<{ command?: string }>('fw-app-command', event => {
      const command = String(event.payload?.command || '').trim()
      if (!command) return
      setRuntimeCommand(command)
      applyCommand(command)
    }).then(nextUnlisten => {
      if (cancelled) nextUnlisten()
      else unlisten = nextUnlisten
    }).catch(() => {})
    return () => { cancelled = true; unlisten?.() }
  }, [applyCommand])

  React.useEffect(() => () => client?.close(), [client])

  const saveSettings = React.useCallback(async () => {
    if (!client) return
    setBusy(true)
    setError(null)
    try {
      const saved = await client.request<AiOnceSettings>('aiOnce.settings.save', draftSettings)
      setSettings(saved)
      setDraftSettings(saved)
    } catch (e) {
      setError(errorMessage(e, '保存设置失败'))
    } finally {
      setBusy(false)
    }
  }, [client, draftSettings])

  const askOnce = React.useCallback(async () => {
    if (!client) return
    setBusy(true)
    setError(null)
    setAnswer('')
    try {
      const entry = await client.request<HistoryEntry>('aiOnce.ask', { prompt })
      setAnswer(entry.answer)
      const nextHistory = await client.request<HistoryDoc>('aiOnce.history.list')
      setHistory(nextHistory.items || [])
    } catch (e) {
      setError(errorMessage(e, 'AI 请求失败'))
      const nextHistory = await client.request<HistoryDoc>('aiOnce.history.list').catch(() => null)
      if (nextHistory) setHistory(nextHistory.items || [])
    } finally {
      setBusy(false)
    }
  }, [client, prompt])

  const clearHistory = React.useCallback(async () => {
    if (!client) return
    setBusy(true)
    setError(null)
    try {
      const doc = await client.request<HistoryDoc>('aiOnce.history.clear')
      setHistory(doc.items || [])
    } catch (e) {
      setError(errorMessage(e, '清空历史失败'))
    } finally {
      setBusy(false)
    }
  }, [client])

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
        <div className="brand-mark" aria-hidden="true">AI</div>
        <div className="title-block">
          <div className="eyebrow">Fast Window v5 App</div>
          <h1>AI Once</h1>
        </div>
        <button type="button" className={view === 'ask' ? 'tab active' : 'tab'} onClick={() => setView('ask')}>一次提问</button>
        <button type="button" className={view === 'settings' ? 'tab active' : 'tab'} onClick={() => setView('settings')}>设置</button>
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
          <p className="eyebrow">一次请求，一次返回</p>
          <h2>把临时问题快速交给你的 AI Provider</h2>
          <p>保留旧插件的 provider endpoint、API key、模型和系统提示语义。没有配置时会明确报错，不会假装请求成功。</p>
        </div>
        <div className={`status-badge ${phase}`}>{phase === 'ready' ? 'Backend Ready' : phase === 'failed' ? 'Needs Setup' : 'Starting'}</div>
      </section>

      <section className="workspace">
        <aside className="side-panel">
          <h3>运行信息</h3>
          <dl>
            <dt>初始命令</dt><dd>{initialCommand || '无'}</dd>
            <dt>运行命令</dt><dd>{runtimeCommand || '无'}</dd>
            <dt>数据目录</dt><dd>{status?.dataDir || '读取中'}</dd>
            <dt>可写状态</dt><dd>{status?.writable ? '可写' : '不可写或未知'}</dd>
          </dl>
          {status?.error ? <p className="error-text">{status.error}</p> : null}
          <div className="actions">
            <button type="button" onClick={pickDataDir} disabled={busy}>选择数据目录</button>
            <button type="button" onClick={() => void connect({ restartBackend: true })} disabled={busy}>重试后台</button>
          </div>
          <h3>最近历史</h3>
          <div className="history-list">
            {history.length ? history.map(item => (
              <button type="button" className="history-item" key={item.id} onClick={() => { setPrompt(item.prompt); setAnswer(item.answer); setView('ask') }}>
                <strong>{item.prompt || '空 Prompt'}</strong>
                <span>{item.error ? `失败：${item.error}` : `${item.model || '未记录模型'} · ${new Date(item.createdAt).toLocaleString()}`}</span>
              </button>
            )) : <p className="muted">还没有历史记录</p>}
          </div>
          {history.length ? <button type="button" className="ghost" onClick={clearHistory} disabled={busy}>清空历史</button> : null}
        </aside>

        {view === 'ask' ? (
          <section className="main-panel">
            <div className="ask-grid">
              <label className="field prompt-field">
                <span>Prompt</span>
                <textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="输入这次要问 AI 的内容..." />
              </label>
              <article className="answer-card">
                <div className="answer-head">
                  <span>结果</span>
                  <small>{settings.providerName} / {settings.model || '未配置模型'}</small>
                </div>
                <pre>{answer || (busy ? '正在请求 AI...' : '结果会显示在这里')}</pre>
              </article>
            </div>
            <div className="actions">
              <button type="button" onClick={askOnce} disabled={!client || busy}>提交一次性请求</button>
              <button type="button" className="ghost" onClick={() => { setPrompt(''); setAnswer(''); setError(null) }} disabled={busy}>新 Prompt</button>
              <button type="button" className="ghost" onClick={() => setView('settings')}>打开设置</button>
            </div>
          </section>
        ) : (
          <section className="main-panel settings-panel">
            <div className="settings-grid">
              <label className="field"><span>Provider 名称</span><input value={draftSettings.providerName} onChange={event => setDraftSettings({ ...draftSettings, providerName: event.target.value })} /></label>
              <label className="field"><span>Endpoint</span><input value={draftSettings.baseUrl} onChange={event => setDraftSettings({ ...draftSettings, baseUrl: event.target.value })} placeholder="https://api.openai.com/v1" /></label>
              <label className="field"><span>API Key</span><input type="password" value={draftSettings.apiKey} onChange={event => setDraftSettings({ ...draftSettings, apiKey: event.target.value })} /></label>
              <label className="field"><span>模型</span><input value={draftSettings.model} onChange={event => setDraftSettings({ ...draftSettings, model: event.target.value })} placeholder="gpt-4o-mini" /></label>
              <label className="field"><span>Temperature</span><input type="number" min="0" max="2" step="0.1" value={draftSettings.temperature ?? 0.2} onChange={event => setDraftSettings({ ...draftSettings, temperature: Number(event.target.value) })} /></label>
              <label className="field wide"><span>系统提示</span><textarea value={draftSettings.systemPrompt} onChange={event => setDraftSettings({ ...draftSettings, systemPrompt: event.target.value })} /></label>
            </div>
            <div className="actions">
              <button type="button" onClick={saveSettings} disabled={!client || busy}>保存设置</button>
              <button type="button" className="ghost" onClick={() => setDraftSettings(settings)} disabled={busy}>还原</button>
            </div>
            <pre className="health-card">{JSON.stringify(health, null, 2) || '后台连接中'}</pre>
          </section>
        )}
      </section>

      {error ? <section className="error-card">{error}</section> : null}
    </main>
  )
}

const host = document.getElementById('app')
if (host) createRoot(host).render(<App />)
