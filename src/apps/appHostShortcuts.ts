import { invoke } from '@tauri-apps/api/core'
import type { RegisteredApp, RegisteredAppShortcut } from './types'

export type AppHostShortcutLaunchPolicy = 'runningOnly' | 'allowLaunch'

type AppHostShortcutListOptions = {
  launchPolicy?: AppHostShortcutLaunchPolicy
}

type AppHostShortcutListHostResponse = {
  apps: Array<{ appId: string; hostShortcuts: RegisteredAppShortcut[] }>
  errors: Array<{ appId: string; message: string; canLaunch?: boolean }>
}

export async function listAppHostShortcuts(
  apps: RegisteredApp[],
  options: AppHostShortcutListOptions = {},
): Promise<AppHostShortcutListHostResponse> {
  return invoke<AppHostShortcutListHostResponse>('app_host_shortcut_list', {
    request: { apps, launchPolicy: options.launchPolicy ?? 'runningOnly' },
  })
}
