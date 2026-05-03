import { invoke } from '@tauri-apps/api/core'
import type { RegisteredApp, RegisteredAppUpdatePatch } from './types'

export async function loadRegistry(): Promise<RegisteredApp[]> {
  const raw = await invoke<unknown>('app_registry_load').catch(() => [])
  if (!Array.isArray(raw)) return []
  return raw as RegisteredApp[]
}

export async function saveRegistry(apps: RegisteredApp[]): Promise<void> {
  await invoke('app_registry_save', { apps })
}

export async function addApp(app: RegisteredApp): Promise<void> {
  await invoke('app_registry_add', { appRecord: app })
}

export async function removeApp(id: string): Promise<void> {
  await invoke('app_registry_remove', { appId: id })
}

export async function updateApp(id: string, patch: RegisteredAppUpdatePatch): Promise<void> {
  await invoke('app_registry_update', { appId: id, patch })
}
