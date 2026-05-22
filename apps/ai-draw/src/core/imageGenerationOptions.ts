export type AiDrawImageQuality = 'auto' | 'low' | 'medium' | 'high' | 'standard' | 'hd'
export type AiDrawImageOutputFormat = 'png' | 'jpeg' | 'webp'
export type AiDrawImageBackground = 'auto' | 'transparent' | 'opaque'
export type AiDrawImageModeration = 'auto' | 'low'
export type AiDrawImageStyle = 'vivid' | 'natural'
export type AiDrawImageInputFidelity = 'low' | 'high'

export type AiDrawImageGenerationOptions = {
  size: string
  quality: AiDrawImageQuality
  outputFormat: AiDrawImageOutputFormat
  outputCompression: number | null
  background: AiDrawImageBackground
  moderation: AiDrawImageModeration
  style: AiDrawImageStyle | null
  inputFidelity: AiDrawImageInputFidelity | null
}

export type AiDrawImageProtocol = 'images' | 'chat'
export type AiDrawImageRequestKind = 'generations' | 'edits'
export type AiDrawImageModelFamily = 'gpt-image-1' | 'gpt-image-1-mini' | 'gpt-image-2' | 'dall-e-2' | 'dall-e-3' | 'unknown'

export const DEFAULT_IMAGE_GENERATION_OPTIONS: AiDrawImageGenerationOptions = {
  size: '1024x1024',
  quality: 'auto',
  outputFormat: 'png',
  outputCompression: null,
  background: 'auto',
  moderation: 'auto',
  style: null,
  inputFidelity: null,
}

export const IMAGE_SIZE_OPTIONS = ['auto', '1024x1024', '1024x1536', '1536x1024', '1792x1024', '1024x1792', '512x512', '256x256'] as const
export const IMAGE_QUALITY_OPTIONS: AiDrawImageQuality[] = ['auto', 'low', 'medium', 'high', 'standard', 'hd']
export const IMAGE_OUTPUT_FORMAT_OPTIONS: AiDrawImageOutputFormat[] = ['png', 'jpeg', 'webp']
export const IMAGE_BACKGROUND_OPTIONS: AiDrawImageBackground[] = ['auto', 'transparent', 'opaque']
export const IMAGE_MODERATION_OPTIONS: AiDrawImageModeration[] = ['auto', 'low']
export const IMAGE_STYLE_OPTIONS: AiDrawImageStyle[] = ['vivid', 'natural']
export const IMAGE_INPUT_FIDELITY_OPTIONS: AiDrawImageInputFidelity[] = ['low', 'high']

const GPT_STANDARD_SIZES = new Set(['auto', '1024x1024', '1024x1536', '1536x1024'])
const DALLE_2_SIZES = new Set(['256x256', '512x512', '1024x1024'])
const DALLE_3_SIZES = new Set(['1024x1024', '1792x1024', '1024x1792'])

export function detectImageModelFamily(model: any): AiDrawImageModelFamily {
  const name = String(model || '').trim().toLowerCase()
  if (!name) return 'unknown'
  if (name === 'dall-e-2') return 'dall-e-2'
  if (name === 'dall-e-3') return 'dall-e-3'
  if (name === 'gpt-image-1-mini') return 'gpt-image-1-mini'
  if (name === 'gpt-image-2' || name.startsWith('gpt-image-2-')) return 'gpt-image-2'
  if (name === 'gpt-image-1' || name === 'gpt-image-1.5' || name.startsWith('gpt-image-1-') || name === 'chatgpt-image-latest') return 'gpt-image-1'
  return 'unknown'
}

export function isGptImageFamily(family: AiDrawImageModelFamily) {
  return family === 'gpt-image-1' || family === 'gpt-image-1-mini' || family === 'gpt-image-2' || family === 'unknown'
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
    style: normalizeNullableChoice(value.style, IMAGE_STYLE_OPTIONS),
    inputFidelity: normalizeNullableChoice(value.inputFidelity ?? value.input_fidelity, IMAGE_INPUT_FIDELITY_OPTIONS),
  }
}

