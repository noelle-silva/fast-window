import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { AiChatApp } from '../ui/App'
import { StandaloneWindowControls, type WindowControlActions } from '../ui/components/StandaloneWindowControls'
import type { AiChatController } from '../controller/types'
import type { AiChatToastKind, AiChatToastOptions } from '../gateway/capabilities'
import { EUCLI_STUDIO_CHAT_ROOT_ID } from '../runtime/eucliStudioGlobals'
import { createAiChatAppRuntime, type AiChatAppRuntime, type EucliBoxConfig, type EucliBoxConfigInput } from './aiChatAppHost'
import { EucliBoxConnectionOverlay } from './EucliBoxConnectionOverlay'
import { useReleaseStore } from './useReleaseStore'
import type { StudioBootstrap } from '../domain/release'

type DataDirStatus = {
  dataDir: string
  defaultDataDir: string
  configuredDataDir?: string | null
  writable: boolean
  error?: string | null
}

type BootStatus = 'booting' | 'ready' | 'error'
type ToastMessage = {
  id: number
  text: string
  kind: AiChatToastKind
}

type FwLaunchInfo = {
  launched: boolean
  standalone: boolean
  mode: string
}

function getTauriWindowSafe() {
  try {
    return getCurrentWindow()
  } catch {
    return null
  }
}

const TAURI_WINDOW = getTauriWindowSafe()

const BASE_WINDOW_CONTROL_ACTIONS: WindowControlActions = {
  minimize: () => TAURI_WINDOW?.minimize?.(),
  toggleMaximize: () => TAURI_WINDOW?.toggleMaximize?.(),
  closeToTray: () => TAURI_WINDOW ? invoke('hide_to_tray') : Promise.resolve(),
}

function startWindowDragging() {
  void TAURI_WINDOW?.startDragging?.().catch(() => {})
}

function commandLabel(command: string | null | undefined) {
  const id = String(command || '').trim()
  if (!id) return ''
  return COMMAND_LABELS[id] || `未知命令：${id}`
}

const COMMAND_LABELS: Record<string, string> = {
  'new-chat': '新建对话',
  'open-studio': '打开 eucli-studio',
  'provider-settings': '模型提供商设置',
  'open-settings': '打开设置',
}


