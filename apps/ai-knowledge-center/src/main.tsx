import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createDirectClient } from './directClient'
import { KnowledgeTopbar } from './KnowledgeTopbar'
import { KNOWLEDGE_PAGES, documentStatusForPage, isKnowledgePage, type AppPage, type KnowledgePage } from './knowledgePages'
import type {
  CollectionSummary,
  ConnectionSettings,
  DataDirStatus,
  DirectClient,
  DocumentRecord,
  DocumentSummary,
  FwLaunchInfo,
  HealthResponse,
} from './types'
import { DEFAULT_LAUNCH_INFO } from './types'
import { CollectionsView } from './views/CollectionsView'
import { DocumentsView } from './views/DocumentsView'
import { SettingsView } from './views/SettingsView'
import './styles.css'

const appWindow = getCurrentWindow()

type BackendPhase = 'starting' | 'ready' | 'failed'

function errorMessage(error: unknown, fallback: string): string {
  return String((error as { message?: string })?.message || error || fallback)
}

function viewKeyFor(page: AppPage, collectionID: string | null) {
  return page === 'collections' && collectionID ? `collections:${collectionID}` : page
}

function documentViewKeyFor(page: KnowledgePage, collectionID: string | null) {
  return page === 'collections' && collectionID ? `collections:${collectionID}` : page
}

