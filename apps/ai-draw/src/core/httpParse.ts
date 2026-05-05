import { normalizeImageDataUrlOrBase64, toImageDataUrlFromBase64 } from './images'

export function stripCodeFences(s: any) {
  const raw = String(s || '').trim()
  if (!raw) return ''
  if (raw.startsWith('```')) {
    const i = raw.indexOf('\n')
    const j = raw.lastIndexOf('```')
    if (i >= 0 && j > i) return raw.slice(i + 1, j).trim()
  }
  return raw
}

export function extractImageFromText(text: any) {
  const s = String(text || '').trim()
  if (!s) return ''

  const dataUrlMatch = s.match(/data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\r\n]+/i)
  if (dataUrlMatch && dataUrlMatch[0]) return normalizeImageDataUrlOrBase64(dataUrlMatch[0])

  const maybeJson = stripCodeFences(s)
  try {
    const j = JSON.parse(maybeJson)
    const dataUrl = j?.data_url || j?.dataUrl || j?.image || j?.image_data_url
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) return normalizeImageDataUrlOrBase64(dataUrl)
    const b64 = j?.b64_png || j?.b64_json || j?.b64 || j?.base64 || j?.image_base64 || j?.png_base64
    if (typeof b64 === 'string' && b64.trim()) return toImageDataUrlFromBase64(b64)
  } catch {}

  if (/^[A-Za-z0-9+/=\r\n]+$/.test(s) && s.length > 200) {
    return toImageDataUrlFromBase64(s)
  }

  return ''
}

export function parseImageDataUrlFromHttpBodyText(bodyText: any) {
  const raw = String(bodyText || '')
  try {
    const j = JSON.parse(raw)
    const item = (Array.isArray(j?.data) && j.data[0]) || (Array.isArray(j?.images) && j.images[0]) || null
    const b64 = item?.b64_json || item?.b64 || item?.base64 || ''
    const direct = typeof item?.data_url === 'string' ? item.data_url : typeof item?.dataUrl === 'string' ? item.dataUrl : ''
    const content = (Array.isArray(j?.choices) && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || ''
    return (
      (direct && normalizeImageDataUrlOrBase64(direct)) ||
      (b64 && toImageDataUrlFromBase64(b64)) ||
      extractImageFromText(content) ||
      extractImageFromText(raw)
    )
  } catch {
    return extractImageFromText(raw)
  }
}

export function parseErrorBody(body: any) {
  try {
    const j = JSON.parse(String(body || ''))
    const msg = j?.error?.message || j?.message || ''
    if (msg) return String(msg)
  } catch {}
  return String(body || '')
}

