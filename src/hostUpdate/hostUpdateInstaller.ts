import { invoke } from '@tauri-apps/api/core'

export interface HostUpdateDownloadResult {
  version: string
  path: string
  sizeBytes: number
}

export async function downloadHostUpdateMsi(opts: {
  version: string
  url: string
  expectedSha256: string
}): Promise<HostUpdateDownloadResult> {
  return invoke<HostUpdateDownloadResult>('host_update_download_msi', {
    req: {
      version: text(opts.version, 'version'),
      url: text(opts.url, 'url'),
      expectedSha256: text(opts.expectedSha256, 'expectedSha256'),
    },
  })
}

export async function installHostUpdateMsi(opts: {
  version: string
  path: string
  expectedSha256: string
}): Promise<void> {
  await invoke('host_update_install_msi', {
    req: {
      version: text(opts.version, 'version'),
      path: text(opts.path, 'path'),
      expectedSha256: text(opts.expectedSha256, 'expectedSha256'),
    },
  })
}

function text(value: string, field: string): string {
  const s = String(value || '').trim()
  if (!s) throw new Error(`${field} 不能为空`)
  return s
}
