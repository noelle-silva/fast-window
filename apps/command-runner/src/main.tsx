import * as React from 'react'
import { createRoot } from 'react-dom/client'
import AddIcon from '@mui/icons-material/Add'
import { Alert, Box, Button, CircularProgress, CssBaseline, Snackbar, ThemeProvider, Typography } from '@mui/material'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { AppTopbar } from './components/AppTopbar'
import { CommandList } from './components/CommandList'
import { CommandDialog } from './components/CommandDialog'
import { ConfirmRunDialog } from './components/ConfirmRunDialog'
import { DeleteConfirmDialog } from './components/DeleteConfirmDialog'
import { ExecutionSpacePage } from './components/ExecutionSpacePage'
import { RepoCard } from './components/RepoCard'
import { RepoDialog } from './components/RepoDialog'
import { RepoGrid } from './components/RepoGrid'
import { RepoPage } from './components/RepoPage'
import { SettingsDialog } from './components/SettingsDialog'
import { createDirectClient } from './directClient'
import { useCommandRunnerData, type SettingsDraft } from './commandRunnerData'
import { useExecutionSpace } from './executionSpace'
import { commandRunnerTheme } from './theme'
import type {
  CommandDraft,
  CommandItem,
  CommandRunMode,
  DataDirStatus,
  DirectClient,
  FwLaunchInfo,
  ProcessOwnership,
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
  | { kind: 'confirm-run'; command: CommandItem }

const NO_DIALOG: DialogState = { kind: 'none' }

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
  const [spaceRepoId, setSpaceRepoId] = React.useState<string | null>(null)
  const [dialog, setDialog] = React.useState<DialogState>(NO_DIALOG)
  const [snack, setSnack] = React.useState<string | null>(null)
  const [stoppingRunIds, setStoppingRunIds] = React.useState<Set<string>>(new Set())
  const readyRef = React.useRef(false)
  const clientRef = React.useRef<DirectClient | null>(null)
  const connectIdRef = React.useRef(0)
  const activeRepoIdRef = React.useRef<string | null>(null)
  const reposRef = React.useRef<Repo[]>([])
  const backendReady = phase === 'ready' && Boolean(client)
  const controlsDisabled = !backendReady || busy
  const { settings, shells, repos, commands, loading, error, actions } = useCommandRunnerData(client)
  const executionSpace = useExecutionSpace(client, commands, settings)
  const visibleError = connectError || error

  const activeRepo = repos.find(repo => repo.id === activeRepoId) || null
  const spaceRepo = repos.find(repo => repo.id === spaceRepoId) || null
  const activeRepoCommands = activeRepo ? commands.filter(command => command.repoId === activeRepo.id) : []
  const spaceEntries = spaceRepo ? executionSpace.entries.filter(entry => entry.repoId === spaceRepo.id) : []

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

  const openCreateRepo = React.useCallback(() => setDialog({ kind: 'repo-create' }), [])
  const openSettings = React.useCallback(() => setDialog({ kind: 'settings' }), [])

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

  return (
    <ThemeProvider theme={commandRunnerTheme}>
      <CssBaseline />
      <main className="cr-app">
        <AppTopbar
          standalone={launchInfo.standalone}
          disabled={controlsDisabled}
          onCreateRepo={openCreateRepo}
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
            variant="outlined"
            action={
              phase === 'failed' ? (
                <Button size="small" disabled={busy} onClick={() => connect({ restartBackend: true })}>重试</Button>
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
          spaceRepo ? (
            <ExecutionSpacePage
              repoName={spaceRepo.name}
              entries={spaceEntries}
              stoppingRunIds={stoppingRunIds}
              onBack={() => setSpaceRepoId(null)}
              onStopRun={runId => void stopRun(runId)}
              onRemoveEntry={executionSpace.removeEntry}
              onToggleCollapse={executionSpace.toggleCollapse}
            />
          ) : activeRepo ? (
            <Box className="cr-repo-page">
              <RepoPage
                repo={activeRepo}
                onBack={() => setActiveRepoId(null)}
                onCreateCommand={() => setDialog({ kind: 'command-create' })}
                onEditRepo={() => setDialog({ kind: 'repo-edit', repo: activeRepo })}
                onOpenExecutionSpace={() => setSpaceRepoId(activeRepo.id)}
              />
              {activeRepoCommands.length === 0 ? (
                <Box className="cr-empty-state">
                  <Typography component="strong" sx={{ fontSize: 14, fontWeight: 900 }}>这个仓库还没有命令</Typography>
                  <Button size="small" variant="contained" startIcon={<AddIcon fontSize="small" />} onClick={() => setDialog({ kind: 'command-create' })}>
                    新建第一条命令
                  </Button>
                </Box>
              ) : (
                <CommandList
                  repo={activeRepo}
                  commands={activeRepoCommands}
                  settings={settings}
                  shells={shells}
                  disabled={controlsDisabled}
                  onRun={requestRunCommand}
                  onEdit={command => setDialog({ kind: 'command-edit', command })}
                  onDelete={command => setDialog({ kind: 'command-delete', command })}
                  onReorder={ids => actions.reorderCommands(ids)}
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
              runningCountFor={executionSpace.runningCountFor}
              onOpen={repo => setActiveRepoId(repo.id)}
              onEdit={repo => setDialog({ kind: 'repo-edit', repo })}
              onReorder={ids => actions.reorderRepos(ids)}
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
            defaultShellId={settings?.defaultShellId || 'cmd'}
            defaultCloseMode={settings?.defaultCloseMode || 'keep-open'}
            defaultCountdownSeconds={settings?.defaultCountdownSeconds || 10}
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
            defaultShellId={settings?.defaultShellId || 'cmd'}
            defaultCloseMode={settings?.defaultCloseMode || 'keep-open'}
            defaultCountdownSeconds={settings?.defaultCountdownSeconds || 10}
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
            defaultCloseMode={settings?.defaultCloseMode || 'keep-open'}
            defaultCountdownSeconds={settings?.defaultCountdownSeconds || 10}
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
            defaultCloseMode={settings?.defaultCloseMode || 'keep-open'}
            defaultCountdownSeconds={settings?.defaultCountdownSeconds || 10}
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

        {dialog.kind === 'confirm-run' && activeRepo ? (
          <ConfirmRunDialog
            command={dialog.command}
            repo={activeRepo}
            settings={settings}
            shells={shells}
            disabled={controlsDisabled}
            onConfirm={() => runCommand(dialog.command)}
            onClose={() => setDialog(NO_DIALOG)}
          />
        ) : null}

        <Snackbar
          open={Boolean(snack)}
          autoHideDuration={3200}
          onClose={() => setSnack(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert severity="success" variant="outlined" onClose={() => setSnack(null)} sx={{ background: '#ffffff' }}>
            {snack}
          </Alert>
        </Snackbar>
      </main>
    </ThemeProvider>
  )
}

const host = document.getElementById('app')
if (host) createRoot(host).render(<App />)
