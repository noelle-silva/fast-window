import { normalizeImageBase64 } from './images'

export function encodeUtf8Bytes(input: any) {
  const s = String(input ?? '')
  try {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s)
  } catch {}
  const encoded = unescape(encodeURIComponent(s))
  const out = new Uint8Array(encoded.length)
  for (let i = 0; i < encoded.length; i++) out[i] = encoded.charCodeAt(i)
  return out
}

export function base64ToBytes(input: any) {
  const b64 = normalizeImageBase64(input)
  if (!b64) return new Uint8Array(0)
  if (typeof atob !== 'function') throw new Error('atob 不可用，无法处理二进制请求体')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToBase64(bytes: Uint8Array) {
  if (!bytes || !bytes.length) return ''
  if (typeof btoa !== 'function') throw new Error('btoa 不可用，无法处理二进制请求体')
  try {
    if (typeof TextDecoder !== 'undefined') {
      const bin = new TextDecoder('latin1').decode(bytes)
      return btoa(bin)
    }
  } catch {}

  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk)
    bin += String.fromCharCode.apply(null, Array.from(sub) as any)
  }
  return btoa(bin)
}

export function concatBytes(chunks: Array<Uint8Array | null | undefined>) {
  const list = Array.isArray(chunks) ? chunks.filter((x): x is Uint8Array => !!x && x.length > 0) : []
  const total = list.reduce((sum, x) => sum + x.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of list) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

export function inferExtFromMime(mime: any) {
  const m = String(mime || '').toLowerCase()
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  return 'png'
}

export function buildMultipartFormDataBytes(boundary: any, parts: any[]) {
  const b = String(boundary || '').trim()
  if (!b) throw new Error('boundary is required')
  const items = Array.isArray(parts) ? parts.filter((x) => x && typeof x === 'object') : []
  const chunks: Uint8Array[] = []
  for (const p of items) {
    const name = String((p as any).name || '').trim()
    if (!name) continue
    const isFile = !!((p as any).filename && (p as any).contentType && (p as any).dataBytes)
    const disp = isFile
      ? `Content-Disposition: form-data; name="${name}"; filename="${String((p as any).filename)}"\r\n`
      : `Content-Disposition: form-data; name="${name}"\r\n`
    const type = isFile ? `Content-Type: ${String((p as any).contentType)}\r\n` : ''
    const head = `--${b}\r\n${disp}${type}\r\n`
    chunks.push(encodeUtf8Bytes(head))
    if (isFile) chunks.push((p as any).dataBytes)
    else chunks.push(encodeUtf8Bytes(String((p as any).value ?? '')))
    chunks.push(encodeUtf8Bytes('\r\n'))
  }
  chunks.push(encodeUtf8Bytes(`--${b}--\r\n`))
  return concatBytes(chunks)
}

