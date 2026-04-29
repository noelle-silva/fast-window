import { invoke } from '@tauri-apps/api/core'
import type { RegisteredApp } from './types'

const REGISTRY_PLUGIN_ID = '__app'
const REGISTRY_KEY = 'registeredApps'

export async function loadRegistry(): Promise<RegisteredApp[]> {
  const raw = await invoke<unknown | null>('storage_get', { pluginId: REGISTRY_PLUGIN_ID, key: REGISTRY_KEY }).catch(() => null)
  if (!Array.isArray(raw)) return []
  return raw as RegisteredApp[]
}

export async function saveRegistry(apps: RegisteredApp[]): Promise<void> {
  await invoke('storage_set', { pluginId: REGISTRY_PLUGIN_ID, key: REGISTRY_KEY, value: apps })
}

export async function addApp(app: RegisteredApp): Promise<void> {
  const registry = await loadRegistry()
  const idx = registry.findIndex(a => a.id === app.id)
  if (idx >= 0) {
    registry[idx] = app
  } else {
    registry.push(app)
  }
  await saveRegistry(registry)
}

export async function removeApp(id: string): Promise<void> {
  const registry = await loadRegistry()
  await saveRegistry(registry.filter(a => a.id !== id))
}

export async function updateApp(id: string, patch: Partial<RegisteredApp>): Promise<void> {
  const registry = await loadRegistry()
  const idx = registry.findIndex(a => a.id === id)
  if (idx >= 0) {
    registry[idx] = { ...registry[idx], ...patch }
    await saveRegistry(registry)
  }
}
