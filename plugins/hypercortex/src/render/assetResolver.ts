import { type Api, type VaultScope, mimeFromExt, kindFromMime } from '../core'
import { readAssetAsDataUrl } from '../assetPool'

/* ------------------------------------------------------------------ */
/*  Blob URL 缓存                                                      */
/* ------------------------------------------------------------------ */

const blobUrlCache = new Map<string, string>()

function cacheKey(assetId: string, ext: string): string {
  return ext ? `${assetId}.${ext}` : assetId
}

function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',', 2)
  const header = parts[0] || ''
  const b64 = parts[1] || ''
  const mime = (header.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream'
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

async function getBlobUrl(api: Api, scope: VaultScope, assetId: string, ext: string): Promise<string> {
  const key = cacheKey(assetId, ext)
  const cached = blobUrlCache.get(key)
  if (cached) return cached
  const dataUrl = await readAssetAsDataUrl(api, scope, assetId, ext)
  const blob = dataUrlToBlob(dataUrl)
  const url = URL.createObjectURL(blob)
  blobUrlCache.set(key, url)
  return url
}

/* ------------------------------------------------------------------ */
/*  DOM 元素构建                                                        */
/* ------------------------------------------------------------------ */

function buildImageElement(blobUrl: string, name: string, width?: number): HTMLElement {
  const img = document.createElement('img')
  img.src = blobUrl
  img.alt = name
  if (width && width > 0) {
    img.style.width = `${width}px`
    img.style.maxWidth = '100%'
  } else {
    img.style.maxWidth = '100%'
  }
  img.style.height = 'auto'
  img.style.borderRadius = '6px'
  img.style.cursor = 'zoom-in'
  return img
}

function buildAudioElement(blobUrl: string, name: string): HTMLElement {
  const wrap = document.createElement('div')
  wrap.style.display = 'flex'
  wrap.style.flexDirection = 'column'
  wrap.style.gap = '4px'
  wrap.style.padding = '8px 0'

  if (name) {
    const label = document.createElement('span')
    label.textContent = `🎵 ${name}`
    label.style.fontSize = '13px'
    label.style.color = '#555'
    wrap.appendChild(label)
  }

  const audio = document.createElement('audio')
  audio.src = blobUrl
  audio.controls = true
  audio.style.width = '100%'
  audio.style.maxWidth = '480px'
  wrap.appendChild(audio)
  return wrap
}

function buildVideoElement(blobUrl: string, name: string, width?: number): HTMLElement {
  const wrap = document.createElement('div')
  wrap.style.display = 'flex'
  wrap.style.flexDirection = 'column'
  wrap.style.gap = '4px'
  wrap.style.padding = '8px 0'

  if (name) {
    const label = document.createElement('span')
    label.textContent = `🎬 ${name}`
    label.style.fontSize = '13px'
    label.style.color = '#555'
    wrap.appendChild(label)
  }

  const video = document.createElement('video')
  video.src = blobUrl
  video.controls = true
  if (width && width > 0) {
    video.style.width = `${width}px`
    video.style.maxWidth = '100%'
  } else {
    video.style.maxWidth = '100%'
  }
  video.style.borderRadius = '6px'
  wrap.appendChild(video)
  return wrap
}

function buildDocumentElement(name: string): HTMLElement {
  const wrap = document.createElement('span')
  wrap.style.display = 'inline-flex'
  wrap.style.alignItems = 'center'
  wrap.style.gap = '4px'
  wrap.style.padding = '4px 10px'
  wrap.style.borderRadius = '6px'
  wrap.style.background = 'rgba(0,0,0,.05)'
  wrap.style.fontSize = '13px'
  wrap.style.color = '#333'
  wrap.textContent = `📄 ${name}`
  return wrap
}

function buildErrorElement(name: string): HTMLElement {
  const wrap = document.createElement('span')
  wrap.style.display = 'inline-flex'
  wrap.style.alignItems = 'center'
  wrap.style.gap = '4px'
  wrap.style.padding = '4px 10px'
  wrap.style.borderRadius = '6px'
  wrap.style.background = 'rgba(211,47,47,.08)'
  wrap.style.fontSize = '12px'
  wrap.style.color = '#c62828'
  wrap.textContent = `⚠️ ${name}（加载失败）`
  return wrap
}

/* ------------------------------------------------------------------ */
/*  主入口：解析 DOM 中所有 .hc-asset 占位元素                              */
/* ------------------------------------------------------------------ */

export async function resolveAssetsInElement(
  el: HTMLElement,
  api: Api,
  scope: VaultScope,
): Promise<void> {
  const placeholders = Array.from(el.querySelectorAll('.hc-asset[data-asset-id]'))
  if (!placeholders.length) return

  const tasks = placeholders.map(async (span) => {
    if (!(span instanceof HTMLElement)) return
    const assetId = span.getAttribute('data-asset-id') || ''
    const ext = span.getAttribute('data-asset-ext') || ''
    const name = span.getAttribute('data-asset-name') || ''
    const widthAttr = span.getAttribute('data-asset-width')
    const width = widthAttr ? Number(widthAttr) : undefined
    if (!assetId) return

    const mime = mimeFromExt(ext)
    const kind = mime ? kindFromMime(mime) : 'document'

    try {
      if (kind === 'document') {
        span.replaceWith(buildDocumentElement(name))
        return
      }

      const blobUrl = await getBlobUrl(api, scope, assetId, ext)

      let element: HTMLElement
      if (kind === 'image') {
        element = buildImageElement(blobUrl, name, width)
      } else if (kind === 'audio') {
        element = buildAudioElement(blobUrl, name)
      } else if (kind === 'video') {
        element = buildVideoElement(blobUrl, name, width)
      } else {
        element = buildDocumentElement(name)
      }
      span.replaceWith(element)
    } catch {
      span.replaceWith(buildErrorElement(name))
    }
  })

  await Promise.all(tasks)
}
