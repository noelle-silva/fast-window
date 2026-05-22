import { invoke } from '@tauri-apps/api/core'
import type { AppStopResult } from './types'

export type AppReleaseBump = 'patch' | 'minor' | 'major'

export type AppDevTerminalCommandRequest =
  | { type: 'stageDev' }
  | { type: 'release'; bump: AppReleaseBump }

export type AppDevTerminalCommandResult = {
  appId: string
  stopResult: AppStopResult
  command: string[]
}

export async function stageV5AppDev(appId: string): Promise<AppDevTerminalCommandResult> {
  return runAppDevTerminalCommand(appId, { type: 'stageDev' })
}

export async function releaseV5App(appId: string, bump: AppReleaseBump): Promise<AppDevTerminalCommandResult> {
  return runAppDevTerminalCommand(appId, { type: 'release', bump })
}

export async function runAppDevTerminalCommand(
  appId: string,
  request: AppDevTerminalCommandRequest,
): Promise<AppDevTerminalCommandResult> {
  return invoke<AppDevTerminalCommandResult>('app_dev_run_terminal_command', { appId, request })
}
