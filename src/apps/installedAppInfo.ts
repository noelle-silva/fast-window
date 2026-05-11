import { invoke } from '@tauri-apps/api/core'
import type { AppDisplayMode, InstalledAppInfo } from './types'

function normalizeDisplayMode(value: string): AppDisplayMode {
  return value === 'window' || value === 'top' ? value : 'default'
}

export async function inspectInstalledApp(path: string): Promise<InstalledAppInfo> {
  const info = await invoke<InstalledAppInfo>('inspect_installed_app', { exePath: path })
  return normalizeInstalledAppInfo(info)
}

export async function inspectLocalStoreApp(path: string): Promise<InstalledAppInfo | null> {
  const info = await invoke<InstalledAppInfo | null>('inspect_local_store_app', { exePath: path })
  return info ? normalizeInstalledAppInfo(info) : null
}

function normalizeInstalledAppInfo(info: InstalledAppInfo): InstalledAppInfo {
  return {
    ...info,
    displayMode: normalizeDisplayMode(info.displayMode),
    commands: Array.isArray(info.commands) ? info.commands : [],
  }
}
