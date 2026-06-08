import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createDirectClient } from './directClient'
import { KnowledgeTopbar } from './KnowledgeTopbar'
import type {
  CollectionSummary,
  ConnectionSettings,
  DataDirStatus,
  DirectClient,
  DocumentRecord,
  DocumentStatus,
  DocumentSummary,
  FwLaunchInfo,
  HealthResponse,
} from './types'
import { DEFAULT_LAUNCH_INFO } from './types'
import './styles.css'

const appWindow = getCurrentWindow()

type AppPage = 'workspace' | 'settings'
type BackendPhase = 'starting' | 'ready' | 'failed'

const STATUS_OPTIONS: Array<{ value: DocumentStatus; label: string }> = [
  { value: 'active', label: '活跃' },
  { value: 'archived', label: '归档' },
  { value: 'trashed', label: '回收站' },
  { value: 'all', label: '全部' },
]

function errorMessage(error: unknown, fallback: string): string {
  return String((error as { message?: string })?.message || error || fallback)
}

function statusLabel(status: string) {
  return STATUS_OPTIONS.find(item => item.value === status)?.label || status
}

function displayTime(value?: string) {
  if (!value) return '无'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN')
}

function joinTags(tags: string[]) {
  return tags.length ? tags.join(' / ') : '无标签'
}

function collectionRoots(collections: CollectionSummary[]) {
  const childIDs = new Set(collections.flatMap(collection => collection.child_collection_ids))
  const roots = collections.filter(collection => !childIDs.has(collection.id))
  return roots.length ? roots : collections
}

