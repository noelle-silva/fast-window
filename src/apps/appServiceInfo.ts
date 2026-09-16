import { invoke } from '@tauri-apps/api/core'
import type { AppKind } from './types'

export interface AppServiceConnectionValue {
  available: boolean
  value: string
  reason: string
}

export interface AppServiceConnectionInfo {
  port: AppServiceConnectionValue
  key: AppServiceConnectionValue
}

export interface AppServiceStartInfo {
  executable: string
  args: string[]
  environment: Record<string, string>
}

export interface AppServiceReadyInfo {
  match: string
  timeoutSeconds: number
}

export interface AppServiceStopInfo {
  type: string
}

export interface AppServiceInfo {
  appKind: AppKind
  start?: AppServiceStartInfo
  ready?: AppServiceReadyInfo
  stop?: AppServiceStopInfo
  connection?: AppServiceConnectionInfo
}

export type AppServiceConfigField = 'port' | 'key'

export interface AppServiceConfigSaveResult {
  field: AppServiceConfigField
  value: string
}

function normalizeConnectionValue(
  value: AppServiceConnectionValue | undefined,
  missingReason: string,
): AppServiceConnectionValue {
  if (!value) return { available: false, value: '', reason: missingReason }
  if (value.available && value.value) {
    return { available: true, value: value.value, reason: '' }
  }
  return { available: false, value: '', reason: value.reason || '不可用' }
}

function normalizeAppServiceInfo(info: AppServiceInfo): AppServiceInfo {
  return {
    appKind: info.appKind === 'service' ? 'service' : 'window',
    start: info.start
      ? {
          executable: info.start.executable || '',
          args: Array.isArray(info.start.args) ? info.start.args : [],
          environment: info.start.environment ?? {},
        }
      : undefined,
    ready: info.ready
      ? { match: info.ready.match || '', timeoutSeconds: info.ready.timeoutSeconds }
      : undefined,
    stop: info.stop ? { type: info.stop.type || '' } : undefined,
    connection: info.connection
      ? {
          port: normalizeConnectionValue(info.connection.port, '声明中没有配置端口'),
          key: normalizeConnectionValue(info.connection.key, '声明中没有配置钥匙'),
        }
      : undefined,
  }
}

export async function loadAppServiceInfo(exePath: string): Promise<AppServiceInfo> {
  const info = await invoke<AppServiceInfo>('app_service_info', { exePath })
  return normalizeAppServiceInfo(info)
}

export async function saveAppServiceConfig(
  exePath: string,
  field: AppServiceConfigField,
  value: string,
): Promise<AppServiceConfigSaveResult> {
  return invoke<AppServiceConfigSaveResult>('app_service_config_save', { exePath, field, value })
}
