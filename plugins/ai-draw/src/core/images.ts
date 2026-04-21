export function normalizeImageBase64(s: any) {
  const raw = String(s || '').trim()
  if (!raw) return ''
  let v = raw
  const dataUrlPrefix = v.match(/^data:image\/[a-z0-9+.-]+;base64,/i)
  if (dataUrlPrefix && dataUrlPrefix[0]) v = v.slice(dataUrlPrefix[0].length)
  v = v.replace(/\s+/g, '')
  v = v.replace(/-/g, '+').replace(/_/g, '/')
  const mod = v.length % 4
  if (mod === 1) return ''
  if (mod === 2) v += '=='
  else if (mod === 3) v += '='
  return v
}

export function inferImageMimeFromBase64(b64: any) {
  const s = normalizeImageBase64(b64)
  if (!s) return ''
  const head = s.slice(0, 16)
  if (head.startsWith('iVBORw0KGgo')) return 'image/png'
  if (head.startsWith('/9j/')) return 'image/jpeg'
  if (head.startsWith('UklGR')) return 'image/webp'
  if (head.startsWith('R0lGOD')) return 'image/gif'
  return 'image/png'
}

export function toImageDataUrlFromBase64(b64: any) {
  const s = normalizeImageBase64(b64)
  if (!s) return ''
  const mime = inferImageMimeFromBase64(s) || 'image/png'
  return `data:${mime};base64,${s}`
}

export function normalizeImageDataUrlOrBase64(input: any) {
  const s = String(input || '').trim()
  if (!s) return ''
  if (s.startsWith('http://') || s.startsWith('https://')) return s
  if (s.startsWith('data:image/')) {
    const i = s.indexOf('base64,')
    if (i < 0) return s
    const prefix = s.slice(0, i + 'base64,'.length)
    const rest = s.slice(i + 'base64,'.length)
    const norm = normalizeImageBase64(rest)
    return norm ? prefix + norm : s
  }
  return toImageDataUrlFromBase64(s)
}

