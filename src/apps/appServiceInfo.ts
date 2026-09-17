import { invoke } from '@tauri-apps/api/core'

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

export interface DesktopAppServiceInfo {
  appKind: 'desktop-app'
}

export interface ServiceAppServiceInfo {
  appKind: 'service-app'
  start?: AppServiceStartInfo
  ready?: AppServiceReadyInfo
  stop?: AppServiceStopInfo
  connection: AppServiceConnectionInfo
}

export type AppServiceInfo = DesktopAppServiceInfo | ServiceAppServiceInfo

export type AppServiceConfigField = 'port' | 'key'

export interface AppServiceConfigSaveResult {
  field: AppServiceConfigField
  value: string
}

const PROFILE_PENDING_REASON = '尚未生成：启动服务后可用'

function normalizeConnectionValue(
  value: AppServiceConnectionValue | undefined,
): AppServiceConnectionValue {
  if (!value) return { available: false, value: '', reason: PROFILE_PENDING_REASON }
  if (value.available && value.value) {
    return { available: true, value: value.value, reason: '' }
  }
  return { available: false, value: '', reason: value.reason || PROFILE_PENDING_REASON }
}

function normalizeAppServiceInfo(info: AppServiceInfo): AppServiceInfo {
  if (info.appKind !== 'service-app') return { appKind: 'desktop-app' }
  return {
    appKind: 'service-app',
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
    connection: {
      port: normalizeConnectionValue(info.connection?.port),
      key: normalizeConnectionValue(info.connection?.key),
    },
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
