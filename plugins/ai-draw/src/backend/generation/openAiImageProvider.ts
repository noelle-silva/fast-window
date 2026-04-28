import { inferImageMimeFromBase64, normalizeImageBase64 } from '../../core/images'
import { parseErrorBody, parseImageDataUrlFromHttpBodyText } from '../../core/httpParse'
import { formatBytes, isHttpBaseUrl, trimSlash } from '../../core/utils'
import { resolveModel, type AiDrawProvider } from '../../core/schema'
import type { AiDrawCreateLocalEditGenerationRequest, AiDrawCreateNormalGenerationRequest, AiDrawGenerationDebugRecord } from '../../shared/domain'
import { buildMultipartFormDataBytes, type MultipartPart } from './multipartNode'

const MAX_DEBUG_TEXT_CHARS = 64 * 1024
const MAX_BODY_BYTES = 10 * 1024 * 1024

function truncateDebugText(text: string) {
  if (text.length <= MAX_DEBUG_TEXT_CHARS) return { bodyText: text }
  return { bodyText: text.slice(0, MAX_DEBUG_TEXT_CHARS), bodySummary: `已截断：原始长度 ${formatBytes(text.length)}` }
}

function extFromMime(mime: string) {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  return 'png'
}

function validateProvider(provider: AiDrawProvider) {
  const baseUrl = trimSlash(provider?.baseUrl || '')
  const apiKey = String(provider?.apiKey || '').trim()
  const model = resolveModel(provider)
  if (!isHttpBaseUrl(baseUrl)) throw new Error('Base URL 无效')
  if (!apiKey) throw new Error('API Key 为空')
  if (!model) throw new Error('模型为空')
  return { baseUrl, apiKey, model }
}

async function doFetch(input: { url: string; headers: Record<string, string>; body: string | Buffer; timeoutMs: number; signal: AbortSignal }) {
  const timeout = AbortSignal.timeout(input.timeoutMs)
  const signal = AbortSignal.any([input.signal, timeout])
  const response = await fetch(input.url, { method: 'POST', headers: input.headers, body: input.body as any, signal })
  const bodyText = await response.text()
  return { status: response.status, bodyText }
}

