import { type Api, ensureVaultDirs, type VaultScope } from './core'
import { extFromMime, kindFromMime, mimeFromDataUrl } from './assetFileTypes'
import type { HyperCortexNoteResourceRef } from './noteSchema'
import { deleteAssetById, getAssetWriteRelPath, recordAssetWritten, resolveAssetRelPath, scanAssetPool } from './assetStore'

export type { AssetPoolItem } from './assetStore'

export async function importImageToAssetPool(
  api: Api,
  scope: VaultScope,
  input: { name?: string; dataUrl: string },
): Promise<HyperCortexNoteResourceRef> {
  await ensureVaultDirs(api, scope)
  const dataUrl = String(input.dataUrl || '').trim()
  if (!dataUrl) throw new Error('图片数据为空')
  const assetId = await getSha256Hex(dataUrl)
  const mime = mimeFromDataUrl(dataUrl)
  const ext = extFromMime(mime)
  const path = await getAssetWriteRelPath(api, scope, assetId, ext, 'image')
  await api.files.writeBase64({
    scope,
    path,
    dataUrlOrBase64: dataUrl,
    overwrite: true,
  })
  await recordAssetWritten(api, scope, { assetId, ext, relPath: path, kind: 'image', displayName: input.name }).catch(() => {})
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
  const assetId = await getSha256Hex(dataUrl)
  const mime = mimeFromDataUrl(dataUrl)
  const ext = extFromMime(mime)
  const kind = kindFromMime(mime)
  const path = await getAssetWriteRelPath(api, scope, assetId, ext, kind)
  await api.files.writeBase64({
    scope,
    path,
    dataUrlOrBase64: dataUrl,
    overwrite: true,
  })
  await recordAssetWritten(api, scope, { assetId, ext, relPath: path, kind, displayName: input.name }).catch(() => {})
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
  await ensureVaultDirs(api, scope)
  return scanAssetPool(api, scope)
}

export async function readAssetAsDataUrl(api: Api, scope: VaultScope, assetId: string, ext?: string): Promise<string> {
  const path = await resolveAssetRelPath(api, scope, assetId, ext)
  return api.files.readBase64({ scope, path })
}

export async function deleteAssetFromPool(api: Api, scope: VaultScope, assetId: string, ext?: string): Promise<void> {
  await ensureVaultDirs(api, scope)
  await deleteAssetById(api, scope, assetId, ext)
}

async function getSha256Hex(dataUrlOrBase64: string): Promise<string> {
  const hasher = (globalThis as any).__hypercortexSha256Hex
  if (typeof hasher !== 'function') throw new Error('HyperCortex sha256 hasher 未初始化')
  return hasher(dataUrlOrBase64)
}