function App() {
  const [page, setPage] = React.useState<AppPage>('workspace')
  const [launchInfo, setLaunchInfo] = React.useState<FwLaunchInfo>(DEFAULT_LAUNCH_INFO)
  const [status, setStatus] = React.useState<DataDirStatus | null>(null)
  const [connection, setConnection] = React.useState<ConnectionSettings | null>(null)
  const [serverBaseUrl, setServerBaseUrl] = React.useState('')
  const [serverKeyInput, setServerKeyInput] = React.useState('')
  const [health, setHealth] = React.useState<HealthResponse | null>(null)
  const [documents, setDocuments] = React.useState<DocumentSummary[]>([])
  const [collections, setCollections] = React.useState<CollectionSummary[]>([])
  const [selectedDocumentID, setSelectedDocumentID] = React.useState<string | null>(null)
  const [selectedDocument, setSelectedDocument] = React.useState<DocumentRecord | null>(null)
  const [statusFilter, setStatusFilter] = React.useState<DocumentStatus>('active')
  const [query, setQuery] = React.useState('')
  const [tag, setTag] = React.useState('')
  const [pendingCommand, setPendingCommand] = React.useState<string | null>(null)
  const [client, setClient] = React.useState<DirectClient | null>(null)
  const [phase, setPhase] = React.useState<BackendPhase>('starting')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const readyRef = React.useRef(false)
  const selectedDocumentIDRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    selectedDocumentIDRef.current = selectedDocumentID
  }, [selectedDocumentID])

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

  const loadDocument = React.useCallback(async (activeClient: DirectClient, id: string | null) => {
    if (!id) {
      setSelectedDocument(null)
      setSelectedDocumentID(null)
      return
    }
    const record = await activeClient.request<DocumentRecord>('knowledge.documents.get', { id })
    setSelectedDocument(record)
    setSelectedDocumentID(id)
  }, [])

  const loadKnowledge = React.useCallback(async (activeClient: DirectClient) => {
    const [nextHealth, documentPayload, collectionPayload] = await Promise.all([
      activeClient.request<HealthResponse>('knowledge.health'),
      activeClient.request<{ documents: DocumentSummary[] }>('knowledge.documents.list', {
        status: statusFilter,
        query,
        tag,
      }),
      activeClient.request<{ collections: CollectionSummary[] }>('knowledge.collections.list'),
    ])
    const nextDocuments = documentPayload.documents || []
    setHealth(nextHealth)
    setDocuments(nextDocuments)
    setCollections(collectionPayload.collections || [])
    const preferredID = selectedDocumentIDRef.current
    const nextID = nextDocuments.some(item => item.id === preferredID) ? preferredID : nextDocuments[0]?.id || null
    await loadDocument(activeClient, nextID)
  }, [loadDocument, query, statusFilter, tag])

  const connect = React.useCallback(async (options?: { restartBackend?: boolean }) => {
    setBusy(true)
    setError(null)
    setPhase('starting')
    client?.close()
    setClient(null)
    try {
      if (options?.restartBackend) await invoke('restart_backend')
      const nextClient = await createDirectClient()
      const nextConnection = await nextClient.request<ConnectionSettings>('knowledge.connection.get')
      setClient(nextClient)
      setConnection(nextConnection)
      setServerBaseUrl(nextConnection.serverBaseUrl || nextConnection.defaultServerBaseUrl)
      setServerKeyInput('')
      setPhase('ready')
      await refreshStatus()
      if (nextConnection.hasServerKey) {
        await loadKnowledge(nextClient)
      } else {
        setHealth(null)
        setDocuments([])
        setCollections([])
        setSelectedDocument(null)
        setSelectedDocumentID(null)
      }
    } catch (e) {
      setPhase('failed')
      setError(errorMessage(e, '启动 AI 知识中心本地后台失败'))
      await refreshStatus()
    } finally {
      setBusy(false)
    }
  }, [client, loadKnowledge, refreshStatus])

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
      const command = String(nextInitialCommand || '').trim()
      if (command) setPendingCommand(command)
      await refreshStatus()
      if (!cancelled) await connect()
    })()
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => () => client?.close(), [client])

  const refreshKnowledge = React.useCallback(async () => {
    if (!client) return
    setBusy(true)
    setError(null)
    try {
      await loadKnowledge(client)
    } catch (e) {
      setHealth(null)
      setDocuments([])
      setCollections([])
      setSelectedDocument(null)
      setSelectedDocumentID(null)
      setError(errorMessage(e, '读取知识中心服务器失败'))
    } finally {
      setBusy(false)
    }
  }, [client, loadKnowledge])

  React.useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false
    void listen<{ command?: string }>('fw-app-command', event => {
      const command = String(event.payload?.command || '').trim()
      if (command) setPendingCommand(command)
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

  React.useEffect(() => {
    if (!pendingCommand) return
    if (pendingCommand === 'open-knowledge-center') {
      setPage('workspace')
      setPendingCommand(null)
      return
    }
    if (pendingCommand === 'edit-knowledge-settings') {
      setPage('settings')
      setPendingCommand(null)
      return
    }
    if (pendingCommand === 'show-knowledge-health') {
      if (!client) return
      setPendingCommand(null)
      void refreshKnowledge()
      return
    }
    setPendingCommand(null)
  }, [client, pendingCommand, refreshKnowledge])

  const saveConnection = React.useCallback(async () => {
    if (!client) return
    setBusy(true)
    setError(null)
    try {
      const payload: { serverBaseUrl: string; serverKey?: string } = { serverBaseUrl }
      if (serverKeyInput.trim()) payload.serverKey = serverKeyInput
      const saved = await client.request<ConnectionSettings>('knowledge.connection.save', payload)
      setConnection(saved)
      setServerBaseUrl(saved.serverBaseUrl)
      setServerKeyInput('')
      if (saved.hasServerKey) await loadKnowledge(client)
      else setPage('settings')
    } catch (e) {
      setError(errorMessage(e, '保存连接配置失败'))
    } finally {
      setBusy(false)
    }
  }, [client, loadKnowledge, serverBaseUrl, serverKeyInput])

  const clearConnection = React.useCallback(async () => {
    if (!client) return
    setBusy(true)
    setError(null)
    try {
      const cleared = await client.request<ConnectionSettings>('knowledge.connection.clear')
      setConnection(cleared)
      setServerBaseUrl(cleared.serverBaseUrl)
      setServerKeyInput('')
      setHealth(null)
      setDocuments([])
      setCollections([])
      setSelectedDocument(null)
      setSelectedDocumentID(null)
    } catch (e) {
      setError(errorMessage(e, '清空连接配置失败'))
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
      setError(errorMessage(e, '切换客户端数据目录失败'))
      await refreshStatus()
    } finally {
      setBusy(false)
    }
  }, [connect, refreshStatus])

  return (
    <main className="kc-app">
      <KnowledgeTopbar
        page={page}
        standalone={launchInfo.standalone}
        onBack={() => setPage('workspace')}
        onOpenSettings={() => setPage('settings')}
        onStartDragging={() => appWindow.startDragging()}
        windowActions={{
          minimize: () => appWindow.minimize(),
          toggleMaximize: () => appWindow.toggleMaximize(),
          closeToTray: () => invoke('hide_to_tray'),
        }}
      />

      {page === 'settings' ? (
        <SettingsView
          status={status}
          connection={connection}
          phase={phase}
          busy={busy}
          serverBaseUrl={serverBaseUrl}
          serverKeyInput={serverKeyInput}
          onServerBaseUrlChange={setServerBaseUrl}
          onServerKeyInputChange={setServerKeyInput}
          onSaveConnection={saveConnection}
          onClearConnection={clearConnection}
          onPickDataDir={pickDataDir}
          onRestartBackend={() => connect({ restartBackend: true })}
        />
      ) : (
        <WorkspaceView
          connection={connection}
          health={health}
          documents={documents}
          collections={collections}
          selectedDocumentID={selectedDocumentID}
          selectedDocument={selectedDocument}
          statusFilter={statusFilter}
          query={query}
          tag={tag}
          busy={busy}
          onOpenSettings={() => setPage('settings')}
          onRefresh={refreshKnowledge}
          onStatusFilterChange={setStatusFilter}
          onQueryChange={setQuery}
          onTagChange={setTag}
          onApplyFilters={refreshKnowledge}
          onSelectDocument={id => client ? loadDocument(client, id).catch(e => setError(errorMessage(e, '读取资料详情失败'))) : undefined}
        />
      )}

      {error ? <div className="kc-error-card" role="alert">{error}</div> : null}
    </main>
  )
}

type SettingsViewProps = {
  status: DataDirStatus | null
  connection: ConnectionSettings | null
  phase: BackendPhase
  busy: boolean
  serverBaseUrl: string
  serverKeyInput: string
  onServerBaseUrlChange: (value: string) => void
  onServerKeyInputChange: (value: string) => void
  onSaveConnection: () => Promise<void> | void
  onClearConnection: () => Promise<void> | void
  onPickDataDir: () => Promise<void> | void
  onRestartBackend: () => Promise<void> | void
}

function SettingsView(props: SettingsViewProps) {
  const {
    status,
    connection,
    phase,
    busy,
    serverBaseUrl,
    serverKeyInput,
    onServerBaseUrlChange,
    onServerKeyInputChange,
    onSaveConnection,
    onClearConnection,
    onPickDataDir,
    onRestartBackend,
  } = props

  return (
    <section className="kc-settings" aria-label="知识中心连接设置">
      <article className="kc-card kc-hero-card">
        <p className="kc-eyebrow">连接设置</p>
        <h1>把桌面端接到你的知识中心服务器</h1>
        <p>服务器地址和访问钥匙只保存在这个客户端自己的本地数据目录里，界面不会回显已经保存的访问钥匙。</p>
      </article>

      <div className="kc-settings-grid">
        <article className="kc-card">
          <h2>服务器</h2>
          <label className="kc-field">
            <span>服务器地址</span>
            <input value={serverBaseUrl} onChange={event => onServerBaseUrlChange(event.target.value)} placeholder={connection?.defaultServerBaseUrl || 'http://127.0.0.1:17321'} />
          </label>
          <label className="kc-field">
            <span>访问钥匙</span>
            <input value={serverKeyInput} onChange={event => onServerKeyInputChange(event.target.value)} type="password" placeholder={connection?.hasServerKey ? '已保存，留空表示继续使用原钥匙' : '粘贴服务器访问钥匙'} />
          </label>
          <div className="kc-actions">
            <button type="button" onClick={onSaveConnection} disabled={busy}>保存并连接</button>
            <button type="button" onClick={onClearConnection} disabled={busy}>清空连接</button>
          </div>
          <p className="kc-muted">当前状态：{connection?.hasServerKey ? '访问钥匙已保存' : '访问钥匙未配置'}</p>
        </article>

        <article className="kc-card">
          <h2>客户端本地状态</h2>
          <dl className="kc-facts">
            <dt>本地后台</dt>
            <dd>{phase === 'ready' ? '已就绪' : phase === 'failed' ? '需要处理' : '启动中'}</dd>
            <dt>客户端数据目录</dt>
            <dd>{status?.dataDir || '读取中'}</dd>
            <dt>默认数据目录</dt>
            <dd>{status?.defaultDataDir || '读取中'}</dd>
            <dt>可写状态</dt>
            <dd>{status?.writable ? '可写' : '不可写或未知'}</dd>
          </dl>
          {status?.error ? <p className="kc-danger-text">{status.error}</p> : null}
          <div className="kc-actions">
            <button type="button" onClick={onPickDataDir} disabled={busy}>选择客户端数据目录</button>
            <button type="button" onClick={onRestartBackend} disabled={busy}>重启本地后台</button>
          </div>
        </article>
      </div>
    </section>
  )
}

type WorkspaceViewProps = {
  connection: ConnectionSettings | null
  health: HealthResponse | null
  documents: DocumentSummary[]
  collections: CollectionSummary[]
  selectedDocumentID: string | null
  selectedDocument: DocumentRecord | null
  statusFilter: DocumentStatus
  query: string
  tag: string
  busy: boolean
  onOpenSettings: () => void
  onRefresh: () => Promise<void> | void
  onStatusFilterChange: (value: DocumentStatus) => void
  onQueryChange: (value: string) => void
  onTagChange: (value: string) => void
  onApplyFilters: () => Promise<void> | void
  onSelectDocument: (id: string) => void
}

function WorkspaceView(props: WorkspaceViewProps) {
  const {
    connection,
    health,
    documents,
    collections,
    selectedDocumentID,
    selectedDocument,
    statusFilter,
    query,
    tag,
    busy,
    onOpenSettings,
    onRefresh,
    onStatusFilterChange,
    onQueryChange,
    onTagChange,
    onApplyFilters,
    onSelectDocument,
  } = props

  const connected = health?.status === 'ok'

  return (
    <section className="kc-workspace" aria-label="知识中心资料工作台">
      <header className="kc-workspace-header">
        <div>
          <p className="kc-eyebrow">Knowledge Center</p>
          <h1>资料工作台</h1>
          <p>{connection?.serverBaseUrl || '尚未配置服务器地址'}</p>
        </div>
        <div className="kc-header-actions">
          <span className={`kc-status-pill ${connected ? 'kc-status-good' : 'kc-status-warn'}`}>{connected ? '服务器可用' : connection?.hasServerKey ? '等待连接' : '未配置钥匙'}</span>
          <button type="button" onClick={onRefresh} disabled={busy || !connection?.hasServerKey}>刷新</button>
          <button type="button" onClick={onOpenSettings}>连接设置</button>
        </div>
      </header>

      <div className="kc-filters" role="search">
        <label>
          <span>状态</span>
          <select value={statusFilter} onChange={event => onStatusFilterChange(event.target.value as DocumentStatus)}>
            {STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>关键词</span>
          <input value={query} onChange={event => onQueryChange(event.target.value)} placeholder="搜索标题、描述、标签和正文" />
        </label>
        <label>
          <span>标签</span>
          <input value={tag} onChange={event => onTagChange(event.target.value)} placeholder="精确标签" />
        </label>
        <button type="button" onClick={onApplyFilters} disabled={busy || !connection?.hasServerKey}>应用筛选</button>
      </div>

      <div className="kc-workspace-grid">
        <aside className="kc-card kc-list-card" aria-label="资料列表">
          <div className="kc-card-title-row">
            <h2>资料</h2>
            <span>{documents.length}</span>
          </div>
          <div className="kc-document-list">
            {documents.map(document => (
              <button
                key={document.id}
                type="button"
                className={`kc-document-item ${document.id === selectedDocumentID ? 'is-selected' : ''}`}
                onClick={() => onSelectDocument(document.id)}
              >
                <strong>{document.name}</strong>
                <span>{document.description || '无描述'}</span>
                <small>{statusLabel(document.status)} · {joinTags(document.tags)}</small>
              </button>
            ))}
            {!documents.length ? <p className="kc-empty">暂无匹配资料</p> : null}
          </div>
        </aside>

        <article className="kc-card kc-detail-card" aria-label="资料详情">
          {selectedDocument ? (
            <>
              <div className="kc-detail-heading">
                <div>
                  <p className="kc-eyebrow">{statusLabel(selectedDocument.metadata.status)}</p>
                  <h2>{selectedDocument.metadata.name}</h2>
                </div>
                <span>{joinTags(selectedDocument.metadata.tags)}</span>
              </div>
              <p className="kc-description">{selectedDocument.metadata.description || '无描述'}</p>
              <dl className="kc-meta-grid">
                <dt>更新</dt><dd>{displayTime(selectedDocument.metadata.updated_at)}</dd>
                <dt>引用</dt><dd>{selectedDocument.metadata.references.length ? selectedDocument.metadata.references.join(' / ') : '无'}</dd>
                <dt>路径</dt><dd>{selectedDocument.metadata.relative_path}</dd>
              </dl>
              <pre className="kc-content">{selectedDocument.content}</pre>
            </>
          ) : (
            <div className="kc-empty kc-empty-detail">
              <h2>选择一篇资料</h2>
              <p>配置服务器并刷新后，资料正文会显示在这里。</p>
            </div>
          )}
        </article>

        <aside className="kc-card kc-collections-card" aria-label="收藏夹">
          <div className="kc-card-title-row">
            <h2>收藏夹</h2>
            <span>{collections.length}</span>
          </div>
          <CollectionTree collections={collections} />
        </aside>
      </div>
    </section>
  )
}

function CollectionTree({ collections }: { collections: CollectionSummary[] }) {
  const byID = new Map(collections.map(collection => [collection.id, collection]))
  const roots = collectionRoots(collections)
  return (
    <div className="kc-collection-list">
      {roots.map(collection => (
        <CollectionNode key={collection.id} collection={collection} byID={byID} seen={new Set()} />
      ))}
      {!collections.length ? <p className="kc-empty">暂无收藏夹</p> : null}
    </div>
  )
}

function CollectionNode(props: { collection: CollectionSummary; byID: Map<string, CollectionSummary>; seen: Set<string> }) {
  const { collection, byID, seen } = props
  const nextSeen = new Set(seen)
  nextSeen.add(collection.id)
  const children: CollectionSummary[] = []
  for (const id of collection.child_collection_ids) {
    const child = byID.get(id)
    if (!child || nextSeen.has(child.id)) continue
    children.push(child)
  }
  return (
    <div className="kc-collection-node">
      <article className="kc-collection-item">
        <strong>{collection.name}</strong>
        <span>{collection.description || '无描述'}</span>
        <small>{collection.document_ids.length} 篇资料 · {collection.child_collection_ids.length} 个子收藏夹</small>
      </article>
      {children.length ? (
        <div className="kc-collection-children">
          {children.map(child => <CollectionNode key={child.id} collection={child} byID={byID} seen={nextSeen} />)}
        </div>
      ) : null}
    </div>
  )
}

const host = document.getElementById('app')
if (host) createRoot(host).render(<App />)
