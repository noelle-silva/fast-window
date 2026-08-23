import { invoke } from '@tauri-apps/api/core'

export type Bookmark = {
  id: string
  title: string
  url: string
  iconUrl: string
  iconDataUrl: string
  iconPath: string
  createdAt: number
  updatedAt: number
}

export type HttpResp = { status: number; headers: Record<string, string>; body: string }
export type HttpRespBase64 = { status: number; headers: Record<string, string>; bodyBase64: string }

export function uid(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function normalizeUrl(raw: string): string {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return ''
  return `https://${s}`
}

export function isHttpUrl(url: string): boolean {
  const u = String(url || '').trim().toLowerCase()
  return u.startsWith('http://') || u.startsWith('https://')
}

export function toOrigin(url: string): string {
  try {
    return new URL(String(url || '')).origin
  } catch {
    return ''
  }
}

export async function httpRequest(req: {
  method: string
  url: string
  headers?: Record<string, string>
  timeoutMs?: number
}): Promise<HttpResp> {
  return invoke<HttpResp>('http_request', { req })
}

export async function httpRequestBase64(req: {
  method: string
  url: string
  headers?: Record<string, string>
  timeoutMs?: number
}): Promise<HttpRespBase64> {
  return invoke<HttpRespBase64>('http_request_base64', { req })
}

function scoreIconLink(rel: string, sizes: string, href: string): number {
  const r = String(rel || '').toLowerCase()
  const h = String(href || '').toLowerCase()
  if (!h) return -1
  let base = 0
  if (r.includes('apple-touch-icon')) base += 40
  if (r.includes('icon')) base += 30
  if (r.includes('mask-icon')) base += 10
  const s = String(sizes || '').toLowerCase()
  if (s.includes('any')) base += 5
  const m = s.match(/(\d+)\s*x\s*(\d+)/)
  if (m) {
    const w = Number(m[1] || 0)
    const h2 = Number(m[2] || 0)
    if (w > 0 && h2 > 0) base += Math.min(100, Math.floor((w * h2) / 256))
  }
  return base
}

function getHeader(headers: Record<string, string> | undefined, name: string): string {
  if (!headers || typeof headers !== 'object') return ''
  const target = String(name || '').toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (String(k || '').toLowerCase() === target) return String(v || '')
  }
  return ''
}

function guessImageMimeByUrl(url: string): string {
  const u = String(url || '').toLowerCase()
  if (u.includes('.svg')) return 'image/svg+xml'
  if (u.includes('.webp')) return 'image/webp'
  if (u.includes('.jpg') || u.includes('.jpeg')) return 'image/jpeg'
  if (u.includes('.png')) return 'image/png'
  if (u.includes('.ico')) return 'image/x-icon'
  return 'image/png'
}

function mimeFromContentTypeOrUrl(contentType: string, url: string): string {
  const ct = String(contentType || '').toLowerCase()
  if (ct.includes('image/')) {
    const pure = ct.split(';')[0].trim()
    return pure || guessImageMimeByUrl(url)
  }
  return guessImageMimeByUrl(url)
}

export async function rasterizeToPngDataUrl(srcDataUrl: string, size: number): Promise<string | null> {
  const s = typeof size === 'number' && Number.isFinite(size) ? Math.max(16, Math.min(256, Math.floor(size))) : 64
  const src = String(srcDataUrl || '').trim()
  if (!src.startsWith('data:')) return null

  const img = await new Promise<HTMLImageElement | null>(resolve => {
    const el = new window.Image()
    el.decoding = 'async'
    el.onload = () => resolve(el)
    el.onerror = () => resolve(null)
    el.src = src
  })
  if (!img) return null
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  if (!iw || !ih) return null

  const canvas = document.createElement('canvas')
  canvas.width = s
  canvas.height = s
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.clearRect(0, 0, s, s)
  const scale = Math.min(s / iw, s / ih)
  const dw = Math.max(1, Math.floor(iw * scale))
  const dh = Math.max(1, Math.floor(ih * scale))
  const dx = Math.floor((s - dw) / 2)
  const dy = Math.floor((s - dh) / 2)
  ctx.drawImage(img, dx, dy, dw, dh)
  return canvas.toDataURL('image/png')
}