function App() {
  const [page, setPage] = React.useState<AppPage>('all')
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
  const [selectedCollectionID, setSelectedCollectionID] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('')
  const [tag, setTag] = React.useState('')
  const [pendingCommand, setPendingCommand] = React.useState<string | null>(null)
  const [client, setClient] = React.useState<DirectClient | null>(null)
  const [phase, setPhase] = React.useState<BackendPhase>('starting')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const readyRef = React.useRef(false)
  const selectedDocumentIDRef = React.useRef<string | null>(null)
  const selectedCollectionIDRef = React.useRef<string | null>(null)
  const selectedDocumentByViewRef = React.useRef<Record<string, string | null>>({})
  const lastKnowledgePageRef = React.useRef<KnowledgePage>('all')
  const knowledgeLoadSeqRef = React.useRef(0)
  const documentLoadSeqRef = React.useRef(0)
  const currentViewKeyRef = React.useRef('all')
  const pageScrollRef = React.useRef<HTMLElement | null>(null)
  const pageScrollPositionsRef = React.useRef<Record<string, number>>({})

  const scrollKey = viewKeyFor(page, selectedCollectionID)
  const connected = health?.status === 'ok'

  React.useEffect(() => {
    selectedDocumentIDRef.current = selectedDocumentID
  }, [selectedDocumentID])

  React.useEffect(() => {
    selectedCollectionIDRef.current = selectedCollectionID
  }, [selectedCollectionID])

  React.useEffect(() => {
    currentViewKeyRef.current = scrollKey
  }, [scrollKey])

  React.useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const node = pageScrollRef.current
      if (node) node.scrollTop = pageScrollPositionsRef.current[scrollKey] || 0
    })
    return () => window.cancelAnimationFrame(frame)
  }, [busy, collections.length, documents.length, scrollKey, selectedCollectionID])

  const rememberPageScroll = React.useCallback((event: React.UIEvent<HTMLElement>) => {
    pageScrollPositionsRef.current[scrollKey] = event.currentTarget.scrollTop
  }, [scrollKey])

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

  const clearKnowledgeState = React.useCallback(() => {
    setHealth(null)
    setDocuments([])
    setCollections([])
    setSelectedDocument(null)
    setSelectedDocumentID(null)
  }, [])

  const loadDocument = React.useCallback(async (activeClient: DirectClient, id: string | null, viewKey: string, knowledgeSeq?: number) => {
    const documentSeq = ++documentLoadSeqRef.current
    if (!id) {
      if (knowledgeSeq && knowledgeLoadSeqRef.current !== knowledgeSeq) return
      if (!knowledgeSeq && currentViewKeyRef.current !== viewKey) return
      setSelectedDocument(null)
      setSelectedDocumentID(null)
      selectedDocumentByViewRef.current[viewKey] = null
      return
    }

    const record = await activeClient.request<DocumentRecord>('knowledge.documents.get', { id })
    if (documentSeq !== documentLoadSeqRef.current) return
    if (knowledgeSeq && knowledgeLoadSeqRef.current !== knowledgeSeq) return
    if (!knowledgeSeq && currentViewKeyRef.current !== viewKey) return
    setSelectedDocument(record)
    setSelectedDocumentID(id)
    selectedDocumentByViewRef.current[viewKey] = id
  }, [])

  const loadKnowledge = React.useCallback(async (activeClient: DirectClient, knowledgeSeq: number, targetPage?: KnowledgePage, targetCollectionID = selectedCollectionID) => {
    const dataPage = targetPage || (isKnowledgePage(page) ? page : lastKnowledgePageRef.current)
    const effectiveCollectionID = dataPage === 'collections' ? targetCollectionID : null
    const requestQuery = dataPage === 'collections' ? '' : query
    const requestTag = dataPage === 'collections' ? '' : tag
    const [nextHealth, documentPayload, collectionPayload] = await Promise.all([
      activeClient.request<HealthResponse>('knowledge.health'),
      activeClient.request<{ documents: DocumentSummary[] }>('knowledge.documents.list', {
        status: documentStatusForPage(dataPage),
        query: requestQuery,
        tag: requestTag,
      }),
      activeClient.request<{ collections: CollectionSummary[] }>('knowledge.collections.list'),
    ])
    if (knowledgeLoadSeqRef.current !== knowledgeSeq) return

    const nextDocuments = documentPayload.documents || []
    const nextCollections = collectionPayload.collections || []
    setHealth(nextHealth)
    setDocuments(nextDocuments)
    setCollections(nextCollections)

    if (dataPage === 'collections' && !effectiveCollectionID) {
      await loadDocument(activeClient, null, 'collections', knowledgeSeq)
      return
    }

    if (effectiveCollectionID && !nextCollections.some(collection => collection.id === effectiveCollectionID)) {
      setSelectedCollectionID(null)
      await loadDocument(activeClient, null, 'collections', knowledgeSeq)
      return
    }

    const viewKey = documentViewKeyFor(dataPage, effectiveCollectionID)
    const selectedCollection = effectiveCollectionID ? nextCollections.find(collection => collection.id === effectiveCollectionID) : null
    const candidateDocuments = selectedCollection
      ? selectedCollection.document_ids
        .map(id => nextDocuments.find(document => document.id === id))
        .filter((document): document is DocumentSummary => Boolean(document))
      : nextDocuments
    const preferredID = selectedDocumentByViewRef.current[viewKey] || selectedDocumentIDRef.current
    const nextID = candidateDocuments.some(item => item.id === preferredID) ? preferredID : candidateDocuments[0]?.id || null
    await loadDocument(activeClient, nextID, viewKey, knowledgeSeq)
  }, [loadDocument, page, query, selectedCollectionID, tag])

  const refreshKnowledge = React.useCallback(async (targetPage?: KnowledgePage, targetCollectionID = selectedCollectionID, hasServerKey = Boolean(connection?.hasServerKey)) => {
    if (!client) return
    if (!hasServerKey) {
      clearKnowledgeState()
      return
    }

    const knowledgeSeq = ++knowledgeLoadSeqRef.current
    setBusy(true)
    setError(null)
    try {
      await loadKnowledge(client, knowledgeSeq, targetPage, targetCollectionID)
    } catch (e) {
      if (knowledgeLoadSeqRef.current !== knowledgeSeq) return
      clearKnowledgeState()
      setError(errorMessage(e, '读取知识中心服务器失败'))
    } finally {
      if (knowledgeLoadSeqRef.current === knowledgeSeq) setBusy(false)
    }
  }, [clearKnowledgeState, client, connection?.hasServerKey, loadKnowledge, selectedCollectionID])

  const connect = React.useCallback(async (options?: { restartBackend?: boolean }) => {
    const knowledgeSeq = ++knowledgeLoadSeqRef.current
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
        const nextPage = lastKnowledgePageRef.current
        const nextCollectionID = nextPage === 'collections' ? selectedCollectionIDRef.current : null
        await loadKnowledge(nextClient, knowledgeSeq, nextPage, nextCollectionID)
      }
      else clearKnowledgeState()
    } catch (e) {
      setPhase('failed')
      setError(errorMessage(e, '启动 AI 知识中心本地后台失败'))
      await refreshStatus()
    } finally {
      if (knowledgeLoadSeqRef.current === knowledgeSeq) setBusy(false)
    }
  }, [clearKnowledgeState, client, loadKnowledge, refreshStatus])

  const openKnowledgePage = React.useCallback((nextPage: KnowledgePage) => {
    lastKnowledgePageRef.current = nextPage
    currentViewKeyRef.current = viewKeyFor(nextPage, nextPage === 'collections' ? selectedCollectionID : null)
    setPage(nextPage)
    void refreshKnowledge(nextPage)
  }, [refreshKnowledge, selectedCollectionID])

  const openSettings = React.useCallback(() => {
    if (isKnowledgePage(page)) lastKnowledgePageRef.current = page
    currentViewKeyRef.current = 'settings'
    setPage('settings')
  }, [page])

  const closeSettings = React.useCallback(() => {
    const nextPage = lastKnowledgePageRef.current
    currentViewKeyRef.current = viewKeyFor(nextPage, nextPage === 'collections' ? selectedCollectionID : null)
    setPage(nextPage)
  }, [selectedCollectionID])

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
      openKnowledgePage('all')
      setPendingCommand(null)
      return
    }
    if (pendingCommand === 'edit-knowledge-settings') {
      openSettings()
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
  }, [client, openKnowledgePage, openSettings, pendingCommand, refreshKnowledge])

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
      if (saved.hasServerKey) await refreshKnowledge(undefined, selectedCollectionID, saved.hasServerKey)
      else setPage('settings')
    } catch (e) {
      setError(errorMessage(e, '保存连接配置失败'))
    } finally {
      setBusy(false)
    }
  }, [client, refreshKnowledge, selectedCollectionID, serverBaseUrl, serverKeyInput])

  const clearConnection = React.useCallback(async () => {
    if (!client) return
    setBusy(true)
    setError(null)
    try {
      const cleared = await client.request<ConnectionSettings>('knowledge.connection.clear')
      knowledgeLoadSeqRef.current += 1
      documentLoadSeqRef.current += 1
      setConnection(cleared)
      setServerBaseUrl(cleared.serverBaseUrl)
      setServerKeyInput('')
      clearKnowledgeState()
      setSelectedCollectionID(null)
      selectedDocumentByViewRef.current = {}
    } catch (e) {
      setError(errorMessage(e, '清空连接配置失败'))
    } finally {
      setBusy(false)
    }
  }, [clearKnowledgeState, client])

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

  const openCollection = React.useCallback((id: string) => {
    const viewKey = `collections:${id}`
    currentViewKeyRef.current = viewKey
    setSelectedCollectionID(id)
    const collection = collections.find(item => item.id === id)
    const rememberedID = selectedDocumentByViewRef.current[viewKey]
    const firstDocumentID = collection?.document_ids.find(documentID => documentID === rememberedID && documents.some(document => document.id === documentID))
      || collection?.document_ids.find(documentID => documents.some(document => document.id === documentID))
      || null
    if (client) void loadDocument(client, firstDocumentID, viewKey).catch(e => setError(errorMessage(e, '读取资料详情失败')))
  }, [client, collections, documents, loadDocument])

  const closeCollection = React.useCallback(() => {
    currentViewKeyRef.current = 'collections'
    setSelectedCollectionID(null)
    setSelectedDocument(null)
    setSelectedDocumentID(null)
    selectedDocumentByViewRef.current.collections = null
  }, [])

  const selectDocument = React.useCallback((id: string) => {
    if (!client) return
    void loadDocument(client, id, scrollKey).catch(e => setError(errorMessage(e, '读取资料详情失败')))
  }, [client, loadDocument, scrollKey])

  return (
    <main className="kc-app">
      <KnowledgeTopbar
        page={page}
        pages={KNOWLEDGE_PAGES}
        standalone={launchInfo.standalone}
        connected={connected}
        hasServerKey={Boolean(connection?.hasServerKey)}
        busy={busy}
        onBack={closeSettings}
        onOpenPage={openKnowledgePage}
        onOpenSettings={openSettings}
        onRefresh={() => refreshKnowledge(isKnowledgePage(page) ? page : undefined)}
        onStartDragging={() => appWindow.startDragging()}
        windowActions={{
          minimize: () => appWindow.minimize(),
          toggleMaximize: () => appWindow.toggleMaximize(),
          closeToTray: () => invoke('hide_to_tray'),
        }}
      />

      <section ref={pageScrollRef} className="kc-page" onScroll={rememberPageScroll}>
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
        ) : page === 'collections' ? (
          <CollectionsView
            collections={collections}
            documents={documents}
            selectedCollectionID={selectedCollectionID}
            selectedDocumentID={selectedDocumentID}
            selectedDocument={selectedDocument}
            onOpenCollection={openCollection}
            onCloseCollection={closeCollection}
            onSelectDocument={selectDocument}
          />
        ) : (
          <DocumentsView
            page={page}
            connection={connection}
            documents={documents}
            selectedDocumentID={selectedDocumentID}
            selectedDocument={selectedDocument}
            query={query}
            tag={tag}
            busy={busy}
            onQueryChange={setQuery}
            onTagChange={setTag}
            onApplyFilters={() => refreshKnowledge(page)}
            onSelectDocument={selectDocument}
          />
        )}
      </section>

      {error ? <div className="kc-error-card" role="alert">{error}</div> : null}
    </main>
  )
}

const host = document.getElementById('app')
if (host) createRoot(host).render(<App />)
