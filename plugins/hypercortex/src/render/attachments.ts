import { type Api, type VaultScope, kindFromMime, mimeFromExt } from '../core'
import { ensureAssetsIndex } from '../assetStore'
import { pickAssetDisplayName } from '../assetDisplayName'
import { getAssetBlobUrl } from '../assetBlobUrl'
import { buildVideoPlayer } from '../videoPlayer'

type AssetRef = { assetId: string; ext: string; name: string; width?: number; refText: string }

function parseRef(refText: string, displayName: string, width?: number): AssetRef | null {
  const ref = String(refText || '').trim()
  if (!ref) return null
  const dotIdx = ref.lastIndexOf('.')
  const assetId = dotIdx > 0 ? ref.slice(0, dotIdx) : ref
  const ext = dotIdx > 0 ? ref.slice(dotIdx + 1).toLowerCase() : ''
  const name0 = String(displayName || '').trim()
  const name = pickAssetDisplayName({ explicitName: name0, ext })
  return { assetId, ext, name, width, refText: ref }
}

function buildChip(text: string, variant: 'loading' | 'error' | 'doc') {
  const el = document.createElement('span')
  el.className = `hc-asset-chip hc-asset-chip--${variant}`
  el.textContent = text
  return el
}

function buildImage(blobUrl: string, name: string, width?: number) {
  const img = document.createElement('img')
  img.src = blobUrl
  img.alt = name
  img.loading = 'lazy'
  img.decoding = 'async'
  img.style.display = 'block'
  img.style.maxWidth = '100%'
  img.style.height = 'auto'
  img.style.margin = '0 auto'
  img.style.borderRadius = '8px'
  img.style.cursor = 'zoom-in'
  if (width && width > 0) img.style.width = `${width}px`
  return img
}

function buildAudio(blobUrl: string) {
  const audio = document.createElement('audio')
  audio.src = blobUrl
  audio.controls = true
  audio.preload = 'metadata'
  audio.style.display = 'block'
  audio.style.width = 'min(520px, 100%)'
  audio.style.margin = '0 auto'
  return audio
}

function wrapBlock(name: string, body: HTMLElement) {
  const wrap = document.createElement('div')
  wrap.className = 'hc-asset-block'

  if (name) {
    const title = document.createElement('div')
    title.className = 'hc-asset-title'
    title.textContent = name
    wrap.appendChild(title)
  }

  wrap.appendChild(body)
  return wrap
}

export function setAssetPlaceholderState(el: HTMLElement, state: 'loading' | 'error', name: string) {
  el.setAttribute('data-hc-asset-state', state)
  el.textContent = ''
  el.appendChild(buildChip(state === 'loading' ? `📎 ${name}（加载中…）` : `⚠️ ${name}（加载失败）`, state === 'loading' ? 'loading' : 'error'))
}

export async function resolveAssetsInElement(root: HTMLElement, api: Api, scope: VaultScope, opts?: { inline?: boolean }): Promise<void> {
  const placeholders = Array.from(root.querySelectorAll<HTMLElement>('.hc-asset[data-hc-asset-ref]'))
  if (!placeholders.length) return

  const inlineMode = !!opts?.inline
  const indexPromise = ensureAssetsIndex(api, scope).catch(() => null)

  const tasks = placeholders.map(async (ph) => {
    if (ph.getAttribute('data-hc-asset-done') === '1') return
    ph.setAttribute('data-hc-asset-done', '1')

    const refText = String(ph.getAttribute('data-hc-asset-ref') || '').trim()
    const defaultName = String(ph.getAttribute('data-hc-asset-name-default') || '').trim() === '1'

    let displayName = String(ph.getAttribute('data-hc-asset-name') || '').trim()
    if (defaultName) {
      const ref0 = String(refText || '').trim()
      const dotIdx = ref0.lastIndexOf('.')
      const assetId = dotIdx > 0 ? ref0.slice(0, dotIdx) : ref0
      const ext = dotIdx > 0 ? ref0.slice(dotIdx + 1).toLowerCase() : ''
      const idx = await indexPromise
      const key = ext ? `${assetId}.${ext}` : assetId
      const fromIndex = String(idx?.assets?.[key]?.displayName || '').trim()
      if (fromIndex) displayName = fromIndex
      else displayName = ''
    }
    const widthStr = String(ph.getAttribute('data-hc-asset-width') || '').trim()
    const width = widthStr ? Number(widthStr) : undefined
    const ref = parseRef(refText, displayName, width)
    if (!ref) return

    setAssetPlaceholderState(ph, 'loading', ref.name)

    const mime = mimeFromExt(ref.ext)
    const kind = mime ? kindFromMime(mime) : 'document'

    try {
      if (kind === 'document') {
        ph.replaceWith(buildChip(`📄 ${ref.name}`, 'doc'))
        return
      }

      const blobUrl = await getAssetBlobUrl(api, scope, ref.assetId, ref.ext)

      if (kind === 'image') {
        if (inlineMode) ph.replaceWith(buildChip(`🖼 ${ref.name}`, 'doc'))
        else ph.replaceWith(wrapBlock(ref.name, buildImage(blobUrl, ref.name, ref.width)))
        return
      }
      if (kind === 'audio') {
        if (inlineMode) {
          ph.replaceWith(buildChip(`🔊 ${ref.name}`, 'doc'))
        } else {
          ph.replaceWith(wrapBlock(ref.name, buildAudio(blobUrl)))
        }
        return
      }
      if (kind === 'video') {
        if (inlineMode) {
          ph.replaceWith(buildChip(`🎞 ${ref.name}`, 'doc'))
        } else {
          ph.replaceWith(wrapBlock(ref.name, buildVideoPlayer(blobUrl, ref.name, ref.width)))
        }
        return
      }

      ph.replaceWith(buildChip(`📄 ${ref.name}`, 'doc'))
    } catch {
      setAssetPlaceholderState(ph, 'error', ref.name)
    }
  })

  await Promise.all(tasks)
}
