export type AiDrawImageQuality = 'auto' | 'low' | 'medium' | 'high'
export type AiDrawImageOutputFormat = 'png' | 'jpeg' | 'webp'
export type AiDrawImageBackground = 'auto' | 'opaque'
export type AiDrawImageModeration = 'auto' | 'low'
export type AiDrawImageInputFidelity = 'low' | 'high'

export type AiDrawImageGenerationOptions = {
  size: string
  quality: AiDrawImageQuality
  outputFormat: AiDrawImageOutputFormat
  outputCompression: number | null
  background: AiDrawImageBackground
  moderation: AiDrawImageModeration
  inputFidelity: AiDrawImageInputFidelity | null
}

export type AiDrawImageProtocol = 'images' | 'chat'
export type AiDrawImageRequestKind = 'generations' | 'edits'
export type AiDrawImageModelFamily = 'gpt-image-2' | 'unsupported'

export const DEFAULT_IMAGE_GENERATION_OPTIONS: AiDrawImageGenerationOptions = {
  size: '1024x1024',
  quality: 'auto',
  outputFormat: 'png',
  outputCompression: null,
  background: 'auto',
  moderation: 'auto',
  inputFidelity: null,
}

export const IMAGE_SIZE_OPTIONS = ['auto', '1024x1024', '1024x1536', '1536x1024'] as const
export const IMAGE_QUALITY_OPTIONS: AiDrawImageQuality[] = ['auto', 'low', 'medium', 'high']
export const IMAGE_OUTPUT_FORMAT_OPTIONS: AiDrawImageOutputFormat[] = ['png', 'jpeg', 'webp']
export const IMAGE_BACKGROUND_OPTIONS: AiDrawImageBackground[] = ['auto', 'opaque']
export const IMAGE_MODERATION_OPTIONS: AiDrawImageModeration[] = ['auto', 'low']
export const IMAGE_INPUT_FIDELITY_OPTIONS: AiDrawImageInputFidelity[] = ['low', 'high']

const GPT_IMAGE_2_STANDARD_SIZES = new Set(IMAGE_SIZE_OPTIONS)

export function detectImageModelFamily(model: any): AiDrawImageModelFamily {
  const name = String(model || '').trim().toLowerCase()
  if (!name) return 'unsupported'
  if (name === 'gpt-image-2' || name.startsWith('gpt-image-2-')) return 'gpt-image-2'
  return 'unsupported'
}

export function normalizeImageGenerationOptions(raw: any): AiDrawImageGenerationOptions {
  const value = raw && typeof raw === 'object' ? raw : {}
  const outputFormat = normalizeStringChoice(value.outputFormat ?? value.output_format, IMAGE_OUTPUT_FORMAT_OPTIONS, DEFAULT_IMAGE_GENERATION_OPTIONS.outputFormat)
  return {
    size: normalizeImageSize(value.size, DEFAULT_IMAGE_GENERATION_OPTIONS.size),
    quality: normalizeStringChoice(value.quality, IMAGE_QUALITY_OPTIONS, DEFAULT_IMAGE_GENERATION_OPTIONS.quality),
    outputFormat,
    outputCompression: normalizeOutputCompression(value.outputCompression ?? value.output_compression, outputFormat),
    background: normalizeStringChoice(value.background, IMAGE_BACKGROUND_OPTIONS, DEFAULT_IMAGE_GENERATION_OPTIONS.background),
    moderation: normalizeStringChoice(value.moderation, IMAGE_MODERATION_OPTIONS, DEFAULT_IMAGE_GENERATION_OPTIONS.moderation),
    inputFidelity: normalizeNullableChoice(value.inputFidelity ?? value.input_fidelity, IMAGE_INPUT_FIDELITY_OPTIONS),
  }
}

export function patchImageGenerationOptions(current: AiDrawImageGenerationOptions, patch: Partial<AiDrawImageGenerationOptions>) {
  return normalizeImageGenerationOptions({ ...current, ...patch })
}