export function App() {
  const [dataDirStatus, setDataDirStatus] = React.useState<DataDirStatus | null>(null)
  const [dataDirBusy, setDataDirBusy] = React.useState(false)
  const [bootStatus, setBootStatus] = React.useState<BootStatus>('booting')
  const [bootError, setBootError] = React.useState('')
  const [pendingCommand, setPendingCommand] = React.useState<string | null>(null)
  const [controller, setController] = React.useState<AiChatController | null>(null)
  const [toast, setToast] = React.useState<ToastMessage | null>(null)
  const [launchInfo, setLaunchInfo] = React.useState<FwLaunchInfo>({ launched: false, standalone: true, mode: 'standalone' })
  const [runtimeBootstrap, setRuntimeBootstrap] = React.useState<StudioBootstrap | null>(null)
  const runtimeRef = React.useRef<AiChatAppRuntime | null>(null)
  const runtimeVersionRef = React.useRef(0)
  const mountedRef = React.useRef(false)
  const toastSeqRef = React.useRef(0)

  const showToast = React.useCallback((message: unknown, options?: AiChatToastOptions) => {
    const text = String((message as any)?.message || message || '').trim()
    if (!text) return
    const kind = options?.kind === 'success' || options?.kind === 'error' ? options.kind : 'info'
    setToast({ id: ++toastSeqRef.current, text, kind })
  }, [])

  const release = useReleaseStore(() => runtimeRef.current, showToast)

  const refreshDataDirStatus = React.useCallback(async (isCancelled: () => boolean = () => false) => {
    const status = await invoke<DataDirStatus>('data_dir_status').catch(error => ({
      dataDir: '',
      defaultDataDir: '',
      writable: false,
      error: String((error as any)?.message || error || '读取数据目录状态失败'),
    }))
    if (!isCancelled()) setDataDirStatus(status)
    return status
  }, [])

  const connectBackend = React.useCallback(async (isCancelled: () => boolean = () => false) => {    if (isCancelled()) return null
    const runtimeVersion = runtimeVersionRef.current + 1
    runtimeVersionRef.current = runtimeVersion
    runtimeRef.current?.dispose()
    runtimeRef.current = null
    setController(null)
      setRuntimeBootstrap(null)
    if (isCancelled()) return null
    const runtime = await createAiChatAppRuntime({
      showToast,
      onBack: () => getCurrentWindow().hide(),
    })
    if (isCancelled() || runtimeVersionRef.current !== runtimeVersion) {
      runtime.dispose()
      return null
    }
    runtimeRef.current = runtime
    setController(runtime.controller)
    setRuntimeBootstrap(runtime.bootstrap)
    setBootStatus('ready')
    setBootError('')
    return runtime
  }, [showToast])

  const isAppUnmounted = React.useCallback(() => !mountedRef.current, [])

  const refreshMountedDataDirStatus = React.useCallback(() => {
    return refreshDataDirStatus(isAppUnmounted)
  }, [isAppUnmounted, refreshDataDirStatus])

  const connectMountedBackend = React.useCallback(async () => {
    return connectBackend(isAppUnmounted)
  }, [connectBackend, isAppUnmounted])

  const loadEucliBoxConfig = React.useCallback((): Promise<EucliBoxConfig> => {
    const runtime = runtimeRef.current
    return runtime ? runtime.getEucliBoxConfig() : Promise.resolve({ eucliBoxUrl: '' })
  }, [])

  const saveEucliBoxConfig = React.useCallback((config: EucliBoxConfigInput): Promise<EucliBoxConfig> => {
    const runtime = runtimeRef.current
    if (!runtime) return Promise.reject(new Error('本机后台未就绪，请稍后重试'))
    return runtime.setEucliBoxConfig(config)
  }, [])

  const disconnectEucliBox = React.useCallback(async () => {
    const runtime = runtimeRef.current
    if (!runtime) throw new Error('本机后台未就绪，请稍后重试')
    const current = await runtime.getEucliBoxConfig()
    await runtime.setEucliBoxConfig({
      eucliBoxUrl: String(current.eucliBoxUrl || ''),
      eucliBoxKey: String(current.eucliBoxKey || ''),
      eucliBoxDisconnected: true,
    })
    await connectMountedBackend()
  }, [connectMountedBackend])

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
      Promise.resolve(controller.actions.createChat?.()).catch(error => showToast(error, { kind: 'error' }))
      return
    }
    if (command === 'provider-settings' || command === 'open-settings') {
      Promise.resolve(controller.actions.openProviders?.()).catch(error => showToast(error, { kind: 'error' }))
      return
    }

    showToast(`未知命令：${command}`, { kind: 'error' })
  }, [bootStatus, controller, pendingCommand, showToast])

  React.useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | null = null
    mountedRef.current = true

    async function boot() {
      try {
        const info = await invoke<FwLaunchInfo>('fw_launch_info').catch(() => null)
        if (disposed) return
        if (!disposed && info) setLaunchInfo(normalizeLaunchInfo(info))
        const command = await invoke<string | null>('fw_initial_command').catch(() => null)
        if (disposed) return
        if (!disposed) handleCommand(command)
        const removeCommandListener = await listen<{ command?: string }>('fw-app-command', event => handleCommand(event.payload?.command))
        if (disposed) {
          removeCommandListener()
          return
        }
        unlisten = removeCommandListener
        await invoke('app_ready').catch(() => {})
        if (disposed) return
        await refreshDataDirStatus(() => disposed)
        if (disposed) return
        if (!disposed) setBootStatus('booting')
        await connectBackend(() => disposed)
      } catch (error: any) {
        if (disposed) return
        setBootStatus('error')
        setBootError(String(error?.message || error || 'eucli-studio 启动失败'))
        await refreshDataDirStatus(() => disposed)
        await invoke('app_ready').catch(() => {})
      }
    }

    boot()
    return () => {
      disposed = true
      mountedRef.current = false
      if (unlisten) unlisten()
      runtimeVersionRef.current += 1
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
    if (!mountedRef.current) return
    const previousStatus = bootStatus
    try {
      setDataDirBusy(true)
      setBootError('')
      const picked = await invoke<DataDirStatus | null>('pick_data_dir')
      if (!mountedRef.current) return
      if (!picked) {
        setBootStatus(controller ? 'ready' : previousStatus)
        return
      }
      setDataDirStatus(picked)
      await connectMountedBackend()
    } catch (error: any) {
      if (!mountedRef.current) return
      setBootStatus('error')
      setBootError(String(error?.message || error || '选择数据目录失败'))
      await refreshMountedDataDirStatus()
    } finally {
      if (mountedRef.current) setDataDirBusy(false)
    }
  }

  const trueExit = React.useCallback(async () => {
    if (!mountedRef.current) return
    try {
      await invoke('exit_app')
    } catch (error: any) {
      showToast(String(error?.message || error || '真正退出失败'), { kind: 'error' })
    }
  }, [showToast])

  const windowControlActions = React.useMemo<WindowControlActions>(() => ({
    ...BASE_WINDOW_CONTROL_ACTIONS,
    trueExit,
  }), [trueExit])

  const issue = bootError || dataDirStatus?.error || (dataDirStatus && !dataDirStatus.writable ? '数据目录不可写' : '')
  const needsEucliBoxConnection = bootStatus === 'ready' && !!runtimeBootstrap && !runtimeBootstrap.businessAvailable
  const canRenderChatApp = !!controller && bootStatus === 'ready' && !!runtimeBootstrap && !issue

  return (
    <div className="appShell">
      {canRenderChatApp ? (
        <div id={EUCLI_STUDIO_CHAT_ROOT_ID} className="chatHost">
          <AiChatApp
            controller={controller}
            bootstrap={runtimeBootstrap}
            dataDirectory={{
              status: dataDirStatus,
              busy: dataDirBusy,
              onPick: pickDataDir,
              onRefresh: refreshDataDirStatus,
            }}
            eucliBoxConnection={{ onLoad: loadEucliBoxConfig, onDisconnect: disconnectEucliBox }}
             windowControls={{
              standalone: launchInfo.standalone,
                actions: windowControlActions,
             }}
             releaseView={release.view}
             onReleaseRefresh={release.refresh}
            />
          {needsEucliBoxConnection && runtimeBootstrap ? (
            <EucliBoxConnectionOverlay
              bootstrap={runtimeBootstrap}
              issue={runtimeBootstrap.eucliBoxIssue || ''}
              standalone={launchInfo.standalone}
              windowControlActions={windowControlActions}
              onStartDragging={startWindowDragging}
              onLoadConfig={loadEucliBoxConfig}
              onSaveConfig={saveEucliBoxConfig}
              onApply={() => void connectMountedBackend()}
            />
          ) : null}
        </div>
      ) : (
        <BootFallback
          status={bootStatus}
          issue={issue || ''}
          pendingCommand={commandLabel(pendingCommand)}
          standalone={launchInfo.standalone}
          windowControlActions={windowControlActions}
          onPickDataDir={pickDataDir}
        />
      )}
      {toast ? <div className="toast" data-kind={toast.kind} role={toast.kind === 'error' ? 'alert' : 'status'} aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}>{toast.text}</div> : null}
    </div>
  )
}

