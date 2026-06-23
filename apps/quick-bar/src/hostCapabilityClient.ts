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
  text: string
}

export type CapabilityOption = {
  value: string
  label: string
}

export type CapabilityOptionsResponse = {
  appId: string
  capabilityId: string
  response: unknown
  options: CapabilityOption[]
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

export async function queryCapabilityOptions(client: DirectClient, request: CapabilityQueryOptionsRequest): Promise<CapabilityOptionsResponse> {
  const data = await client.request<CapabilityOptionsResponse>('quickBar.capability.options', request)
  return {
    ...data,
    options: capabilityOptionsFromHostResponse(data.options),
  }
}

function capabilityOptionsFromHostResponse(options: CapabilityOption[]): CapabilityOption[] {
  if (!Array.isArray(options)) {
    throw new Error('宿主能力服务协议错误: options 必须是数组')
  }
  return options.map(optionFromHostValue)
}

function optionFromHostValue(value: unknown): CapabilityOption {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('宿主能力服务协议错误: option 必须是对象')
  }
  const option = value as Record<string, unknown>
  if (typeof option.value !== 'string' || typeof option.label !== 'string') {
    throw new Error('宿主能力服务协议错误: option 必须包含 value 和 label')
  }
  const optionValue = option.value.trim()
  const label = option.label.trim()
  if (!optionValue || !label) {
    throw new Error('宿主能力服务协议错误: option 的 value 和 label 不能为空')
  }
  return { value: optionValue, label }
}