export function validateRawImageGenerationOptions(input: {
  raw: any
  model: string
  protocol: AiDrawImageProtocol
  requestKind: AiDrawImageRequestKind
}) {
  if (input.protocol === 'chat') return []

  const value = input.raw && typeof input.raw === 'object' ? input.raw : {}
  const errors = validateRawImageOptionChoices(value)
  if (!errors.length) {
    errors.push(...validateImageGenerationOptions({
      options: normalizeImageGenerationOptions(value),
      model: input.model,
      protocol: input.protocol,
      requestKind: input.requestKind,
    }))
  }
  return errors
}

export function validateImageGenerationOptions(input: {
  options: AiDrawImageGenerationOptions
  model: string
  protocol: AiDrawImageProtocol
  requestKind: AiDrawImageRequestKind
}) {
  const { options, model, protocol, requestKind } = input
  const errors: string[] = []
  if (protocol === 'chat') return errors

  const family = detectImageModelFamily(model)
  if (family !== 'gpt-image-2') return ['当前 Image API 参数仅支持 gpt-image-2']
  if (!isSupportedSize(options.size, family)) errors.push(`当前模型不支持尺寸 ${options.size}`)
  if (!isSupportedQuality(options.quality, family, requestKind)) errors.push(`当前模型不支持画质 ${options.quality}`)
  if (requestKind === 'edits' && options.moderation !== DEFAULT_IMAGE_GENERATION_OPTIONS.moderation) errors.push('moderation 仅在普通生成时可用')
  if (requestKind === 'generations' && options.inputFidelity) errors.push('input_fidelity 仅在参考图编辑时可用')
  if (options.outputCompression !== null && options.outputFormat === 'png') errors.push('output_compression 仅对 jpeg/webp 生效')
  return errors
}

export function buildOpenAiImageOptionFields(input: {
  options: AiDrawImageGenerationOptions
  model: string
  protocol: AiDrawImageProtocol
  requestKind: AiDrawImageRequestKind
}) {
  const errors = validateImageGenerationOptions(input)
  if (errors.length) throw new Error(errors.join('\n'))
  if (input.protocol === 'chat') return {}

  const { options, requestKind } = input
  const fields: Record<string, string | number> = { size: options.size }
  fields.quality = options.quality
  fields.output_format = options.outputFormat
  fields.background = options.background
  if (requestKind === 'generations') fields.moderation = options.moderation
  if (options.outputCompression !== null) fields.output_compression = options.outputCompression
  if (requestKind === 'edits' && options.inputFidelity) fields.input_fidelity = options.inputFidelity
  return fields
}

export function getImageGenerationOptionAvailability(input: { model: string; protocol: AiDrawImageProtocol; hasRefImages: boolean }) {
  const family = detectImageModelFamily(input.model)
  const requestKind: AiDrawImageRequestKind = input.hasRefImages ? 'edits' : 'generations'
  const chat = input.protocol === 'chat'
  return {
    size: !chat && family === 'gpt-image-2',
    quality: !chat && family === 'gpt-image-2',
    outputFormat: !chat && family === 'gpt-image-2',
    outputCompression: !chat && family === 'gpt-image-2',
    background: !chat && family === 'gpt-image-2',
    moderation: !chat && requestKind === 'generations' && family === 'gpt-image-2',
    inputFidelity: !chat && requestKind === 'edits' && family === 'gpt-image-2',
  }
}

export function supportedImageSizes(model: string) {
  const family = detectImageModelFamily(model)
  return family === 'gpt-image-2' ? IMAGE_SIZE_OPTIONS.slice() : []
}

export function supportedImageQualities(model: string, requestKind: AiDrawImageRequestKind): AiDrawImageQuality[] {
  const family = detectImageModelFamily(model)
  void requestKind
  return family === 'gpt-image-2' ? IMAGE_QUALITY_OPTIONS.slice() : []
}

function normalizeStringChoice<T extends string>(raw: any, allowed: readonly T[], fallback: T): T {
  const value = String(raw || '').trim() as T
  return allowed.includes(value) ? value : fallback
}

