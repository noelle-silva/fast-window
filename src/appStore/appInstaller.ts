import { invoke } from '@tauri-apps/api/core'

export async function getAppsDir(): Promise<string> {
  return invoke<string>('get_apps_dir')
}

export async function pickAppInstallDir(): Promise<string | null> {
  return invoke<string | null>('pick_app_install_dir')
}
