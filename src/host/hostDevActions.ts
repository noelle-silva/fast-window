import { invoke } from '@tauri-apps/api/core'

export type HostReleaseBump = 'patch' | 'minor' | 'major'

export type HostPublishVersionRequest =
  | { type: 'bump'; bump: HostReleaseBump }
  | { type: 'version'; version: string }

export type HostDevTerminalCommandRequest = {
  type: 'publish'
  version: HostPublishVersionRequest
}

export type HostDevTerminalCommandResult = {
  command: string[]
}

export function publishHostRelease(version: HostPublishVersionRequest): Promise<HostDevTerminalCommandResult> {
  return invoke<HostDevTerminalCommandResult>('host_dev_run_terminal_command', {
    request: { type: 'publish', version } satisfies HostDevTerminalCommandRequest,
  })
}