function validateRawImageOptionChoices(value: Record<string, any>) {
  const errors: string[] = []
  validateRawStringChoice(errors, value.size, 'size', isImageSizeSyntax, '尺寸格式必须是 auto 或 宽x高')
  validateRawStringChoice(errors, value.quality, 'quality', (item) => IMAGE_QUALITY_OPTIONS.includes(item as AiDrawImageQuality), '画质仅支持 auto/low/medium/high')
  validateRawStringChoice(errors, value.outputFormat ?? value.output_format, 'output_format', (item) => IMAGE_OUTPUT_FORMAT_OPTIONS.includes(item as AiDrawImageOutputFormat), '输出格式仅支持 png/jpeg/webp')
  validateRawStringChoice(errors, value.background, 'background', (item) => IMAGE_BACKGROUND_OPTIONS.includes(item as AiDrawImageBackground), '背景仅支持 auto/opaque')
  validateRawStringChoice(errors, value.moderation, 'moderation', (item) => IMAGE_MODERATION_OPTIONS.includes(item as AiDrawImageModeration), '审核仅支持 auto/low')
  validateRawStringChoice(errors, value.inputFidelity ?? value.input_fidelity, 'input_fidelity', (item) => IMAGE_INPUT_FIDELITY_OPTIONS.includes(item as AiDrawImageInputFidelity), '参考保真仅支持 low/high')
  if (hasText(value.style)) errors.push('style 已移除，gpt-image-2 不支持旧版风格字段')
  const compression = value.outputCompression ?? value.output_compression
  if (compression !== null && compression !== undefined && String(compression).trim() !== '') {
    const numberValue = Number(compression)
    if (!Number.isFinite(numberValue) || numberValue < 0 || numberValue > 100) errors.push('output_compression 必须是 0 到 100 的数字')
    const rawFormat = String(value.outputFormat ?? value.output_format ?? DEFAULT_IMAGE_GENERATION_OPTIONS.outputFormat).trim()
    if (rawFormat === 'png') errors.push('output_compression 仅对 jpeg/webp 生效')
  }
  return errors
}

function validateRawStringChoice(errors: string[], raw: any, field: string, isValid: (item: string) => boolean, message: string) {
  if (!hasText(raw)) return
  const value = String(raw).trim()
  if (!isValid(value)) errors.push(`${field}: ${message}`)
}

function hasText(value: any) {
  return value !== null && value !== undefined && String(value).trim() !== ''
}

function normalizeNullableChoice<T extends string>(raw: any, allowed: readonly T[]): T | null {
  const value = String(raw || '').trim() as T
  return allowed.includes(value) ? value : null
}

function normalizeImageSize(raw: any, fallback: string) {
  const value = String(raw || '').trim()
  if (!value) return fallback
  if (value === 'auto') return value
  return /^\d{2,5}x\d{2,5}$/.test(value) ? value : fallback
}

function isImageSizeSyntax(value: string) {
  return value === 'auto' || /^\d{2,5}x\d{2,5}$/.test(value)
}

function normalizeOutputCompression(raw: any, outputFormat: AiDrawImageOutputFormat) {
  if (outputFormat === 'png') return null
  if (raw === null || raw === undefined || String(raw).trim() === '') return null
  const value = Number(raw)
  if (!Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, Math.floor(value)))
}

function isSupportedQuality(quality: AiDrawImageQuality, family: AiDrawImageModelFamily, requestKind: AiDrawImageRequestKind) {
  void requestKind
  return family === 'gpt-image-2' && IMAGE_QUALITY_OPTIONS.includes(quality)
}

function isSupportedSize(size: string, family: AiDrawImageModelFamily) {
  return family === 'gpt-image-2' && isGptImage2Size(size)
}

function isGptImage2Size(size: string) {
  if (GPT_IMAGE_2_STANDARD_SIZES.has(size as any)) return true
  const match = size.match(/^(\d{2,5})x(\d{2,5})$/)
  if (!match) return false
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isInteger(width) || !Number.isInteger(height)) return false
  if (width % 16 !== 0 || height % 16 !== 0) return false
  if (width > 3840 || height > 2160) return false
  const ratio = width / height
  return ratio >= 1 / 3 && ratio <= 3
}
