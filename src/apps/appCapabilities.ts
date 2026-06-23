import { invoke } from '@tauri-apps/api/core'
import type { AppLaunchOptions } from './appLauncher'
import type { AppCapabilityConfigField, AppCapabilityOption, AppCapabilityDescriptor, RegisteredApp } from './types'

export type AppCapabilityInvokeHostResponse = {
  appId: string
  capabilityId: string
  response: unknown
  text: string
}

type AppCapabilityOptionsHostResponse = {
  appId: string
  capabilityId: string
  response: unknown
  options: AppCapabilityOption[]
}

type AppCapabilityListHostResponse = {
  apps: Array<{ appId: string; capabilities: AppCapabilityDescriptor[] }>
  errors: Array<{ appId: string; message: string; canLaunch?: boolean }>
}

export type AppCapabilityLaunchPolicy = 'runningOnly' | 'allowLaunch'

type AppCapabilityListOptions = {
  launchPolicy?: AppCapabilityLaunchPolicy
}

type AppCapabilityRequest = {
  app: RegisteredApp
  capabilityId: string
  input?: unknown
  config?: Record<string, unknown>
  launchOptions?: AppLaunchOptions
}

type AppCapabilityOptionsRequest = {
  app: RegisteredApp
  capabilityId: string
  optionSource: string
  config?: Record<string, unknown>
}

export async function invokeAppCapability(request: AppCapabilityRequest): Promise<AppCapabilityInvokeHostResponse> {
  return invoke<AppCapabilityInvokeHostResponse>('app_capability_invoke', { request })
}

export async function getAppCapabilityEnvVars(): Promise<Array<[string, string]>> {
  return invoke<Array<[string, string]>>('app_capability_env_vars')
}

export async function listAppCapabilities(apps: RegisteredApp[], options: AppCapabilityListOptions = {}): Promise<AppCapabilityListHostResponse> {
  return invoke<AppCapabilityListHostResponse>('app_capability_list', {
    request: { apps, launchPolicy: options.launchPolicy ?? 'runningOnly' },
  })
}

export async function queryAppCapabilityOptions(request: AppCapabilityOptionsRequest): Promise<AppCapabilityOption[]> {
  const result = await invoke<AppCapabilityOptionsHostResponse>('app_capability_query_options', { request })
  return capabilityOptionsFromHostResponse(result.options)
}

export function appCapabilityConfig(capability: AppCapabilityDescriptor): Record<string, unknown> {
  const config = (capability as { config?: unknown }).config
  if (config === undefined) return {}
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`能力配置不合法：${capability.id} 的 config 必须是对象`)
  }
  return { ...(config as Record<string, unknown>) }
}

export type AppCapabilityConfigState = {
  config: Record<string, unknown>
  error: string
}

export function appCapabilityConfigState(capability: AppCapabilityDescriptor): AppCapabilityConfigState {
  try {
    return { config: appCapabilityConfig(capability), error: '' }
  } catch (err) {
    return { config: {}, error: String((err as Error)?.message || err || '能力配置不合法') }
  }
}

export type AppCapabilityConfigFieldsState = {
  fields: AppCapabilityConfigField[]
  error: string
}

export function appCapabilityConfigFields(capability: AppCapabilityDescriptor): AppCapabilityConfigField[] {
  const configFields = (capability as { configFields?: unknown }).configFields
  if (configFields === undefined) return []
  if (!Array.isArray(configFields)) {
    throw new Error(`能力配置字段声明不合法：${capability.id} 的 configFields 必须是数组`)
  }
  return configFields.map((field, index) => configFieldFromValue(capability, field, index))
}

export function appCapabilityConfigFieldsState(capability: AppCapabilityDescriptor): AppCapabilityConfigFieldsState {
  try {
    return { fields: appCapabilityConfigFields(capability), error: '' }
  } catch (err) {
    return { fields: [], error: String((err as Error)?.message || err || '能力配置字段声明不合法') }
  }
}

export function capabilityResultText(response: AppCapabilityInvokeHostResponse): string {
  const text = response.text.trim()
  if (text) return text
  throw new Error('能力返回结果缺少文本内容')
}

function capabilityOptionsFromHostResponse(options: AppCapabilityOption[]): AppCapabilityOption[] {
  if (!Array.isArray(options)) {
    throw new Error('能力配置选项响应格式不合法：宿主整理后的 options 必须是数组')
  }
  return options.map(optionFromValue)
}

function configFieldFromValue(capability: AppCapabilityDescriptor, value: unknown, index: number): AppCapabilityConfigField {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`能力配置字段声明不合法：${capability.id} 的第 ${index + 1} 个配置项必须是对象`)
  }
  const field = value as Record<string, unknown>
  const id = requiredConfigFieldText(capability, field, 'id', 'ID', index)
  const label = requiredConfigFieldText(capability, field, 'label', '名称', index)
  const optionSource = requiredConfigFieldText(capability, field, 'optionSource', '选项来源', index)
  return { id, label, optionSource }
}

function requiredConfigFieldText(
  capability: AppCapabilityDescriptor,
  field: Record<string, unknown>,
  key: keyof AppCapabilityConfigField,
  label: string,
  index: number,
): string {
  const value = field[key]
  if (typeof value !== 'string') {
    throw new Error(`能力配置字段声明不合法：${capability.id} 的第 ${index + 1} 个配置项缺少${label}`)
  }
  const text = value.trim()
  if (!text) {
    throw new Error(`能力配置字段声明不合法：${capability.id} 的第 ${index + 1} 个配置项${label}不能为空`)
  }
  return text
}

function optionFromValue(value: unknown): AppCapabilityOption {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('能力配置选项响应格式不合法：选项必须是对象')
  }
  const item = value as Record<string, unknown>
  if (typeof item.value !== 'string' || typeof item.label !== 'string') {
    throw new Error('能力配置选项响应格式不合法：选项缺少 value 或 label')
  }
  const optionValue = item.value.trim()
  const label = item.label.trim()
  if (!optionValue || !label) {
    throw new Error('能力配置选项响应格式不合法：选项 value 或 label 不能为空')
  }
  return { value: optionValue, label }
}
