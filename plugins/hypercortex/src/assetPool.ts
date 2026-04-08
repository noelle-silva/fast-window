import { ASSETS_DIR, type Api, type VaultScope, ensureVaultDirs, extFromMime, mimeFromDataUrl, sha256Hex } from './core'
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
