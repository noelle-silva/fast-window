import type { AppData, DraftImage, HistoryEntry, HistoryImage, HistorySettings, Provider, Space, SpaceHistorySettings, Template, TimeoutSettings } from '../types'

export const DEFAULT_LAUNCH_INFO = { launched: false, standalone: true, mode: 'standalone' } as const
export const DEFAULT_PROVIDER_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_SPACE_NAME = '默认空间'
export const DEFAULT_TEMPLATE_NAME = '默认'
export const DEFAULT_SYSTEM_PROMPT = ''
export const DEFAULT_HISTORY_LIMIT = 50
export const DEFAULT_MODEL_REQUEST_TIMEOUT_SECONDS = 600
export const APP_REQUEST_TIMEOUT_GRACE_SECONDS = 15
export const MIN_REQUEST_TIMEOUT_SECONDS = 1
export const MAX_REQUEST_TIMEOUT_SECONDS = 3600

export const DEFAULT_HISTORY_SETTINGS: HistorySettings = { enabled: true, limit: DEFAULT_HISTORY_LIMIT }
export const DEFAULT_SPACE_HISTORY_SETTINGS: SpaceHistorySettings = { override: false, enabled: true, limit: DEFAULT_HISTORY_LIMIT }
export const DEFAULT_TIMEOUT_SETTINGS: TimeoutSettings = { modelRequestTimeoutSeconds: DEFAULT_MODEL_REQUEST_TIMEOUT_SECONDS }

export function errorMessage(error: unknown, fallback: string): string {
  return String((error as { message?: string })?.message || error || fallback)
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function nowMs(): number {
  return Date.now()
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB']
  let size = value
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${index > 0 && size < 10 ? size.toFixed(1) : Math.round(size)} ${units[index]}`
}

export function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function activeProvider(data: AppData | null): Provider | null {
  return data?.settings.providers.find(provider => provider.id === data.settings.activeProviderId) || data?.settings.providers[0] || null
}

export function activeTemplate(space: Space | null): Template | null {
  return space?.templates.find(template => template.id === space.activeTemplateId) || space?.templates[0] || null
}

export function defaultModel(space: Space | null, providerId: string): string {
  return space?.defaultModelByProvider?.[providerId] || ''
}

export function modelCoordinate(providerName: string, modelId: string): string {
  return providerName && modelId ? `${providerName}/${modelId}` : ''
}

export function parseModelCoordinate(value: string): { providerName: string; modelId: string } {
  const separator = value.indexOf('/')
  if (separator <= 0) return { providerName: '', modelId: value.trim() }
  return {
    providerName: value.slice(0, separator).trim(),
    modelId: value.slice(separator + 1).trim(),
  }
}

export function createDefaultTemplate(): Template {
  return { id: createId('tpl'), name: DEFAULT_TEMPLATE_NAME, systemPrompt: DEFAULT_SYSTEM_PROMPT }
}

export function createDefaultSpace(name = DEFAULT_SPACE_NAME): Space {
  const template = createDefaultTemplate()
  const timestamp = nowMs()
  return {
    id: createId('space'),
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    defaultModelByProvider: {},
    activeTemplateId: template.id,
    templates: [template],
    history: { ...DEFAULT_SPACE_HISTORY_SETTINGS },
  }
}

export function createDefaultProvider(): Provider {
  return {
    id: createId('prov'),
    name: '新供应商',
    baseUrl: DEFAULT_PROVIDER_BASE_URL,
    apiKey: '',
    modelsCache: { items: [], fetchedAt: 0 },
  }
}

export async function fileToDraftImage(file: File): Promise<DraftImage> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(file)
  })
  return {
    id: createId('img'),
    name: file.name || 'image',
    type: file.type,
    size: file.size,
    dataUrl,
    previewUrl: URL.createObjectURL(file),
  }
}

export function normalizeHistoryLimit(value: number): number {
  return Math.max(1, Math.round(Number.isFinite(value) ? value : DEFAULT_HISTORY_LIMIT))
}

export function normalizeRequestTimeoutSeconds(value: number, fallback = DEFAULT_MODEL_REQUEST_TIMEOUT_SECONDS): number {
  const next = Math.round(Number.isFinite(value) ? value : fallback)
  return Math.min(MAX_REQUEST_TIMEOUT_SECONDS, Math.max(MIN_REQUEST_TIMEOUT_SECONDS, next))
}

export function normalizeTimeoutSettings(value?: Partial<TimeoutSettings> | null): TimeoutSettings {
  return {
    modelRequestTimeoutSeconds: normalizeRequestTimeoutSeconds(value?.modelRequestTimeoutSeconds ?? DEFAULT_TIMEOUT_SETTINGS.modelRequestTimeoutSeconds),
  }
}

export function appRequestTimeoutSeconds(value?: Partial<TimeoutSettings> | null): number {
  return normalizeTimeoutSettings(value).modelRequestTimeoutSeconds + APP_REQUEST_TIMEOUT_GRACE_SECONDS
}

export function appRequestTimeoutMs(value?: Partial<TimeoutSettings> | null): number {
  return appRequestTimeoutSeconds(value) * 1000
}

export function effectiveHistorySettings(space: Space | null, global: HistorySettings | undefined): HistorySettings {
  const base = global || DEFAULT_HISTORY_SETTINGS
  if (!space?.history?.override) return { enabled: base.enabled, limit: normalizeHistoryLimit(base.limit) }
  return {
    enabled: space.history.enabled,
    limit: normalizeHistoryLimit(space.history.limit),
  }
}

export function historyImageToDraftImage(image: HistoryImage): DraftImage {
  if (!image.dataUrl) throw new Error(`历史图片缺少可预览数据：${image.name}`)
  return {
    id: image.id || createId('hist-img'),
    name: image.name,
    type: image.type,
    size: image.size,
    dataUrl: image.dataUrl,
    previewUrl: image.dataUrl,
  }
}

export function historyEntryToDraftImages(entry: HistoryEntry): DraftImage[] {
  return entry.images.map(historyImageToDraftImage)
}

export function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('button,input,select,textarea,a,[role="button"],[data-window-controls="true"],[data-window-drag-ignore="true"]'))
}