function normalizeLaunchInfo(raw: FwLaunchInfo): FwLaunchInfo {
  return {
    launched: !!raw?.launched,
    standalone: raw?.standalone !== false,
    mode: String(raw?.mode || (raw?.standalone === false ? 'default' : 'standalone')),
  }
}

function BootFallback(props: {
  status: BootStatus
  issue: string
  pendingCommand: string | null
  standalone: boolean
  windowControlActions: WindowControlActions
  onPickDataDir: () => void
}) {
  const { status, issue, pendingCommand, standalone, windowControlActions, onPickDataDir } = props
  const title = issue ? 'eucli-studio 启动遇到问题' : 'eucli-studio 正在启动'
  const onTopbarPointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (target.closest('button, a, input, textarea, select, [role="button"], [data-window-controls="true"]')) return
    void TAURI_WINDOW?.startDragging?.().catch(() => {})
  }, [])

  return (
    <main className="bootFallback" role={issue ? 'alert' : 'status'} aria-live="polite">
      <header className="bootFallbackTopbar" onPointerDown={onTopbarPointerDown}>
        <div className="bootFallbackBrand">eucli-studio</div>
        {standalone ? <StandaloneWindowControls actions={windowControlActions} /> : null}
      </header>
      <section className="bootFallbackCard">
        <div className="bootFallbackTitle">{title}</div>
        <div className="bootFallbackText">{status === 'booting' ? '正在连接本机后台，请稍等。' : '请处理下面的问题后重试。'}</div>
      {pendingCommand ? (
          <div className="bootFallbackText">待处理命令：{pendingCommand}</div>
      ) : null}
      {issue ? (
          <>
            <div className="bootFallbackIssue">{issue}</div>
            <button type="button" onClick={onPickDataDir}>选择可写数据目录</button>
          </>
      ) : null}
      </section>
    </main>
  )
}