export async function requestOpenAiImage(input: {
  taskId: string
  mode: 'normal' | 'local-edit'
  request: AiDrawCreateNormalGenerationRequest | AiDrawCreateLocalEditGenerationRequest
  signal: AbortSignal
}): Promise<{ imageDataUrl: string; debug: AiDrawGenerationDebugRecord | null }> {
  const { provider, prompt, debugMode, requestTimeoutSec } = input.request
  const { baseUrl, apiKey, model } = validateProvider(provider)
  const timeoutMs = Math.max(5, Number(requestTimeoutSec) || 120) * 1000
  const protocol = String(provider.protocol || 'images') === 'chat' ? 'chat' : 'images'
  const size = String(provider.size || '').trim() || '1024x1024'
  let url = ''
  let body: string | Buffer = ''
  let headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` }
  let protocolKind: AiDrawGenerationDebugRecord['protocolKind'] = 'images'
  let debugBodyText = ''
  let debugSummary = ''

  if (input.mode === 'local-edit') {
    const req = input.request as AiDrawCreateLocalEditGenerationRequest
    protocolKind = 'chat'
    url = `${baseUrl}/chat/completions`
    headers = { ...headers, 'Content-Type': 'application/json' }
    const content = [
      { type: 'text', text: `请根据要求修改图片：${prompt}\n图 1 是需要修改的选区图片；后续图片为参考图。只输出一张最终图片，格式必须是 data URL 或 JSON 图片字段。` },
      { type: 'image_url', image_url: { url: req.cropImage.dataUrl } },
      ...req.refImages.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } })),
    ]
    body = JSON.stringify({ model, messages: [...(provider.chatSystemPrompt.trim() ? [{ role: 'system', content: provider.chatSystemPrompt.trim() }] : []), { role: 'user', content }], temperature: 0.2 })
    debugBodyText = body
  } else if (protocol === 'chat') {
    const req = input.request as AiDrawCreateNormalGenerationRequest
    protocolKind = 'chat'
    url = `${baseUrl}/chat/completions`
    headers = { ...headers, 'Content-Type': 'application/json' }
    const content = req.refImages.length ? [{ type: 'text', text: prompt }, ...req.refImages.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } }))] : prompt
    body = JSON.stringify({ model, messages: [...(provider.chatSystemPrompt.trim() ? [{ role: 'system', content: provider.chatSystemPrompt.trim() }] : []), { role: 'user', content }], temperature: 0.2 })
    debugBodyText = body
  } else {
    const req = input.request as AiDrawCreateNormalGenerationRequest
    if (req.refImages.length) {
      protocolKind = 'images-edits'
      url = `${baseUrl}/images/edits`
      const boundary = `fastwin-${Date.now()}-${Math.random().toString(16).slice(2)}`
      const parts: MultipartPart[] = [
        { name: 'model', value: model },
        { name: 'prompt', value: prompt },
        { name: 'size', value: size },
        { name: 'response_format', value: 'b64_json' },
      ]
      let totalImageBytes = 0
      req.refImages.forEach((image, index) => {
        const mime = inferImageMimeFromBase64(image.dataUrl) || 'image/png'
        const bytes = Buffer.from(normalizeImageBase64(image.dataUrl), 'base64')
        totalImageBytes += bytes.length
        parts.push({ name: 'image[]', filename: `ref-${index + 1}.${extFromMime(mime)}`, contentType: mime, dataBytes: bytes })
      })
      body = buildMultipartFormDataBytes(boundary, parts)
      headers = { ...headers, 'Content-Type': `multipart/form-data; boundary=${boundary}` }
      debugBodyText = `[multipart/form-data] fields=model,prompt,size,response_format; images=${req.refImages.length}; bytes=${formatBytes((body as Buffer).length)}`
      debugSummary = `图片总字节：${formatBytes(totalImageBytes)}`
    } else {
      protocolKind = 'images'
      url = `${baseUrl}/images/generations`
      headers = { ...headers, 'Content-Type': 'application/json' }
      body = JSON.stringify({ model, prompt, size, n: 1, response_format: 'b64_json' })
      debugBodyText = body
    }
  }

  const bodySize = typeof body === 'string' ? body.length : body.length
  if (bodySize > MAX_BODY_BYTES) throw new Error(`请求体过大（约 ${formatBytes(bodySize)}）`)

  const debugBase = debugMode ? {
    taskId: input.taskId,
    mode: input.mode,
    providerId: provider.id,
    providerName: provider.name,
    model,
    protocolKind,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    request: {
      method: 'POST' as const,
      url,
      headers: { ...headers, Authorization: '[REDACTED]' },
      ...truncateDebugText(debugBodyText),
      ...(debugSummary ? { bodySummary: debugSummary } : {}),
      timeoutMs,
    },
    response: { status: null, bodyText: '', errorText: '' },
    attemptCount: 1,
  } : null

  try {
    const response = await doFetch({ url, headers, body, timeoutMs, signal: input.signal })
    const dataUrl = response.status >= 200 && response.status < 300 ? parseImageDataUrlFromHttpBodyText(response.bodyText) : ''
    const debug = debugBase ? {
      ...debugBase,
      updatedAt: Date.now(),
      response: {
        status: response.status,
        ...truncateDebugText(response.bodyText),
        errorText: response.status >= 200 && response.status < 300 ? '' : parseErrorBody(response.bodyText),
      },
    } : null
    if (!dataUrl) throw Object.assign(new Error(response.status >= 200 && response.status < 300 ? '未拿到图片数据' : `HTTP ${response.status}：${parseErrorBody(response.bodyText)}`), { debug })
    return { imageDataUrl: dataUrl, debug }
  } catch (error: any) {
    if (error?.debug) throw error
    const debug = debugBase ? { ...debugBase, updatedAt: Date.now(), response: { status: null, bodyText: '', errorText: String(error?.message || error) } } : null
    throw Object.assign(new Error(String(error?.message || error || '上游请求失败')), { debug })
  }
}
