import { invoke } from '@tauri-apps/api/core'
import { loadRegistry } from '../apps/appRegistry'
import type { RegisteredApp } from '../apps/types'

/// 与 Rust 侧 `DEV_CONSOLE_WINDOW_LABEL` 对齐：窗口身份以 label 为准。
export const DEV_CONSOLE_WINDOW_LABEL = 'dev-console'

export type HostAppAction =
  | 'stop'
  | 'forceStop'
  | 'start'
  | 'restart'
  | 'status'
  | 'list'
  | 'folder'
  | 'info'
  | 'capability'
  | 'env'

export type AppStopMethod = 'alreadyStopped' | 'graceful' | 'killed' | 'terminated'

export type AppLaunchOutcome = 'activated' | 'skippedColdStart'

type ResultBase = {
  appId: string
  name: string
  durationMs: number
}

/// 应用运行时声明的能力：宿主只透传，窗口只展示。
export type AppCapabilityDeclaration = {
  id: string
  title: string
  description?: string
}

/// 宿主注入的环境变量：token 类变量到达前端时已被脱敏。
export type HostEnvVar = {
  name: string
  value: string
}

export type HostActionResult =
  | (ResultBase & { state: 'stopped'; method: AppStopMethod })
  | (ResultBase & { state: 'started'; launch: AppLaunchOutcome })
  | (ResultBase & { state: 'restarted'; method: AppStopMethod })
  | (ResultBase & {
      state: 'status'
      running: boolean
      pid?: number
      phase?: string
      startedAt?: number
    })
  | (ResultBase & { state: 'folder'; path: string })
  | (ResultBase & { state: 'info'; path: string; version?: string; appKind?: string })
  | (ResultBase & { state: 'capability'; items: AppCapabilityDeclaration[] })
  | (ResultBase & { state: 'env'; vars: HostEnvVar[] })
  | (ResultBase & { state: 'failed'; message: string })

export type HostActionResponse = {
  ok: true
  action: HostAppAction
  results: HostActionResult[]
}

export type HostActionCandidate = {
  appId: string
  name: string
}

export type HostActionError = {
  ok: false
  code: string
  message: string
  candidates?: HostActionCandidate[]
}

export type DevConsoleServerStatus = {
  port: number
  listening: boolean
  error?: string
}

export function runHostCommand(command: string): Promise<HostActionResponse> {
  return invoke<HostActionResponse>('host_action_run_command', { command })
}

export function openDevConsole(): Promise<void> {
  return invoke<void>('dev_console_open')
}

export function loadDevConsoleServerStatus(): Promise<DevConsoleServerStatus | null> {
  return invoke<DevConsoleServerStatus | null>('dev_console_server_status')
}

export function loadAppCatalog(): Promise<RegisteredApp[]> {
  return loadRegistry()
}

export function isHostActionError(value: unknown): value is HostActionError {
  return (
    typeof value === 'object'
    && value !== null
    && 'code' in value
    && 'message' in value
  )
}

export function normalizeHostActionError(value: unknown): HostActionError {
  if (isHostActionError(value)) return value

  const message = typeof value === 'string'
    ? value
    : (value as { message?: unknown } | null)?.message
  return {
    ok: false,
    code: 'UNEXPECTED_ERROR',
    message: typeof message === 'string' && message.trim() ? message : '执行失败',
  }
}
