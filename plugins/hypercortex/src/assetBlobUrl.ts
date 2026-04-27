import type { VaultScope } from './core'
import { mimeFromExt } from './core'
import type { AssetsService } from './gateway/types'

const blobUrlCache = new Map<string, string>()

function cacheKey(assetId: string, ext: string): string {
  return ext ? `${assetId}.${ext}` : assetId
}

function normalizeToDataUrl(raw: string, ext: string): string {
  const s = String(raw || '')
  if (s.startsWith('data:')) return s
  const mime = mimeFromExt(ext) || 'application/octet-stream'
  return `data:${mime};base64,${s}`
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

export async function getAssetBlobUrl(assets: Pick<AssetsService, 'readAssetDataUrl'>, scope: VaultScope, assetId: string, ext: string): Promise<string> {
  const aid = String(assetId || '').trim()
  const ex = String(ext || '').trim().toLowerCase()
  if (!aid) throw new Error('assetId 不能为空')

  const key = cacheKey(aid, ex)
  const cached = blobUrlCache.get(key)
  if (cached) return cached

  const dataUrlRaw = await assets.readAssetDataUrl(scope, aid, ex)
  const dataUrl = normalizeToDataUrl(dataUrlRaw, ex)
  const blob = dataUrlToBlob(dataUrl)
  const url = URL.createObjectURL(blob)
  blobUrlCache.set(key, url)
  return url
}

