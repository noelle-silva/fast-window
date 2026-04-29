import { invoke } from '@tauri-apps/api/core'
import type { AppActivationAction, AppStatus, RegisteredApp } from './types'

function buildLaunchArgs(app: RegisteredApp, action?: AppActivationAction, command?: string): string[] {
  const args: string[] = ['--fw-launched']

  args.push('--fw-action', action ?? 'toggle')

  args.push('--fw-mode', app.displayMode ?? 'default')

  if (command) {
    args.push('--fw-command', command)
  }

  if (app.windowWidth != null) args.push('--fw-width', String(app.windowWidth))
  if (app.windowHeight != null) args.push('--fw-height', String(app.windowHeight))
  if (app.windowX != null) args.push('--fw-x', String(app.windowX))
  if (app.windowY != null) args.push('--fw-y', String(app.windowY))

  return args
}

export async function launchApp(app: RegisteredApp, action?: AppActivationAction, command?: string): Promise<void> {
  const args = buildLaunchArgs(app, action, command)
  await invoke('app_launch', { appId: app.id, exePath: app.path, args })
}

export async function stopApp(id: string): Promise<void> {
  await invoke('app_stop', { appId: id })
}

export async function getAppStatus(id: string): Promise<AppStatus> {
  return invoke<AppStatus>('app_status', { appId: id })
}

export async function getAppStatuses(ids: string[]): Promise<Record<string, AppStatus>> {
  return invoke<Record<string, AppStatus>>('app_status_many', { appIds: ids })
}
