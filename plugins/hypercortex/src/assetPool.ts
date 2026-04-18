import {
  ASSETS_DIR,
  type Api,
  type VaultScope,
  ensureVaultDirs,
  extFromMime,
  kindFromMime,
  mimeFromDataUrl,
  sha256Hex,
} from './core'
import type { HyperCortexNoteResourceRef } from './noteSchema'

export function assetRelPath(assetId: string, ext?: string): string {
  const suffix = String(ext || '').trim()
  return `${ASSETS_DIR}/${assetId}${suffix ? `.${suffix}` : ''}`
}

export async function importImageToAssetPool(
  api: Api,
  scope: VaultScope,
  input: { name?: string; dataUrl: string },
): Promise<HyperCortexNoteResourceRef> {
  await ensureVaultDirs(api, scope)
  const dataUrl = String(input.dataUrl || '').trim()
  if (!dataUrl) throw new Error('图片数据为空')
  const assetId = await sha256Hex(dataUrl)
  const mime = mimeFromDataUrl(dataUrl)
  const ext = extFromMime(mime)
  await api.files.writeBase64({
    scope,
    path: assetRelPath(assetId, ext),
    dataUrlOrBase64: dataUrl,
    overwrite: true,
  })
  return {
    assetId,
    mime: mime || undefined,
    ext: ext || undefined,
    kind: 'image',
    name: String(input.name || '').trim() || undefined,
  }
}

export async function importPickedImagesToAssetPool(api: Api, scope: VaultScope, maxCount?: number): Promise<HyperCortexNoteResourceRef[]> {
  const picked = await api.files.pickImages(maxCount == null ? null : Number(maxCount))
  const out: HyperCortexNoteResourceRef[] = []
  for (const item of picked || []) {
    out.push(
      await importImageToAssetPool(api, scope, {
        name: item.name,
        dataUrl: item.dataUrl,
      }),
    )
  }
  return out
}

export async function importFileToAssetPool(
  api: Api,
  scope: VaultScope,
  input: { name?: string; dataUrl: string },
): Promise<HyperCortexNoteResourceRef> {
  await ensureVaultDirs(api, scope)
  const dataUrl = String(input.dataUrl || '').trim()
  if (!dataUrl) throw new Error('文件数据为空')
  const assetId = await sha256Hex(dataUrl)
  const mime = mimeFromDataUrl(dataUrl)
  const ext = extFromMime(mime)
  const kind = kindFromMime(mime)
  await api.files.writeBase64({
    scope,
    path: assetRelPath(assetId, ext),
    dataUrlOrBase64: dataUrl,
    overwrite: true,
  })
  return {
    assetId,
    mime: mime || undefined,
    ext: ext || undefined,
    kind: kind || undefined,
    name: String(input.name || '').trim() || undefined,
  }
}

export async function importFilesToAssetPool(
  api: Api,
  scope: VaultScope,
  inputs: { name?: string; dataUrl: string }[],
): Promise<HyperCortexNoteResourceRef[]> {
  const out: HyperCortexNoteResourceRef[] = []
  for (const item of Array.isArray(inputs) ? inputs : []) {
    out.push(await importFileToAssetPool(api, scope, item))
  }
  return out
}

export async function listAssetsInPool(api: Api, scope: VaultScope) {
  return api.files.listDir({ scope, dir: ASSETS_DIR }).catch(() => [])
}

export async function readAssetAsDataUrl(api: Api, scope: VaultScope, assetId: string, ext?: string): Promise<string> {
  return api.files.readBase64({ scope, path: assetRelPath(assetId, ext) })
}
