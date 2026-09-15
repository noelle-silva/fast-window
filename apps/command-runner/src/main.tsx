import * as React from 'react'
import { createRoot } from 'react-dom/client'
import AddIcon from '@mui/icons-material/Add'
import CreateNewFolderOutlinedIcon from '@mui/icons-material/CreateNewFolderOutlined'
import { Alert, Box, Button, CircularProgress, CssBaseline, Snackbar, ThemeProvider, Typography } from '@mui/material'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { AppTopbar, type TopbarMenuItem } from './components/AppTopbar'
import { CommandExplorer } from './components/CommandExplorer'
import { CommandDialog } from './components/CommandDialog'
import { ConfirmRunDialog } from './components/ConfirmRunDialog'
import { DeleteConfirmDialog } from './components/DeleteConfirmDialog'
import { ExecutionSpacePage } from './components/ExecutionSpacePage'
import { FolderDialog } from './components/FolderDialog'
import { RepoCard } from './components/RepoCard'
import { RepoDialog } from './components/RepoDialog'
import { RepoGrid } from './components/RepoGrid'
import { RepoPage } from './components/RepoPage'
import { QuickRunConfirmDialog } from './components/QuickRunConfirmDialog'
import { QuickRunDialog } from './components/QuickRunDialog'
import { QuickRunPage } from './components/QuickRunPage'
import { QuickRunResultDialog } from './components/QuickRunResultDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { createDirectClient } from './directClient'
import { useCommandRunnerData, type SettingsDraft } from './commandRunnerData'
import { selectRepoCollections } from './collectionsTree'
import { useFolderNavigation } from './folderNavigation'
import { useExecutionSpace } from './executionSpace'
import { commandRunnerTheme } from './theme'
import type {
  CollectionNode,
  CommandDraft,
  CommandItem,
  CommandRunMode,
  DataDirStatus,
  DirectClient,
  FwLaunchInfo,
  ProcessOwnership,
  QuickRun,
  QuickRunRunResult,
  Repo,
} from './types'
import { DEFAULT_LAUNCH_INFO } from './types'
import './styles.css'

const appWindow = getCurrentWindow()

type DialogState =
  | { kind: 'none' }
  | { kind: 'settings' }
  | { kind: 'repo-create' }
  | { kind: 'repo-edit'; repo: Repo }
  | { kind: 'repo-delete'; repo: Repo }
  | { kind: 'command-create' }
  | { kind: 'command-edit'; command: CommandItem }
  | { kind: 'command-delete'; command: CommandItem }
  | { kind: 'confirm-run'; command: CommandItem; restartRunId?: string }
  | { kind: 'folder-create'; repoId: string; parentId: string }
  | { kind: 'folder-rename'; folder: CollectionNode }
  | { kind: 'folder-delete'; folder: CollectionNode }
  | { kind: 'quick-run-create' }
  | { kind: 'quick-run-edit'; quickRun: QuickRun }
  | { kind: 'quick-run-delete'; quickRun: QuickRun }
  | { kind: 'quick-run-confirm'; quickRun: QuickRun }
  | { kind: 'quick-run-result'; quickRunName: string; result: QuickRunRunResult }

const NO_DIALOG: DialogState = { kind: 'none' }

type SpaceView = { kind: 'repo'; repoId: string } | { kind: 'global' }

// GLOBAL_SPACE_KEY 是「全局空间」在顶部空间菜单中的标识。
const GLOBAL_SPACE_KEY = 'global'

// REPO_HOME_KEY 是「首页」在顶部仓库菜单中的标识。
const REPO_HOME_KEY = 'home'

function errorMessage(error: unknown, fallback: string): string {
  return String((error as { message?: string })?.message || error || fallback)
}

