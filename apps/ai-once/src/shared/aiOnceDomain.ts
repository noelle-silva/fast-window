import type { AppData, DraftImage, Provider, Space, Template } from '../types'

export const DEFAULT_LAUNCH_INFO = { launched: false, standalone: true, mode: 'standalone' } as const
export const DEFAULT_PROVIDER_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_SPACE_NAME = '默认空间'
export const DEFAULT_TEMPLATE_NAME = '默认'
export const DEFAULT_SYSTEM_PROMPT = ''

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

export function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('button,input,select,textarea,a,[role="button"],[data-window-controls="true"],[data-window-drag-ignore="true"]'))
}
