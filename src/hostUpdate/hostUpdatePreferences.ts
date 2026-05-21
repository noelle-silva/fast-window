import { invoke } from '@tauri-apps/api/core'
import { APP_STORAGE_ID, HOST_AUTO_UPDATE_CHECK_ENABLED_KEY } from '../constants'

export const HOST_AUTO_UPDATE_CHECK_SETTINGS_CHANGED_EVENT = 'fast-window:host-auto-update-check-settings-changed'

export async function getHostAutoUpdateCheckEnabled(): Promise<boolean> {
  const saved = await invoke<unknown | null>('storage_get', {
    pluginId: APP_STORAGE_ID,
    key: HOST_AUTO_UPDATE_CHECK_ENABLED_KEY,
  })
  return saved === true
}

export async function setHostAutoUpdateCheckEnabled(enabled: boolean): Promise<boolean> {
  await invoke('storage_set', {
    pluginId: APP_STORAGE_ID,
    key: HOST_AUTO_UPDATE_CHECK_ENABLED_KEY,
    value: enabled,
  })
  window.dispatchEvent(new CustomEvent(HOST_AUTO_UPDATE_CHECK_SETTINGS_CHANGED_EVENT, { detail: { enabled } }))
  return enabled
}