function App() {
  const [launchInfo, setLaunchInfo] = React.useState<FwLaunchInfo>(DEFAULT_LAUNCH_INFO)
  const [client, setClient] = React.useState<DirectClient | null>(null)
  const [phase, setPhase] = React.useState<'starting' | 'ready' | 'failed'>('starting')
  const [busy, setBusy] = React.useState(false)
  const [connectError, setConnectError] = React.useState<string | null>(null)
  const [activeRepoId, setActiveRepoId] = React.useState<string | null>(null)
  const [spaceView, setSpaceView] = React.useState<SpaceView | null>(null)
  const [quickRunView, setQuickRunView] = React.useState(false)
  const [dialog, setDialog] = React.useState<DialogState>(NO_DIALOG)
  const [snack, setSnack] = React.useState<string | null>(null)
  const [stoppingRunIds, setStoppingRunIds] = React.useState<Set<string>>(new Set())
  const [restartingRunIds, setRestartingRunIds] = React.useState<Set<string>>(new Set())
  const readyRef = React.useRef(false)
  const clientRef = React.useRef<DirectClient | null>(null)
  const connectIdRef = React.useRef(0)
  const activeRepoIdRef = React.useRef<string | null>(null)
  const reposRef = React.useRef<Repo[]>([])
  const backendReady = phase === 'ready' && Boolean(client)
  const controlsDisabled = !backendReady || busy
  const { settings, shells, repos, commands, collections, quickRuns, loading, error, actions } = useCommandRunnerData(client)
  const executionSpace = useExecutionSpace(client, commands, settings)
  const visibleError = connectError || error

  const activeRepo = repos.find(repo => repo.id === activeRepoId) || null
  const confirmRunRepo = dialog.kind === 'confirm-run'
    ? repos.find(repo => repo.id === dialog.command.repoId) || null
    : null
  const spaceRepo = spaceView?.kind === 'repo' ? repos.find(repo => repo.id === spaceView.repoId) || null : null
  const spaceEntries = spaceView
    ? spaceView.kind === 'repo'
      ? executionSpace.entries.filter(entry => entry.repoId === spaceView.repoId)
      : executionSpace.entries
    : []
  const activeSpaceKey = spaceView ? (spaceView.kind === 'global' ? GLOBAL_SPACE_KEY : spaceView.repoId) : null
  // spaceNavItems 供顶部栏空间菜单列出全部空间：全局空间 + 各仓库。
  const spaceNavItems = React.useMemo<TopbarMenuItem[]>(() => [
    { key: GLOBAL_SPACE_KEY, label: '全局空间' },
    ...repos.map(repo => ({ key: repo.id, label: repo.name })),
  ], [repos])
  // repoNavItems 供顶部栏仓库菜单列出首页与全部仓库：首页 + 各仓库。
  const repoNavItems = React.useMemo<TopbarMenuItem[]>(() => [
    { key: REPO_HOME_KEY, label: '首页' },
    ...repos.map(repo => ({ key: repo.id, label: repo.name })),
  ], [repos])
  const repoNameById = React.useMemo(() => new Map(repos.map(repo => [repo.id, repo.name])), [repos])
  const activeRepoCommands = activeRepo ? commands.filter(command => command.repoId === activeRepo.id) : []
  const activeRepoCollections = React.useMemo(
    () => selectRepoCollections(collections?.nodes ?? {}, activeRepo?.id ?? ''),
    [collections, activeRepo],
  )
  const folderNavigation = useFolderNavigation(activeRepo?.id ?? '', activeRepoCollections)
  const activeRepoRoot = activeRepo ? activeRepoCollections[activeRepo.id] : undefined
  const hasTreeContent = activeRepoCommands.length > 0 || (activeRepoRoot?.children.length ?? 0) > 0

  const stopRun = React.useCallback(async (runId: string) => {
    setStoppingRunIds(current => new Set(current).add(runId))
    try {
      await executionSpace.stopRun(runId)
    } catch (e) {
      setSnack(errorMessage(e, '停止命令失败'))
    } finally {
      setStoppingRunIds(current => {
        const next = new Set(current)
        next.delete(runId)
        return next
      })
    }
  }, [executionSpace.stopRun])

  const stopAllRuns = React.useCallback(async () => {
    const runningIds = executionSpace.entries
      .filter(entry => entry.status === 'running')
      .map(entry => entry.runId)
    if (runningIds.length === 0) return
    await Promise.all(runningIds.map(runId => stopRun(runId)))
    setSnack(`已请求停止 ${runningIds.length} 个运行进程`)
  }, [executionSpace.entries, stopRun])

  const markAppReady = React.useCallback(() => {
    if (readyRef.current) return
    readyRef.current = true
    void invoke('app_ready').catch(() => {})
  }, [])

  const closeActiveClient = React.useCallback(() => {
    clientRef.current?.close()
    clientRef.current = null
    setClient(null)
  }, [])

  const installClient = React.useCallback((nextClient: DirectClient) => {
    clientRef.current?.close()
    clientRef.current = nextClient
    setClient(nextClient)
  }, [])

  const connect = React.useCallback(async (options?: { restartBackend?: boolean }) => {
    const connectId = ++connectIdRef.current
    let nextClient: DirectClient | null = null
    setBusy(true)
    setConnectError(null)
    setPhase('starting')
    closeActiveClient()
    try {
      if (options?.restartBackend) await invoke('restart_backend')
      nextClient = await createDirectClient()
      await nextClient.request<Record<string, unknown>>('commandRunner.health')
      if (connectIdRef.current !== connectId) {
        nextClient.close()
        return
      }
      installClient(nextClient)
      setPhase('ready')
    } catch (e) {
      nextClient?.close()
      if (connectIdRef.current === connectId) {
        setPhase('failed')
        setConnectError(errorMessage(e, '启动 Command Runner 后台失败'))
      }
    } finally {
      if (connectIdRef.current === connectId) setBusy(false)
    }
  }, [closeActiveClient, installClient])

  React.useEffect(() => {
    activeRepoIdRef.current = activeRepoId
  }, [activeRepoId])

  React.useEffect(() => {
    reposRef.current = repos
  }, [repos])

  React.useEffect(() => {
    if (activeRepoId && !activeRepo) setActiveRepoId(null)
  }, [activeRepo, activeRepoId])

  React.useEffect(() => {
    if (spaceView?.kind === 'repo' && !repos.some(repo => repo.id === spaceView.repoId)) {
      setSpaceView(null)
    }
  }, [repos, spaceView])

  const openCreateRepo = React.useCallback(() => setDialog({ kind: 'repo-create' }), [])
  const openSettings = React.useCallback(() => setDialog({ kind: 'settings' }), [])

  // openSpaceByKey 按顶部栏空间菜单的标识切换到对应空间：全局标识或仓库 id。
  const openSpaceByKey = React.useCallback((key: string) => {
    if (key === GLOBAL_SPACE_KEY) {
      setQuickRunView(false)
      setSpaceView({ kind: 'global' })
      return
    }
    const repo = repos.find(item => item.id === key)
    if (!repo) return
    setQuickRunView(false)
    setSpaceView({ kind: 'repo', repoId: repo.id })
  }, [repos])

  // openRepoByKey 按顶部栏仓库菜单的标识切换视图：首页标识回到仓库总览，仓库 id 打开对应仓库的命令页。
  const openRepoByKey = React.useCallback((key: string) => {
    if (key !== REPO_HOME_KEY && !repos.some(item => item.id === key)) return
    setQuickRunView(false)
    setSpaceView(null)
    setActiveRepoId(key === REPO_HOME_KEY ? null : key)
  }, [repos])

  const handleCommand = React.useCallback((command: string | null) => {
    if (command === 'new-repo') openCreateRepo()
    if (command === 'open-settings') openSettings()
  }, [openCreateRepo, openSettings])

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
      await connect()
      if (!cancelled) handleCommand(nextInitialCommand)
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
  }, [handleCommand])

  React.useEffect(() => () => {
    connectIdRef.current += 1
    clientRef.current?.close()
    clientRef.current = null
  }, [])

  const wrap = React.useCallback(async (action: () => Promise<void>, successMessage?: string) => {
    if (controlsDisabled) return
    setBusy(true)
    try {
      await action()
      setDialog(NO_DIALOG)
      if (successMessage) setSnack(successMessage)
    } finally {
      setBusy(false)
    }
  }, [controlsDisabled])

  const submitRepoCreate = React.useCallback(async (draft: { name: string; path: string; shellId: string; closeMode: string; countdownSeconds: number; runMode: CommandRunMode | ''; processOwnership: ProcessOwnership }) => {
    await wrap(async () => {
      await actions.createRepo(draft.name, draft.path, draft.closeMode, draft.countdownSeconds, draft.runMode, draft.processOwnership)
    }, '仓库已注册')
  }, [actions.createRepo, wrap])

  const submitRepoEdit = React.useCallback(async (draft: { name: string; path: string; shellId: string; closeMode: string; countdownSeconds: number; runMode: CommandRunMode | ''; processOwnership: ProcessOwnership }) => {
    const repo = dialog.kind === 'repo-edit' ? dialog.repo : null
    if (!repo) return
    await wrap(async () => {
      await actions.updateRepo(repo.id, draft.name, draft.path, draft.closeMode, draft.countdownSeconds, draft.runMode, draft.processOwnership)
    }, '仓库已更新')
  }, [actions.updateRepo, dialog, wrap])

  const submitRepoDelete = React.useCallback(async (repo: Repo) => {
    await wrap(async () => {
      await actions.deleteRepo(repo.id)
    }, `仓库「${repo.name}」已删除`)
  }, [actions.deleteRepo, wrap])

  const submitCommandCreate = React.useCallback(async (draft: CommandDraft) => {
    await wrap(async () => {
      await actions.createCommand(draft)
    }, '命令已创建')
  }, [actions.createCommand, wrap])

  const submitCommandEdit = React.useCallback(async (draft: CommandDraft) => {
    const command = dialog.kind === 'command-edit' ? dialog.command : null
    if (!command) return
    await wrap(async () => {
      await actions.updateCommand(command.id, draft)
    }, '命令已更新')
  }, [actions.updateCommand, dialog, wrap])

  const submitCommandDelete = React.useCallback(async (command: CommandItem) => {
    await wrap(async () => {
      await actions.deleteCommand(command.id)
    }, `命令「${command.name}」已删除`)
  }, [actions.deleteCommand, wrap])

  const submitFolderCreate = React.useCallback(async (name: string) => {
    const state = dialog
    if (state.kind !== 'folder-create') return
    await wrap(async () => {
      await actions.createFolder(state.repoId, state.parentId, name)
    }, '收藏夹已创建')
  }, [actions.createFolder, dialog, wrap])

  const submitFolderRename = React.useCallback(async (name: string) => {
    const state = dialog
    if (state.kind !== 'folder-rename') return
    await wrap(async () => {
      await actions.renameFolder(state.folder.id, name)
    }, '收藏夹已重命名')
  }, [actions.renameFolder, dialog, wrap])

  const submitFolderDelete = React.useCallback(async (folder: CollectionNode) => {
    await wrap(async () => {
      await actions.deleteFolder(folder.id)
    }, `收藏夹「${folder.name}」已删除，内容已移到上一级`)
  }, [actions.deleteFolder, wrap])

  const submitSettings = React.useCallback(async (draft: SettingsDraft) => {
    if (controlsDisabled) return
    setBusy(true)
    try {
      await actions.saveSettings(draft)
    } finally {
      setBusy(false)
    }
  }, [actions.saveSettings, controlsDisabled])

  const submitCustomShellAdd = React.useCallback(async (name: string, exePath: string, argsTemplate: string) => {
    if (controlsDisabled) return
    setBusy(true)
    try {
      await actions.addCustomShell(name, exePath, argsTemplate)
    } finally {
      setBusy(false)
    }
  }, [actions.addCustomShell, controlsDisabled])

  const submitCustomShellRemove = React.useCallback(async (id: string) => {
    if (controlsDisabled) return
    setBusy(true)
    try {
      await actions.removeCustomShell(id)
    } finally {
      setBusy(false)
    }
  }, [actions.removeCustomShell, controlsDisabled])

  const runCommand = React.useCallback(async (command: CommandItem) => {
    if (controlsDisabled) return
    try {
      await actions.runCommand(command.id)
      setSnack(`「${command.name}」已在独立窗口启动`)
    } catch (e) {
      // 失败向上抛：确认弹窗内展示错误并恢复按钮；直跑路径由 Snackbar 呈现。
      throw e
    }
  }, [actions.runCommand, controlsDisabled])

  const requestRunCommand = React.useCallback((command: CommandItem) => {
    if (command.confirmBeforeRun) {
      setDialog({ kind: 'confirm-run', command })
      return
    }
    void runCommand(command).catch(e => setSnack(errorMessage(e, '运行命令失败')))
  }, [runCommand])

  // performRestartRun 重启一个运行实例：后端确认旧实例彻底结束后才启动新实例；
  // 新实例接管旧卡片在侧边栏中的位置，旧卡片随之退场。
  const performRestartRun = React.useCallback(async (command: CommandItem, runId: string) => {
    setRestartingRunIds(current => new Set(current).add(runId))
    try {
      const anchorIndex = executionSpace.entryIndex(runId)
      const result = await actions.restartRun(runId, command.id)
      executionSpace.handOffEntry(runId, result.runId, anchorIndex)
    } finally {
      setRestartingRunIds(current => {
        const next = new Set(current)
        next.delete(runId)
        return next
      })
    }
  }, [actions.restartRun, executionSpace.entryIndex, executionSpace.handOffEntry])

  const requestRestartRun = React.useCallback((runId: string, commandId: string) => {
    const command = commands.find(item => item.id === commandId)
    if (!command) {
      setSnack('该命令已被删除，无法重新运行')
      return
    }
    if (command.confirmBeforeRun) {
      setDialog({ kind: 'confirm-run', command, restartRunId: runId })
      return
    }
    void performRestartRun(command, runId).catch(e => setSnack(errorMessage(e, '重新运行失败')))
  }, [commands, performRestartRun])

  const submitQuickRunCreate = React.useCallback(async (name: string, commandIds: string[]) => {
    await wrap(async () => {
      await actions.createQuickRun(name, commandIds)
    }, '快捷运行已创建')
  }, [actions.createQuickRun, wrap])

  const submitQuickRunEdit = React.useCallback(async (name: string, commandIds: string[]) => {
    const quickRun = dialog.kind === 'quick-run-edit' ? dialog.quickRun : null
    if (!quickRun) return
    await wrap(async () => {
      await actions.updateQuickRun(quickRun.id, name, commandIds)
    }, '快捷运行已更新')
  }, [actions.updateQuickRun, dialog, wrap])

  const submitQuickRunDelete = React.useCallback(async (quickRun: QuickRun) => {
    await wrap(async () => {
      await actions.deleteQuickRun(quickRun.id)
    }, `快捷运行「${quickRun.name}」已删除`)
  }, [actions.deleteQuickRun, wrap])

  // executeQuickRun 启动整组命令并统一反馈：全部成功轻提示；存在失败弹结果窗列出明细。
  const executeQuickRun = React.useCallback(async (quickRun: QuickRun) => {
    const result = await actions.runQuickRun(quickRun.id)
    if (result.failures.length > 0) {
      setDialog({ kind: 'quick-run-result', quickRunName: quickRun.name, result })
    } else {
      setDialog(NO_DIALOG)
      setSnack(`快捷运行「${quickRun.name}」已启动 ${result.started.length} 条命令`)
    }
  }, [actions.runQuickRun])

  const requestQuickRun = React.useCallback((quickRun: QuickRun) => {
    const commandById = new Map(commands.map(command => [command.id, command]))
    const needsConfirm = quickRun.commandIds.some(id => commandById.get(id)?.confirmBeforeRun)
    if (needsConfirm) {
      setDialog({ kind: 'quick-run-confirm', quickRun })
      return
    }
    void executeQuickRun(quickRun).catch(e => setSnack(errorMessage(e, '启动快捷运行失败')))
  }, [commands, executeQuickRun])

  return (
    <ThemeProvider theme={commandRunnerTheme}>
      <CssBaseline />
      <main className="cr-app">
        <AppTopbar
          standalone={launchInfo.standalone}
          disabled={controlsDisabled}
          repoItems={repoNavItems}
          activeRepoKey={activeRepoId}
          spaceItems={spaceNavItems}
          activeSpaceKey={activeSpaceKey}
          onCreateRepo={openCreateRepo}
          onOpenQuickRuns={() => setQuickRunView(true)}
          onOpenRepo={openRepoByKey}
          onOpenSpace={openSpaceByKey}
          onOpenSettings={openSettings}
          onStartDragging={() => appWindow.startDragging()}
          windowActions={{
            minimize: () => appWindow.minimize(),
            toggleMaximize: () => appWindow.toggleMaximize(),
            closeToTray: () => invoke('hide_to_tray'),
          }}
        />

        {visibleError ? (
          <Alert
            className="cr-status-alert"
            severity="error"
            action={
              phase === 'failed' ? (
                <Button size="small" color="inherit" disabled={busy} onClick={() => connect({ restartBackend: true })}>重试</Button>
              ) : null
            }
          >
            {visibleError}
          </Alert>
        ) : null}

        {phase === 'starting' || (loading && !repos.length && !settings) ? (
          <Box className="cr-service-panel" role="status" aria-live="polite">
            <CircularProgress size={24} />
            <Typography component="span" color="text.secondary" sx={{ fontSize: 13, fontWeight: 700 }}>正在连接本地服务</Typography>
          </Box>
        ) : null}

        {phase === 'failed' ? (
          <Box className="cr-service-panel" role="status" aria-live="polite">
            <Typography component="strong" sx={{ fontSize: 15, fontWeight: 900 }}>本地服务未启动</Typography>
            <Button size="small" disabled={busy} onClick={() => connect({ restartBackend: true })}>重新连接</Button>
          </Box>
        ) : null}

        {phase === 'ready' && !(loading && !repos.length && !settings) ? (
          quickRunView ? (
            <QuickRunPage
              quickRuns={quickRuns}
              commands={commands}
              repos={repos}
              disabled={controlsDisabled}
              onBack={() => setQuickRunView(false)}
              onCreate={() => setDialog({ kind: 'quick-run-create' })}
              onEdit={quickRun => setDialog({ kind: 'quick-run-edit', quickRun })}
              onDelete={quickRun => setDialog({ kind: 'quick-run-delete', quickRun })}
              onRun={requestQuickRun}
            />
          ) : spaceView && (spaceView.kind === 'global' || spaceRepo) ? (
            <ExecutionSpacePage
              title={spaceView.kind === 'repo' ? `内置执行空间 · ${spaceRepo?.name ?? ''}` : '全局内置执行空间'}
              subtitle={spaceView.kind === 'repo'
                ? '以内置模式运行的命令会在这里实时输出，输出不经过独立窗口。'
                : '所有仓库以内置模式运行的命令都在这里实时输出。'}
              entries={spaceEntries}
              repoNames={spaceView.kind === 'global' ? repoNameById : undefined}
              stoppingRunIds={stoppingRunIds}
              restartingRunIds={restartingRunIds}
              onBack={() => setSpaceView(null)}
              onStopRun={runId => void stopRun(runId)}
              onRemoveEntry={executionSpace.removeEntry}
              onRestartRun={requestRestartRun}
              onMoveEntry={executionSpace.moveEntry}
              onStopAll={spaceView.kind === 'global' ? stopAllRuns : undefined}
            />
          ) : activeRepo ? (
            <Box className="cr-repo-page">
              <RepoPage
                repo={activeRepo}
                processCounts={executionSpace.countsForRepo(activeRepo.id)}
                canGoBack={folderNavigation.canGoBack}
                canGoForward={folderNavigation.canGoForward}
                onGoBack={folderNavigation.goBack}
                onGoForward={folderNavigation.goForward}
                onBack={() => setActiveRepoId(null)}
                onCreateCommand={() => setDialog({ kind: 'command-create' })}
                onAddFolder={() => setDialog({ kind: 'folder-create', repoId: activeRepo.id, parentId: folderNavigation.currentFolderId })}
                onEditRepo={() => setDialog({ kind: 'repo-edit', repo: activeRepo })}
                onOpenExecutionSpace={() => setSpaceView({ kind: 'repo', repoId: activeRepo.id })}
              />
              {!hasTreeContent ? (
                <Box className="cr-empty-state">
                  <Typography component="strong" sx={{ fontSize: 14, fontWeight: 900 }}>这个仓库还没有命令</Typography>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button size="small" variant="contained" startIcon={<AddIcon fontSize="small" />} onClick={() => setDialog({ kind: 'command-create' })}>
                      新建第一条命令
                    </Button>
                    <Button size="small" startIcon={<CreateNewFolderOutlinedIcon fontSize="small" />} onClick={() => setDialog({ kind: 'folder-create', repoId: activeRepo.id, parentId: activeRepo.id })}>
                      添加收藏夹
                    </Button>
                  </Box>
                </Box>
              ) : (
                <CommandExplorer
                  repo={activeRepo}
                  nodes={activeRepoCollections}
                  commands={activeRepoCommands}
                  settings={settings}
                  shells={shells}
                  disabled={controlsDisabled}
                  currentFolderId={folderNavigation.currentFolderId}
                  pathIds={folderNavigation.pathIds}
                  onNavigate={folderNavigation.navigateTo}
                  runningCountFor={commandId => executionSpace.countsForCommand(commandId).running}
                  onRun={requestRunCommand}
                  onEdit={command => setDialog({ kind: 'command-edit', command })}
                  onDelete={command => setDialog({ kind: 'command-delete', command })}
                  onMove={(nodeId, targetId, index) => actions.moveNode(nodeId, targetId, index).catch(e => setSnack(errorMessage(e, '移动失败')))}
                  onRenameFolder={folder => setDialog({ kind: 'folder-rename', folder })}
                  onDeleteFolder={folder => setDialog({ kind: 'folder-delete', folder })}
                />
              )}
            </Box>
          ) : (
            <RepoGrid
              repos={repos}
              commands={{ countFor: repoId => commands.filter(command => command.repoId === repoId).length }}
              settings={settings}
              shells={shells}
              disabled={controlsDisabled}
              countsForRepo={executionSpace.countsForRepo}
              onOpen={repo => setActiveRepoId(repo.id)}
              onEdit={repo => setDialog({ kind: 'repo-edit', repo })}
              onReorder={ids => actions.reorderRepos(ids).catch(e => setSnack(errorMessage(e, '仓库排序保存失败')))}
              onCreateRepo={openCreateRepo}
            />
          )
        ) : null}

        {dialog.kind === 'settings' && settings ? (
          <SettingsDialog
            settings={settings}
            shells={shells}
            disabled={controlsDisabled}
            submitting={busy}
            onSaveSettings={submitSettings}
            onAddCustomShell={submitCustomShellAdd}
            onRemoveCustomShell={submitCustomShellRemove}
            onClose={() => setDialog(NO_DIALOG)}
          />
        ) : null}

        {dialog.kind === 'repo-create' ? (
          <RepoDialog
            title="注册仓库"
            submitLabel="注册仓库"
            shells={shells}
            settings={settings}
            disabled={controlsDisabled}
            submitting={busy}
            onSubmit={submitRepoCreate}
            onClose={() => setDialog(NO_DIALOG)}
          />
        ) : null}

        {dialog.kind === 'repo-edit' ? (
          <RepoDialog
            title="仓库设置"
            submitLabel="保存修改"
            initial={dialog.repo}
            shells={shells}
            settings={settings}
            disabled={controlsDisabled}
            submitting={busy}
            onSubmit={submitRepoEdit}
            onClose={() => setDialog(NO_DIALOG)}
          />
        ) : null}

        {dialog.kind === 'repo-delete' ? (
          <DeleteConfirmDialog
            title="删除仓库"
            message={`将删除仓库「${dialog.repo.name}」以及它名下的全部命令记录，仓库目录本身不会被删除。`}
            disabled={controlsDisabled}
            onConfirm={() => submitRepoDelete(dialog.repo)}
            onClose={() => setDialog(NO_DIALOG)}
          />
        ) : null}

        {dialog.kind === 'command-create' && activeRepo ? (
          <CommandDialog
            repo={activeRepo}
            shells={shells}
            settings={settings}
            disabled={controlsDisabled}
            submitting={busy}
            onSubmit={submitCommandCreate}
            onClose={() => setDialog(NO_DIALOG)}
          />
        ) : null}

        {dialog.kind === 'command-edit' && activeRepo ? (
          <CommandDialog
            repo={activeRepo}
            initial={dialog.command}
            shells={shells}
            settings={settings}
            disabled={controlsDisabled}
            submitting={busy}
            onSubmit={submitCommandEdit}
            onClose={() => setDialog(NO_DIALOG)}
          />
        ) : null}

        {dialog.kind === 'command-delete' && activeRepo ? (
          <DeleteConfirmDialog
            title="删除命令"
            message={`将删除命令「${dialog.command.name}」及其全部配置。`}
            disabled={controlsDisabled}
            onConfirm={() => submitCommandDelete(dialog.command)}
            onClose={() => setDialog(NO_DIALOG)}
          />
        ) : null}

        {dialog.kind === 'folder-create' ? (
          <FolderDialog
            title="添加收藏夹"
            subtitle="收藏夹用来给命令分类，还可以在收藏夹里继续嵌套子收藏夹。"
            submitLabel="创建收藏夹"
            disabled={controlsDisabled}
            submitting={busy}
            onSubmit={submitFolderCreate}
            onClose={() => setDialog(NO_DIALOG)}
          />
        ) : null}

        {dialog.kind === 'folder-rename' ? (
          <FolderDialog
            title="重命名收藏夹"
            submitLabel="保存修改"
            initialName={dialog.folder.name}
            disabled={controlsDisabled}
            submitting={busy}
            onSubmit={submitFolderRename}
            onClose={() => setDialog(NO_DIALOG)}
          />
        ) : null}

        {dialog.kind === 'folder-delete' ? (
          <DeleteConfirmDialog
            title="删除收藏夹"
            message={`将删除收藏夹「${dialog.folder.name}」。其中的命令与子收藏夹会移动到上一级，命令不会被删除。`}
            disabled={controlsDisabled}
            onConfirm={() => submitFolderDelete(dialog.folder)}
            onClose={() => setDialog(NO_DIALOG)}
          />
        ) : null}

        {dialog.kind === 'confirm-run' && confirmRunRepo ? (
          <ConfirmRunDialog
            command={dialog.command}
            repo={confirmRunRepo}
            settings={settings}
            shells={shells}
            disabled={controlsDisabled}
            variant={dialog.restartRunId ? 'restart' : 'run'}
            onConfirm={() => dialog.restartRunId
              ? performRestartRun(dialog.command, dialog.restartRunId)
              : runCommand(dialog.command)}
            onClose={() => setDialog(NO_DIALOG)}
          />
        ) : null}

        {dialog.kind === 'quick-run-create' ? (
          <QuickRunDialog
            title="新建快捷运行"
            subtitle="从所有仓库中选择多条命令，运行时一键同时启动。"
            submitLabel="创建快捷运行"
            commands={commands}
            repos={repos}
            disabled={controlsDisabled}
            submitting={busy}
            onSubmit={submitQuickRunCreate}
            onClose={() => setDialog(NO_DIALOG)}
          />
        ) : null}

        {dialog.kind === 'quick-run-edit' ? (
          <QuickRunDialog
            title="编辑快捷运行"
            submitLabel="保存修改"
            initial={dialog.quickRun}
            commands={commands}
            repos={repos}
            disabled={controlsDisabled}
            submitting={busy}
            onSubmit={submitQuickRunEdit}
            onClose={() => setDialog(NO_DIALOG)}
          />
        ) : null}

        {dialog.kind === 'quick-run-delete' ? (
          <DeleteConfirmDialog
            title="删除快捷运行"
            message={`将删除快捷运行「${dialog.quickRun.name}」。其中的命令不会被删除。`}
            disabled={controlsDisabled}
            onConfirm={() => submitQuickRunDelete(dialog.quickRun)}
            onClose={() => setDialog(NO_DIALOG)}
          />
        ) : null}

        {dialog.kind === 'quick-run-confirm' ? (
          <QuickRunConfirmDialog
            quickRun={dialog.quickRun}
            commands={commands}
            repos={repos}
            disabled={controlsDisabled}
            onConfirm={() => executeQuickRun(dialog.quickRun)}
            onClose={() => setDialog(NO_DIALOG)}
          />
        ) : null}

        {dialog.kind === 'quick-run-result' ? (
          <QuickRunResultDialog
            quickRunName={dialog.quickRunName}
            result={dialog.result}
            onClose={() => setDialog(NO_DIALOG)}
          />
        ) : null}

        <Snackbar
          open={Boolean(snack)}
          autoHideDuration={3200}
          onClose={() => setSnack(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert severity="success" onClose={() => setSnack(null)}>
            {snack}
          </Alert>
        </Snackbar>
      </main>
    </ThemeProvider>
  )
}

const host = document.getElementById('app')
if (host) createRoot(host).render(<App />)
