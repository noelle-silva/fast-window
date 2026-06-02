import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createDirectClient, errorMessage, type DirectClient } from './backendClient'
import { OperationBanner } from './components/OperationBanner'
import { SetupConsentDialog } from './components/SetupConsentDialog'
import { TopBar } from './components/TopBar'
import { SearchPage } from './pages/SearchPage'
import { SettingsPage } from './pages/SettingsPage'
import {
  DEFAULT_LAUNCH_INFO,
  DEFAULT_SEARCH_LIMIT,
  type AppPhase,
  type AppView,
  type DataDirStatus,
  type FwLaunchInfo,
  type HealthInfo,
  type RuntimeStatus,
  type SearchResponse,
  type SearchResult,
  type SetupInfo,
} from './types'
import { UI_OPERATIONS, type UiOperation } from './uiOperations'

const appWindow = getCurrentWindow()
const SEARCH_LIMIT_STORAGE_KEY = 'fast-window-everything.searchLimit'
const SEARCH_LIMIT_MIN = 20
const SEARCH_LIMIT_MAX = 500
const SEARCH_LIMIT_STEP = 20

function normalizeSearchLimit(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_SEARCH_LIMIT
  const snapped = SEARCH_LIMIT_MIN + Math.round((value - SEARCH_LIMIT_MIN) / SEARCH_LIMIT_STEP) * SEARCH_LIMIT_STEP
  return Math.min(SEARCH_LIMIT_MAX, Math.max(SEARCH_LIMIT_MIN, snapped))
}

function readStoredSearchLimit() {
  const raw = window.localStorage.getItem(SEARCH_LIMIT_STORAGE_KEY)
  if (!raw) return DEFAULT_SEARCH_LIMIT
  return normalizeSearchLimit(Number(raw))
}

