import type { DirectClient } from './types'

export type HostCapabilityConfigField = {
  id: string
  label: string
  optionSource: string
  required?: boolean
}

export type HostCapabilityItem = {
  app: Record<string, unknown>
  appId: string
  appName?: string
  capabilityId: string
  title?: string
  icon?: string
  hotkey?: string
  description?: string
  configFields?: HostCapabilityConfigField[]
}

export type CapabilityInvokeRequest = {
  app: Record<string, unknown>
  capabilityId: string
  input: string
  config?: Record<string, unknown>
}

export type CapabilityQueryOptionsRequest = {
  app: Record<string, unknown>
  capabilityId: string
  optionSource: string
  config?: Record<string, unknown>
}

export type CapabilityInvokeResponse = {
  appId: string
  capabilityId: string
  response: unknown
}

export type HostCapabilityError = {
  appId: string
  appName?: string
  message: string
  canLaunch?: boolean
}

export type HostCapabilityLaunchPolicy = 'runningOnly' | 'allowLaunch'

export type HostCapabilityListRequest = {
  appId?: string
  launchPolicy?: HostCapabilityLaunchPolicy
}

export type HostCapabilityListResponse = {
  capabilities: HostCapabilityItem[]
  errors: HostCapabilityError[]
}

export async function fetchCapabilities(client: DirectClient, request: HostCapabilityListRequest = {}): Promise<HostCapabilityListResponse> {
  const data = await client.request<HostCapabilityListResponse>('quickBar.capability.list', request)
  if (!Array.isArray(data.capabilities)) {
    throw new Error('宿主能力服务协议错误: capabilities 必须是数组')
  }
  return {
    capabilities: data.capabilities,
    errors: Array.isArray(data.errors) ? data.errors : [],
  }
}

export async function invokeCapability(client: DirectClient, request: CapabilityInvokeRequest): Promise<CapabilityInvokeResponse> {
  return client.request<CapabilityInvokeResponse>('quickBar.capability.invoke', request)
}

export async function queryCapabilityOptions(client: DirectClient, request: CapabilityQueryOptionsRequest): Promise<CapabilityInvokeResponse> {
  return client.request<CapabilityInvokeResponse>('quickBar.capability.options', request)
}
