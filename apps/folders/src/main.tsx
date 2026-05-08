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

type FolderGroup = {
  id: string
  name: string
}

type FolderItem = {
  id: string
  name: string
  path: string
  groupId: string
  createdAtMs: number
  updatedAtMs: number
}

type FoldersDoc = {
  schemaVersion: number
  dataVersion: number
  groups: FolderGroup[]
  items: FolderItem[]
  updatedAt: string
}

type FoldersSettings = {
  schemaVersion: number
  dataVersion: number
  view: 'grid' | 'list'
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

const DEFAULT_DOC: FoldersDoc = {
  schemaVersion: 1,
  dataVersion: 1,
  groups: [{ id: 'default', name: '默认' }],
  items: [],
  updatedAt: '',
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
      const id = `folders-${Date.now()}-${++seq}`
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

function deriveNameFromPath(path: string): string {
  const parts = path.replaceAll('\\', '/').split('/').filter(Boolean)
  return parts.at(-1) || path
}

function createID(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function groupName(doc: FoldersDoc, groupId: string): string {
  return doc.groups.find(group => group.id === groupId)?.name || '默认'
}

function App() {
  const [launchInfo, setLaunchInfo] = React.useState<FwLaunchInfo>(DEFAULT_LAUNCH_INFO)
  const [status, setStatus] = React.useState<DataDirStatus | null>(null)
  const [client, setClient] = React.useState<DirectClient | null>(null)
  const [doc, setDoc] = React.useState<FoldersDoc>(DEFAULT_DOC)
  const [settings, setSettings] = React.useState<FoldersSettings | null>(null)
  const [phase, setPhase] = React.useState<'starting' | 'ready' | 'failed'>('starting')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const [groupId, setGroupId] = React.useState('__all__')
  const [editing, setEditing] = React.useState<FolderItem | null>(null)
  const [form, setForm] = React.useState({ name: '', path: '', groupId: 'default' })
  const [settingsOpen, setSettingsOpen] = React.useState(false)
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
      const [nextDoc, nextSettings] = await Promise.all([
        nextClient.request<FoldersDoc>('folders.list'),
        nextClient.request<FoldersSettings>('folders.settings.get'),
      ])
      setClient(nextClient)
      setDoc(nextDoc)
      setSettings(nextSettings)
      setPhase('ready')
      await refreshStatus()
    } catch (e) {
      setPhase('failed')
      setError(errorMessage(e, '启动文件夹收藏后台失败'))
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
      const [nextLaunchInfo, initialCommand] = await Promise.all([
        invoke<FwLaunchInfo>('fw_launch_info').catch(() => DEFAULT_LAUNCH_INFO),
        invoke<string | null>('fw_initial_command').catch(() => null),
      ])
      if (cancelled) return
      setLaunchInfo(nextLaunchInfo)
      await refreshStatus()
      if (!cancelled) {
        await connect()
        if (initialCommand) handleCommand(initialCommand)
      }
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
      if (command) handleCommand(command)
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

  function handleCommand(command: string) {
    if (command === 'open-settings') setSettingsOpen(true)
    if (command === 'add-folder') openAdd()
    if (command === 'open-folders') {
      setSettingsOpen(false)
      setEditing(null)
    }
  }

  function openAdd() {
    setEditing({ id: '', name: '', path: '', groupId: groupId === '__all__' ? 'default' : groupId, createdAtMs: 0, updatedAtMs: 0 })
    setForm({ name: '', path: '', groupId: groupId === '__all__' ? 'default' : groupId })
  }

  function openEdit(item: FolderItem) {
    setEditing(item)
    setForm({ name: item.name, path: item.path, groupId: item.groupId })
  }

  async function saveFolder() {
    if (!client || !editing) return
    const path = form.path.trim()
    if (!path) {
      setError('请先填写文件夹路径')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const now = Date.now()
      const payload: FolderItem = {
        id: editing.id || createID(),
        name: form.name.trim() || deriveNameFromPath(path),
        path,
        groupId: form.groupId || 'default',
        createdAtMs: editing.createdAtMs || now,
        updatedAtMs: now,
      }
      const nextDoc = await client.request<FoldersDoc>(editing.id ? 'folders.update' : 'folders.add', payload)
      setDoc(nextDoc)
      setEditing(null)
    } catch (e) {
      setError(errorMessage(e, '保存文件夹失败'))
    } finally {
      setBusy(false)
    }
  }

  async function removeFolder(item: FolderItem) {
    if (!client || !window.confirm(`删除“${item.name}”？`)) return
    setBusy(true)
    setError(null)
    try {
      const nextDoc = await client.request<FoldersDoc>('folders.remove', { id: item.id })
      setDoc(nextDoc)
    } catch (e) {
      setError(errorMessage(e, '删除文件夹失败'))
    } finally {
      setBusy(false)
    }
  }

  async function openFolder(item: FolderItem) {
    if (!client) return
    setBusy(true)
    setError(null)
    try {
      await client.request('folders.open-folder', { id: item.id })
    } catch (e) {
      setError(errorMessage(e, '打开文件夹失败'))
    } finally {
      setBusy(false)
    }
  }

  async function pickDataDir() {
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
  }

  async function pickFolderPath() {
    setError(null)
    try {
      const path = await invoke<string | null>('pick_folder_path')
      if (!path) return
      setForm(current => ({ ...current, path, name: current.name || deriveNameFromPath(path) }))
    } catch (e) {
      setError(errorMessage(e, '选择文件夹失败'))
    }
  }

  async function setView(view: 'grid' | 'list') {
    if (!client) return
    setBusy(true)
    setError(null)
    try {
      const next = await client.request<FoldersSettings>('folders.settings.save', { view })
      setSettings(next)
    } catch (e) {
      setError(errorMessage(e, '保存设置失败'))
    } finally {
      setBusy(false)
    }
  }

  const filteredItems = doc.items.filter(item => {
    const q = search.trim().toLowerCase()
    if (groupId !== '__all__' && item.groupId !== groupId) return false
    if (!q) return true
    return item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q)
  })

  const onTopbarPointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return
    void appWindow.startDragging()
  }, [])

  return (
    <main className="app-shell">
      <header className="topbar" onPointerDown={onTopbarPointerDown}>
        <div className="title">文件夹收藏</div>
        <div className={`status-badge ${phase}`}>{phase === 'ready' ? '就绪' : phase === 'failed' ? '需处理' : '启动中'}</div>
        <button type="button" className="ghost" onClick={() => setSettingsOpen(true)}>设置</button>
        <button type="button" className="primary" onClick={openAdd} disabled={phase !== 'ready'}>新增</button>
        {launchInfo.standalone ? (
          <div className="window-controls" data-window-control>
            <button type="button" onClick={() => appWindow.minimize()} aria-label="最小化">-</button>
            <button type="button" onClick={() => appWindow.toggleMaximize()} aria-label="最大化或还原">□</button>
            <button type="button" onClick={() => invoke('hide_to_tray')} aria-label="隐藏到托盘">×</button>
          </div>
        ) : null}
      </header>

      <section className="filters">
        <label className="field compact">
          <span>分组</span>
          <select value={groupId} onChange={event => setGroupId(event.target.value)}>
            <option value="__all__">全部</option>
            {doc.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </label>
        <label className="field search-field">
          <span>搜索</span>
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="按名称 / 路径搜索" />
        </label>
        <div className="mode-pill">{launchInfo.standalone ? 'standalone' : `FW ${launchInfo.mode}`}</div>
      </section>

      {phase === 'starting' ? <section className="notice">正在连接文件夹收藏后台...</section> : null}
      {phase === 'failed' ? (
        <section className="error-card">
          <strong>后台或数据目录暂不可用</strong>
          <p>{error || status?.error || '请重试或选择新的数据目录。'}</p>
          <div className="actions">
            <button type="button" onClick={() => void connect({ restartBackend: true })} disabled={busy}>重试</button>
            <button type="button" className="ghost" onClick={pickDataDir} disabled={busy}>选择数据目录</button>
          </div>
        </section>
      ) : null}

      <section className={`folder-list ${settings?.view === 'list' ? 'as-list' : ''}`} aria-label="收藏文件夹列表">
        {filteredItems.length ? filteredItems.map(item => (
          <article className="folder-card" key={item.id} title={item.path}>
            <button type="button" className="folder-open" onClick={() => void openFolder(item)} aria-label={`打开文件夹：${item.name}`}>
              <span className="site-icon" aria-hidden="true"><span className="folder-icon">📁</span></span>
              <span className="folder-name">{item.name}</span>
              <span className="folder-group">{groupName(doc, item.groupId)}</span>
            </button>
            <div className="card-actions">
              <button type="button" className="ghost" onClick={() => openEdit(item)}>编辑</button>
              <button type="button" className="danger" onClick={() => void removeFolder(item)}>删除</button>
            </div>
          </article>
        )) : (
          <div className="empty-state">
            <strong>{search ? '没有匹配的文件夹' : '还没有收藏文件夹'}</strong>
            <p>添加常用目录后，可以从这里一键打开。</p>
            <button type="button" onClick={openAdd} disabled={phase !== 'ready'}>添加第一个文件夹</button>
          </div>
        )}
      </section>

      {error && phase !== 'failed' ? <section className="error-card slim">{error}</section> : null}

      {editing ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-label={editing.id ? '编辑文件夹' : '添加文件夹'}>
            <header>
              <h2>{editing.id ? '编辑文件夹' : '添加文件夹'}</h2>
              <button type="button" className="ghost" onClick={() => setEditing(null)}>关闭</button>
            </header>
            <label className="field">
              <span>名称</span>
              <input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="例如：项目目录" autoFocus />
            </label>
            <label className="field">
              <span>路径</span>
              <div className="path-picker">
                <input value={form.path} onChange={event => setForm({ ...form, path: event.target.value })} placeholder="选择或粘贴文件夹绝对路径" />
                <button type="button" className="ghost" onClick={() => void pickFolderPath()}>选择</button>
              </div>
            </label>
            <label className="field">
              <span>分组</span>
              <select value={form.groupId} onChange={event => setForm({ ...form, groupId: event.target.value })}>
                {doc.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </label>
            <div className="actions end">
              <button type="button" className="ghost" onClick={() => setEditing(null)}>取消</button>
              <button type="button" onClick={() => void saveFolder()} disabled={busy}>保存</button>
            </div>
          </section>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal wide" role="dialog" aria-modal="true" aria-label="设置">
            <header>
              <h2>设置</h2>
              <button type="button" className="ghost" onClick={() => setSettingsOpen(false)}>关闭</button>
            </header>
            <div className="settings-grid">
              <div>
                <span className="label">当前数据目录</span>
                <p className="path-text">{status?.dataDir || '读取中'}</p>
              </div>
              <div>
                <span className="label">默认数据目录</span>
                <p className="path-text">{status?.defaultDataDir || '读取中'}</p>
              </div>
              <div>
                <span className="label">数据版本</span>
                <p>{doc.schemaVersion} / {doc.dataVersion}</p>
              </div>
              <div>
                <span className="label">可写状态</span>
                <p>{status?.writable ? '可写' : '不可写或未知'}</p>
              </div>
            </div>
            {status?.error ? <p className="error-text">{status.error}</p> : null}
            <div className="actions">
              <button type="button" className={settings?.view === 'grid' ? '' : 'ghost'} onClick={() => void setView('grid')} disabled={busy}>宫格视图</button>
              <button type="button" className={settings?.view === 'list' ? '' : 'ghost'} onClick={() => void setView('list')} disabled={busy}>列表视图</button>
              <button type="button" className="ghost" onClick={pickDataDir} disabled={busy}>选择数据目录</button>
              <button type="button" className="ghost" onClick={() => void connect({ restartBackend: true })} disabled={busy}>重启后台</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}

const host = document.getElementById('app')
if (host) createRoot(host).render(<App />)