export async function saveIconPngToFile(pngDataUrl: string): Promise<string | null> {
  const src = String(pngDataUrl || '').trim()
  if (!src.startsWith('data:image/')) return null
  return invoke<string>('bookmark_icon_write', { dataUrlOrBase64: src })
}

export async function downloadIconDataUrl(iconUrl: string): Promise<string | null> {
  const raw = String(iconUrl || '').trim()
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (lower.startsWith('data:image/')) return raw
  if (!/^https?:\/\//i.test(raw)) return null

  const resp = await httpRequestBase64({
    method: 'GET',
    url: raw,
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) webview/0.1',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
    },
    timeoutMs: 12000,
  }).catch(err => {
    console.warn('[webview] 图标下载失败:', err)
    return null
  })
  if (!resp) return null

  const status = Number(resp.status || 0)
  if (!(status >= 200 && status < 400)) return null
  const b64 = String(resp.bodyBase64 || '')
  if (!b64) return null

  const approxBytes = Math.floor((b64.length * 3) / 4)
  if (approxBytes > 512 * 1024) return null

  const mime = mimeFromContentTypeOrUrl(getHeader(resp.headers, 'content-type'), raw)
  return `data:${mime};base64,${b64}`
}

export async function sniffIconUrl(pageUrl: string): Promise<string | null> {
  const url = normalizeUrl(pageUrl)
  if (!url) return null

  const origin = toOrigin(url)
  const fallback = origin ? `${origin}/favicon.ico` : null

  const resp = await httpRequest({
    method: 'GET',
    url,
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) webview/0.1',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
    },
    timeoutMs: 12000,
  }).catch(err => {
    console.warn('[webview] 图标嗅探失败:', err)
    return null
  })
  if (!resp) return fallback

  const html = String(resp.body || '')
  if (!html) return fallback

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const baseHref = doc.querySelector('base[href]')?.getAttribute('href') || ''
  const base = baseHref ? String(new URL(baseHref, url)) : url

  const links = Array.from(doc.querySelectorAll('link[rel][href]'))
  const candidates: { rel: string; href: string; sizes: string; score: number }[] = []
  for (const el of links) {
    const rel = el.getAttribute('rel') || ''
    const href = el.getAttribute('href') || ''
    if (!href) continue
    const r = rel.toLowerCase()
    if (!r.includes('icon')) continue
    const sizes = el.getAttribute('sizes') || ''
    candidates.push({ rel, href, sizes, score: scoreIconLink(rel, sizes, href) })
  }

  candidates.sort((a, b) => b.score - a.score)
  const top = candidates[0]
  if (top && top.href) {
    try {
      const resolved = new URL(top.href, base).toString()
      if (/^https?:\/\//i.test(resolved) || resolved.toLowerCase().startsWith('data:image/')) return resolved
    } catch {
      return fallback
    }
  }

  return fallback
}

export function showToast(message: string, durationMs = 1800) {
  let el = document.getElementById('__webviewToast') as (HTMLDivElement & { __t?: number }) | null
  if (!el) {
    el = document.createElement('div')
    el.id = '__webviewToast'
    el.style.position = 'fixed'
    el.style.left = '50%'
    el.style.bottom = '24px'
    el.style.transform = 'translateX(-50%)'
    el.style.maxWidth = 'min(520px, calc(100vw - 24px))'
    el.style.padding = '10px 12px'
    el.style.borderRadius = '10px'
    el.style.background = 'rgba(0,0,0,0.82)'
    el.style.color = '#fff'
    el.style.fontSize = '12px'
    el.style.lineHeight = '1.4'
    el.style.boxShadow = '0 6px 18px rgba(0,0,0,0.28)'
    el.style.zIndex = '999999'
    el.style.opacity = '0'
    el.style.transition = 'opacity 160ms ease'
    el.style.pointerEvents = 'none'
    document.body.appendChild(el)
  }
  const text = String(message ?? '').trim()
  if (!text) return
  el.textContent = text
  el.style.opacity = '1'
  window.clearTimeout(el.__t)
  el.__t = window.setTimeout(() => {
    if (!el) return
    el.style.opacity = '0'
  }, durationMs)
}
