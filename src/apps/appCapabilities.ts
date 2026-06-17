import { invoke } from '@tauri-apps/api/core'
import type { AppLaunchOptions } from './appLauncher'
import type { AppCapabilityConfigField, AppCapabilityOption, AppCapabilityDescriptor, RegisteredApp } from './types'

type AppCapabilityHostResponse = {
  appId: string
  capabilityId: string
  response: unknown
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

export async function invokeAppCapability(request: AppCapabilityRequest): Promise<AppCapabilityHostResponse> {
  return invoke<AppCapabilityHostResponse>('app_capability_invoke', { request })
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
  const result = await invoke<AppCapabilityHostResponse>('app_capability_query_options', { request })
  return capabilityOptionsFromResponse(result.response)
}

export function commandCapabilityConfig(command: AppCapabilityDescriptor): Record<string, unknown> {
  const config = (command as { config?: unknown }).config
  if (config === undefined) return {}
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`能力配置不合法：${command.id} 的 config 必须是对象`)
  }
  return { ...(config as Record<string, unknown>) }
}

export type CommandCapabilityConfigState = {
  config: Record<string, unknown>
  error: string
}

export function commandCapabilityConfigState(command: AppCapabilityDescriptor): CommandCapabilityConfigState {
  try {
    return { config: commandCapabilityConfig(command), error: '' }
  } catch (err) {
    return { config: {}, error: String((err as Error)?.message || err || '能力配置不合法') }
  }
}

export type CommandCapabilityConfigFieldsState = {
  fields: AppCapabilityConfigField[]
  error: string
}

export function commandCapabilityConfigFields(command: AppCapabilityDescriptor): AppCapabilityConfigField[] {
  const configFields = (command as { configFields?: unknown }).configFields
  if (configFields === undefined) return []
  if (!Array.isArray(configFields)) {
    throw new Error(`能力配置字段声明不合法：${command.id} 的 configFields 必须是数组`)
  }
  return configFields.map((field, index) => configFieldFromValue(command, field, index))
}

export function commandCapabilityConfigFieldsState(command: AppCapabilityDescriptor): CommandCapabilityConfigFieldsState {
  try {
    return { fields: commandCapabilityConfigFields(command), error: '' }
  } catch (err) {
    return { fields: [], error: String((err as Error)?.message || err || '能力配置字段声明不合法') }
  }
}

export function capabilityResultText(response: unknown): string {
  if (typeof response === 'string') {
    const text = response.trim()
    if (text) return text
    throw new Error('能力返回结果缺少文本内容')
  }
  if (!response || typeof response !== 'object') throw new Error('能力返回结果缺少文本内容')
  const value = response as Record<string, unknown>
  const text = value.result
  if (typeof text === 'string' && text.trim()) return text.trim()
  throw new Error('能力返回结果缺少文本内容')
}

function capabilityOptionsFromResponse(response: unknown): AppCapabilityOption[] {
  if (Array.isArray(response)) return response.map(optionFromValue)
  if (!response || typeof response !== 'object') {
    throw new Error('能力配置选项响应格式不合法：响应必须是数组或包含 options 数组的对象')
  }
  const value = response as Record<string, unknown>
  if (!Array.isArray(value.options)) {
    throw new Error('能力配置选项响应格式不合法：缺少 options 数组')
  }
  return value.options.map(optionFromValue)
}

function configFieldFromValue(command: AppCapabilityDescriptor, value: unknown, index: number): AppCapabilityConfigField {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`能力配置字段声明不合法：${command.id} 的第 ${index + 1} 个配置项必须是对象`)
  }
  const field = value as Record<string, unknown>
  const id = requiredConfigFieldText(command, field, 'id', 'ID', index)
  const label = requiredConfigFieldText(command, field, 'label', '名称', index)
  const optionSource = requiredConfigFieldText(command, field, 'optionSource', '选项来源', index)
  return { id, label, optionSource }
}

function requiredConfigFieldText(
  command: AppCapabilityDescriptor,
  field: Record<string, unknown>,
  key: keyof AppCapabilityConfigField,
  label: string,
  index: number,
): string {
  const value = field[key]
  if (typeof value !== 'string') {
    throw new Error(`能力配置字段声明不合法：${command.id} 的第 ${index + 1} 个配置项缺少${label}`)
  }
  const text = value.trim()
  if (!text) {
    throw new Error(`能力配置字段声明不合法：${command.id} 的第 ${index + 1} 个配置项${label}不能为空`)
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