export function patchImageGenerationOptions(current: AiDrawImageGenerationOptions, patch: Partial<AiDrawImageGenerationOptions>) {
  return normalizeImageGenerationOptions({ ...current, ...patch })
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
  if (!isSupportedSize(options.size, family)) errors.push(`当前模型不支持尺寸 ${options.size}`)
  if (!isSupportedQuality(options.quality, family, requestKind)) errors.push(`当前模型不支持画质 ${options.quality}`)
  if (!isGptImageFamily(family)) {
    if (options.outputFormat !== DEFAULT_IMAGE_GENERATION_OPTIONS.outputFormat) errors.push('DALL·E 模型不支持 output_format')
    if (options.outputCompression !== null) errors.push('DALL·E 模型不支持 output_compression')
    if (options.background !== DEFAULT_IMAGE_GENERATION_OPTIONS.background) errors.push('DALL·E 模型不支持 background')
    if (options.moderation !== DEFAULT_IMAGE_GENERATION_OPTIONS.moderation) errors.push('DALL·E 模型不支持 moderation')
    if (options.inputFidelity) errors.push('DALL·E 模型不支持 input_fidelity')
  }
  if (family !== 'dall-e-3' && options.style) errors.push('style 仅支持 DALL·E 3')
  if (requestKind === 'edits' && family === 'dall-e-3') errors.push('DALL·E 3 不支持 /images/edits 参考图编辑')
  if (requestKind === 'edits' && options.moderation !== DEFAULT_IMAGE_GENERATION_OPTIONS.moderation) errors.push('moderation 仅在普通生成时可用')
  if (requestKind === 'generations' && options.inputFidelity) errors.push('input_fidelity 仅在参考图编辑时可用')
  if (requestKind === 'edits' && options.inputFidelity && family === 'gpt-image-1-mini') errors.push('gpt-image-1-mini 不支持 input_fidelity')
  if (family === 'gpt-image-2' && options.background === 'transparent') errors.push('gpt-image-2 不支持透明背景')
  if (options.background === 'transparent' && options.outputFormat === 'jpeg') errors.push('透明背景需要 png 或 webp 输出格式')
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
  const family = detectImageModelFamily(input.model)
  const fields: Record<string, string | number> = { size: options.size }
  if (isGptImageFamily(family)) {
    fields.quality = options.quality
    fields.output_format = options.outputFormat
    fields.background = options.background
    if (requestKind === 'generations') fields.moderation = options.moderation
    if (options.outputCompression !== null) fields.output_compression = options.outputCompression
    if (requestKind === 'edits' && options.inputFidelity) fields.input_fidelity = options.inputFidelity
  } else if (family === 'dall-e-3' && options.quality !== 'auto') {
    fields.quality = options.quality
  }
  if (family === 'dall-e-3' && options.style) fields.style = options.style
  return fields
}

export function getImageGenerationOptionAvailability(input: { model: string; protocol: AiDrawImageProtocol; hasRefImages: boolean }) {
  const family = detectImageModelFamily(input.model)
  const requestKind: AiDrawImageRequestKind = input.hasRefImages ? 'edits' : 'generations'
  const chat = input.protocol === 'chat'
  return {
    size: !chat,
    quality: !chat,
    outputFormat: !chat && isGptImageFamily(family),
    outputCompression: !chat && isGptImageFamily(family),
    background: !chat && isGptImageFamily(family),
    moderation: !chat && requestKind === 'generations' && isGptImageFamily(family),
    style: !chat && family === 'dall-e-3' && requestKind === 'generations',
    inputFidelity: !chat && requestKind === 'edits' && isGptImageFamily(family) && family !== 'gpt-image-1-mini',
  }
}

export function supportedImageSizes(model: string) {
  const family = detectImageModelFamily(model)
  if (family === 'dall-e-2') return ['256x256', '512x512', '1024x1024']
  if (family === 'dall-e-3') return ['1024x1024', '1792x1024', '1024x1792']
  return IMAGE_SIZE_OPTIONS.slice(0, 4)
}

export function supportedImageQualities(model: string, requestKind: AiDrawImageRequestKind): AiDrawImageQuality[] {
  const family = detectImageModelFamily(model)
  if (isGptImageFamily(family)) return ['auto', 'low', 'medium', 'high']
  if (family === 'dall-e-3' && requestKind === 'generations') return ['auto', 'standard', 'hd']
  if (family === 'dall-e-2') return ['auto', 'standard']
  return ['auto']
}

function normalizeStringChoice<T extends string>(raw: any, allowed: readonly T[], fallback: T): T {
  const value = String(raw || '').trim() as T
  return allowed.includes(value) ? value : fallback
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

function normalizeOutputCompression(raw: any, outputFormat: AiDrawImageOutputFormat) {
  if (outputFormat === 'png') return null
  if (raw === null || raw === undefined || String(raw).trim() === '') return null
  const value = Number(raw)
  if (!Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, Math.floor(value)))
}

function isSupportedQuality(quality: AiDrawImageQuality, family: AiDrawImageModelFamily, requestKind: AiDrawImageRequestKind) {
  if (isGptImageFamily(family)) return quality === 'auto' || quality === 'low' || quality === 'medium' || quality === 'high'
  if (family === 'dall-e-3') return requestKind === 'generations' && (quality === 'auto' || quality === 'standard' || quality === 'hd')
  if (family === 'dall-e-2') return quality === 'auto' || quality === 'standard'
  return false
}

function isSupportedSize(size: string, family: AiDrawImageModelFamily) {
  if (family === 'gpt-image-2') return isGptImage2Size(size)
  if (family === 'dall-e-2') return DALLE_2_SIZES.has(size)
  if (family === 'dall-e-3') return DALLE_3_SIZES.has(size)
  return GPT_STANDARD_SIZES.has(size)
}

function isGptImage2Size(size: string) {
  if (GPT_STANDARD_SIZES.has(size)) return true
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
