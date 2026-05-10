import { invoke } from '@tauri-apps/api/core'

export interface AppStoreInstallResult {
  appId: string
  version: string
  path: string
}

export async function getAppsDir(): Promise<string> {
  return invoke<string>('get_apps_dir')
}

export async function pickAppInstallDir(): Promise<string | null> {
  return invoke<string | null>('pick_app_install_dir')
}

export async function appStoreInstall(opts: {
  url: string
  expectedSha256: string
  expectedId: string
  expectedVersion: string
  installDir: string
}): Promise<AppStoreInstallResult> {
  const req = normalizeInstallRequest(opts)
  return invoke<AppStoreInstallResult>('app_store_install', { req })
}

export async function appStoreUpdate(opts: {
  url: string
  expectedSha256: string
  expectedId: string
  expectedVersion: string
}): Promise<AppStoreInstallResult> {
  const req = normalizeUpdateRequest(opts)
  return invoke<AppStoreInstallResult>('app_store_update', { req })
}

function normalizeInstallRequest(opts: {
  url: string
  expectedSha256: string
  expectedId: string
  expectedVersion: string
  installDir: string
}) {
  const req = {
    url: text(opts.url, 'url'),
    expectedSha256: text(opts.expectedSha256, 'expectedSha256'),
    expectedId: text(opts.expectedId, 'expectedId'),
    expectedVersion: text(opts.expectedVersion, 'expectedVersion'),
    installDir: text(opts.installDir, 'installDir'),
  }
  return req
}

function normalizeUpdateRequest(opts: {
  url: string
  expectedSha256: string
  expectedId: string
  expectedVersion: string
}) {
  return {
    url: text(opts.url, 'url'),
    expectedSha256: text(opts.expectedSha256, 'expectedSha256'),
    expectedId: text(opts.expectedId, 'expectedId'),
    expectedVersion: text(opts.expectedVersion, 'expectedVersion'),
  }
}

function text(value: string, field: string): string {
  const s = String(value || '').trim()
  if (!s) throw new Error(`${field} 不能为空`)
  return s
}