export function App() {
  const [view, setView] = React.useState<AppView>('search')
  const [launchInfo, setLaunchInfo] = React.useState<FwLaunchInfo>(DEFAULT_LAUNCH_INFO)
  const [initialCommand, setInitialCommand] = React.useState<string | null>(null)
  const [runtimeCommand, setRuntimeCommand] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<DataDirStatus | null>(null)
  const [health, setHealth] = React.useState<HealthInfo | null>(null)
  const [setup, setSetup] = React.useState<SetupInfo | null>(null)
  const [client, setClient] = React.useState<DirectClient | null>(null)
  const [query, setQuery] = React.useState('')
  const [searchScopePath, setSearchScopePath] = React.useState('')
  const [searchLimit, setSearchLimit] = React.useState(readStoredSearchLimit)
  const [lastSearchedQuery, setLastSearchedQuery] = React.useState('')
  const [results, setResults] = React.useState<SearchResult[]>([])
  const [phase, setPhase] = React.useState<AppPhase>('starting')
  const [operation, setOperation] = React.useState<UiOperation | null>(null)
  const [searching, setSearching] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const readyRef = React.useRef(false)
  const queryRef = React.useRef<HTMLInputElement | null>(null)
  const searchRunIdRef = React.useRef(0)
  const busy = Boolean(operation)
  const setupConsentOpen = Boolean(setup && !setup.configured)

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

  const refreshBackendState = React.useCallback(async (active: DirectClient) => {
    const [nextHealth, nextSetup] = await Promise.all([
      active.request<HealthInfo>('everything.health'),
      active.request<SetupInfo>('everything.setup.get'),
    ])
    setHealth(nextHealth)
    setSetup(nextSetup)
    return { health: nextHealth, setup: nextSetup }
  }, [])

  const runOperation = React.useCallback(async <T,>(nextOperation: UiOperation, action: () => Promise<T>): Promise<T> => {
    setOperation(nextOperation)
    setError(null)
    try {
      return await action()
    } finally {
      setOperation(null)
    }
  }, [])

  const startRuntimeAfterConnect = React.useCallback(async (active: DirectClient) => {
    await runOperation(UI_OPERATIONS.runtimeStart, async () => {
      await active.request<RuntimeStatus>('everything.runtime.restart')
      await refreshBackendState(active)
    }).catch(e => {
      setError(errorMessage(e, '启动 Everything runtime 失败'))
      void refreshBackendState(active).catch(() => {})
    })
  }, [refreshBackendState, runOperation])

  const connect = React.useCallback(async () => {
    setError(null)
    setPhase('starting')
    client?.close()
    setClient(null)
    try {
      const nextClient = await createDirectClient()
      const state = await refreshBackendState(nextClient)
      setClient(nextClient)
      setPhase('ready')
      await refreshStatus()
      if (state.setup.configured && !state.health.runtime.ready) {
        void startRuntimeAfterConnect(nextClient)
      }
    } catch (e) {
      setPhase('failed')
      setError(errorMessage(e, '启动 Everything 后台失败'))
      await refreshStatus()
    }
  }, [client, refreshBackendState, refreshStatus, startRuntimeAfterConnect])

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
      if (nextInitialCommand === 'show-setup') setView('settings')
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
      if (!command) return
      setRuntimeCommand(command)
      if (command === 'show-setup') setView('settings')
      if (command === 'open-search' || command === 'focus-query') {
        setView('search')
        window.setTimeout(() => queryRef.current?.focus(), 0)
      }
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

  const runSearch = React.useCallback(async (nextScopePath = searchScopePath) => {
    if (!client) return
    if (operation) {
      setError(`${operation.title}，完成后再搜索。`)
      return
    }
    if (setup && !setup.configured) {
      setView('settings')
      setError('请先在设置页启用 Everything 全局索引。')
      return
    }
    const trimmed = query.trim()
    if (!trimmed) {
      searchRunIdRef.current += 1
      setResults([])
      setLastSearchedQuery('')
      return
    }
    const runId = searchRunIdRef.current + 1
    searchRunIdRef.current = runId
    setSearching(true)
    setError(null)
    try {
      const response = await client.request<SearchResponse>('everything.search', { query: trimmed, limit: searchLimit, scopePath: nextScopePath })
      if (searchRunIdRef.current !== runId) return
      setSearchScopePath(response.scopePath || nextScopePath)
      setLastSearchedQuery(response.query)
      setResults(response.results)
    } catch (e) {
      if (searchRunIdRef.current !== runId) return
      setError(errorMessage(e, 'Everything 搜索失败'))
    } finally {
      if (searchRunIdRef.current === runId) setSearching(false)
    }
  }, [client, operation, query, searchLimit, searchScopePath, setup])

  const runTopbarSearch = React.useCallback(() => {
    setView('search')
    void runSearch()
  }, [runSearch])

  const clearQuery = React.useCallback(() => {
    searchRunIdRef.current += 1
    setQuery('')
    setResults([])
    setLastSearchedQuery('')
    setSearching(false)
    setError(null)
    window.setTimeout(() => queryRef.current?.focus(), 0)
  }, [])

  const pickSearchScope = React.useCallback(async () => {
    const picked = await invoke<string | null>('pick_search_folder').catch(e => {
      setError(errorMessage(e, '选择搜索文件夹失败'))
      return null
    })
    if (!picked) return
    setView('search')
    setSearchScopePath(picked)
    if (query.trim()) void runSearch(picked)
    else window.setTimeout(() => queryRef.current?.focus(), 0)
  }, [query, runSearch])

  const clearSearchScope = React.useCallback(() => {
    setSearchScopePath('')
    if (query.trim()) void runSearch('')
    else window.setTimeout(() => queryRef.current?.focus(), 0)
  }, [query, runSearch])

  const updateSearchLimit = React.useCallback((value: number) => {
    const next = normalizeSearchLimit(value)
    setSearchLimit(next)
    window.localStorage.setItem(SEARCH_LIMIT_STORAGE_KEY, String(next))
  }, [])

  const enableGlobal = React.useCallback(async () => {
    if (!client) return
    await runOperation(UI_OPERATIONS.globalSetup, async () => {
      const next = await client.request<SetupInfo>('everything.setup.enableGlobal')
      setSetup(next)
      await refreshBackendState(client)
      setView('search')
      window.setTimeout(() => queryRef.current?.focus(), 0)
    }).catch(e => {
      setError(errorMessage(e, '启用 Everything 全局索引失败'))
    })
  }, [client, refreshBackendState, runOperation])

  const restartRuntime = React.useCallback(async () => {
    if (!client) return
    await runOperation(UI_OPERATIONS.runtimeRestart, async () => {
      await client.request<RuntimeStatus>('everything.runtime.restart')
      await refreshBackendState(client)
    }).catch(e => {
      setError(errorMessage(e, '重启 Everything runtime 失败'))
    })
  }, [client, refreshBackendState, runOperation])

  const openPath = React.useCallback(async (path: string) => {
    if (!client) return
    await client.request('everything.openPath', { path }).catch(e => setError(errorMessage(e, '打开文件失败')))
  }, [client])

  const copyPath = React.useCallback(async (path: string) => {
    if (!client) return
    await client.request('everything.copyPath', { path }).catch(e => setError(errorMessage(e, '复制文件失败')))
  }, [client])

  const revealPath = React.useCallback(async (path: string) => {
    if (!client) return
    await client.request('everything.revealPath', { path }).catch(e => setError(errorMessage(e, '打开所在位置失败')))
  }, [client])

  return (
    <main className="everything-app">
      <TopBar
        view={view}
        phase={phase}
        query={query}
        searchScopePath={searchScopePath}
        queryRef={queryRef}
        searching={searching}
        busy={busy}
        clientReady={Boolean(client)}
        onViewChange={setView}
        onQueryChange={setQuery}
        onClearQuery={clearQuery}
        onPickSearchScope={() => void pickSearchScope()}
        onClearSearchScope={clearSearchScope}
        onSearch={runTopbarSearch}
        onStartDrag={() => appWindow.startDragging()}
        standalone={launchInfo.standalone}
        onMinimize={() => appWindow.minimize()}
        onToggleMaximize={() => appWindow.toggleMaximize()}
        onCloseToTray={() => invoke('hide_to_tray')}
      />

      <div className="everything-main">
        <OperationBanner operation={operation} />
        {view === 'settings' ? (
          <SettingsPage
            status={status}
            health={health}
            setup={setup}
            busy={busy}
            clientReady={Boolean(client)}
            initialCommand={initialCommand}
            runtimeCommand={runtimeCommand}
            searchLimit={searchLimit}
            searchLimitRange={{ min: SEARCH_LIMIT_MIN, max: SEARCH_LIMIT_MAX, step: SEARCH_LIMIT_STEP }}
            onEnableGlobal={enableGlobal}
            onRestartRuntime={restartRuntime}
            onSearchLimitChange={updateSearchLimit}
          />
        ) : (
          <SearchPage
            setup={setup}
            searching={searching}
            results={results}
            lastSearchedQuery={lastSearchedQuery}
            onOpenSettings={() => setView('settings')}
            onOpenPath={path => void openPath(path)}
            onCopyPath={path => void copyPath(path)}
            onRevealPath={path => void revealPath(path)}
          />
        )}
      </div>

      {error ? <section className="everything-error-card" role="alert">{error}</section> : null}
      <SetupConsentDialog
        open={setupConsentOpen}
        busy={Boolean(operation?.key === 'globalSetup')}
        clientReady={Boolean(client)}
        error={error}
        onAuthorize={enableGlobal}
      />
    </main>
  )
}
