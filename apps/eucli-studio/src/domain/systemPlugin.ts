import { normalizeCompatibilityStatus, normalizeEucliBoxCompatibility, type CompatibilityStatus, type EucliBoxCompatibility } from './release'

export type SystemPluginPlaceholderInterface = {
  id: string
  defaultName: string
  effectiveName: string
  description: string
}

export type SystemPluginSummary = {
  id: string
  sourceId: string
  name: string
  description: string
  version?: string
  eucliBoxCompatibility: EucliBoxCompatibility
  compatibility: CompatibilityStatus
  lifecycleType: string
  status: string
  statusMessage?: string
  installed?: boolean
  currentVersion?: string
  installStatus?: string
  installPhase?: string
  operationId?: string
  active?: boolean
}

export type SystemPluginDetail = SystemPluginSummary & {
  defaultConfig?: Record<string, any>
  userConfig?: Record<string, any>
  configSchema?: Record<string, any>
  placeholderInterfaces: SystemPluginPlaceholderInterface[]
}

export type SystemPluginAvailablePlaceholderInterface = {
  pluginId: string
  pluginName: string
  interfaceId: string
  interfaceDescription: string
  placeholderName: string
}

export type SystemPluginUserConfig = {
  userConfig?: Record<string, any>
  placeholderNameOverrides?: Record<string, string>
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function objectMap(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, any>) } : {}
}

export function normalizeSystemPluginSummaries(raw: unknown): SystemPluginSummary[] {
  const items = Array.isArray(raw) ? raw : []
  return items.map(normalizeSystemPluginSummary).filter(systemPluginLocatorId)
}

export function normalizeSystemPluginSummary(raw: unknown): SystemPluginSummary {
  const box = raw && typeof raw === 'object' ? (raw as any) : {}
  return {
    id: text(box.id),
    sourceId: text(box.sourceId),
    name: text(box.name),
    description: text(box.description),
    version: text(box.version),
    eucliBoxCompatibility: normalizeEucliBoxCompatibility(box.eucliBoxCompatibility),
    compatibility: normalizeCompatibilityStatus(box.compatibility),
    lifecycleType: text(box.lifecycleType),
    status: text(box.status),
    statusMessage: text(box.statusMessage),
    installed: box.installed === true,
    currentVersion: text(box.currentVersion),
    installStatus: text(box.installStatus),
    installPhase: text(box.installPhase),
    operationId: text(box.operationId),
    active: box.active === true,
  }
}

export function systemPluginLocatorId(plugin: Pick<SystemPluginSummary, 'id' | 'sourceId'>): string {
  return text(plugin.id) || text(plugin.sourceId)
}

export function normalizeSystemPluginDetail(raw: unknown): SystemPluginDetail {
  const box = raw && typeof raw === 'object' ? (raw as any) : {}
  const summary = normalizeSystemPluginSummary(box)
  const interfaces = Array.isArray(box.placeholderInterfaces) ? box.placeholderInterfaces : []
  return {
    ...summary,
    defaultConfig: objectMap(box.defaultConfig),
    userConfig: objectMap(box.userConfig),
    configSchema: objectMap(box.configSchema),
    placeholderInterfaces: interfaces.map(normalizeSystemPluginPlaceholderInterface).filter((item: SystemPluginPlaceholderInterface) => item.id),
  }
}

export function normalizeSystemPluginPlaceholderInterface(raw: unknown): SystemPluginPlaceholderInterface {
  const box = raw && typeof raw === 'object' ? (raw as any) : {}
  return { id: text(box.id), defaultName: text(box.defaultName), effectiveName: text(box.effectiveName), description: text(box.description) }
}

export function normalizeAvailableSystemPluginPlaceholderInterfaces(raw: unknown): SystemPluginAvailablePlaceholderInterface[] {
  const items = Array.isArray(raw) ? raw : []
  return items.map((rawItem) => {
    const box = rawItem && typeof rawItem === 'object' ? (rawItem as any) : {}
    return { pluginId: text(box.pluginId), pluginName: text(box.pluginName), interfaceId: text(box.interfaceId), interfaceDescription: text(box.interfaceDescription), placeholderName: text(box.placeholderName) }
  }).filter((item) => item.pluginId && item.interfaceId && item.placeholderName)
}

export function lifecycleTypeLabel(value: string) {
  if (value === 'persistent') return '长驻型'
  if (value === 'on-demand') return '按需型'
  if (value === 'cached-heartbeat') return '缓存心跳型'
  return value || '未知类型'
}

export function pluginStatusLabel(value: string) {
  if (value === 'active') return '可用'
  if (value === 'unavailable') return '不可用'
  return value || '未知状态'
}
