import type { Api, VaultScope } from '../core'
import { ensureMetadata, saveMetadata, tryLoadMetadata } from '../core'
import { deleteAssetFromPool, importFilesToAssetPool, listAssetsInPool, readAssetAsDataUrl } from '../assetPool'
import { ensureAssetsIndex } from '../assetStore'
import { sha256HexFromDataUrlOrBase64 } from './nodeCrypto'
import { ensureFavorites, saveFavorites, tryLoadFavorites } from '../favorites'
import { loadRefIndex, removeNoteFromRefIndex, saveRefIndex, updateRefsForNote } from '../noteRefs'
import {
  deleteHtmlFace,
  deleteNoteFace,
  loadHtmlFace,
  loadNoteFace,
  loadNoteIndex,
  loadNoteManifest,
  loadNotePackage,
  rebuildNoteIndexFromFs,
  saveHtmlFace,
  saveHtmlFaceFixedScale,
  saveNoteFace,
  saveNotePackage,
  tryReadNoteManifest,
} from '../notePackage'
import { listTrashItems, maybeAutoCleanupTrash, moveNoteToTrash, permanentlyDeleteNoteDir, restoreTrashItem } from '../trash'
import { HyperCortexRpc } from '../shared/rpcMethods'
import { createThumbnailProvider } from './thumbnail'

type Handler = (params: unknown) => Promise<unknown>

export function createHyperCortexBackendService(api: Api) {
  ;(globalThis as any).__hypercortexSha256Hex = sha256HexFromDataUrlOrBase64
  const thumbnail = createThumbnailProvider()
  const handlers: Record<string, Handler> = {
    [HyperCortexRpc.notes.loadIndex]: params => loadNoteIndex(api, requireScope(params)),
    [HyperCortexRpc.notes.rebuildIndex]: params => rebuildNoteIndexFromFs(api, requireScope(params), requireObject(params, 'idx')),
    [HyperCortexRpc.notes.create]: params => saveNotePackage(api, requireScope(params), requireObject(params, 'input')),
    [HyperCortexRpc.notes.savePackage]: params => saveNotePackage(api, requireScope(params), requireObject(params, 'input')),
    [HyperCortexRpc.notes.loadPackage]: params => loadNotePackage(api, requireScope(params), requireString(params, 'packageDir')),
    [HyperCortexRpc.notes.loadManifest]: params => loadNoteManifest(api, requireScope(params), requireString(params, 'packageDir')),
    [HyperCortexRpc.notes.tryReadManifest]: params => tryReadNoteManifest(api, requireScope(params), requireString(params, 'packageDir')),
    [HyperCortexRpc.notes.loadFace]: params => loadNoteFace(api, requireScope(params), requireString(params, 'packageDir'), requireString(params, 'faceId')),
    [HyperCortexRpc.notes.saveFace]: params => saveNoteFace(api, requireScope(params), requireObject(params, 'input')),
    [HyperCortexRpc.notes.deleteFace]: params => deleteNoteFace(api, requireScope(params), requireString(params, 'packageDir'), requireString(params, 'faceId')),
    [HyperCortexRpc.notes.loadHtmlFace]: params => loadHtmlFace(api, requireScope(params), requireString(params, 'packageDir')),
    [HyperCortexRpc.notes.saveHtmlFace]: params => saveHtmlFace(api, requireScope(params), requireObject(params, 'input')),
    [HyperCortexRpc.notes.deleteHtmlFace]: params => deleteHtmlFace(api, requireScope(params), requireString(params, 'packageDir')),
    [HyperCortexRpc.notes.saveHtmlFaceFixedScale]: params => saveHtmlFaceFixedScale(api, requireScope(params), requireString(params, 'packageDir'), optionalFiniteNumber(params, 'fixedScale')),

    [HyperCortexRpc.assets.ensureIndex]: params => ensureAssetsIndex(api, requireScope(params)),
    [HyperCortexRpc.assets.list]: params => listAssetsInPool(api, requireScope(params)),
    [HyperCortexRpc.assets.importFiles]: params => importFilesToAssetPool(api, requireScope(params), requireArray(params, 'inputs')),
    [HyperCortexRpc.assets.readDataUrl]: params => readAssetAsDataUrl(api, requireScope(params), requireString(params, 'assetId'), optionalString(params, 'ext')),
    [HyperCortexRpc.assets.delete]: params => deleteAssetFromPool(api, requireScope(params), requireString(params, 'assetId'), optionalString(params, 'ext')),
    [HyperCortexRpc.assets.getVideoThumbnail]: params => thumbnail.getThumbnail({ scope: requireScope(params), path: requireString(params, 'path'), width: optionalPositiveInt(params, 'width'), height: optionalPositiveInt(params, 'height') }),

    [HyperCortexRpc.refs.loadIndex]: params => loadRefIndex(api, requireScope(params)),
    [HyperCortexRpc.refs.saveIndex]: params => saveRefIndex(api, requireScope(params), requireObject(params, 'idx')),
    [HyperCortexRpc.refs.updateForNote]: params => updateRefsForNote(api, requireScope(params), requireString(params, 'noteId'), requireString(params, 'body')),
    [HyperCortexRpc.refs.removeNote]: params => removeNoteFromRefIndex(api, requireScope(params), requireString(params, 'noteId')),

    [HyperCortexRpc.metadata.tryLoad]: async () => tryLoadMetadata(api),
    [HyperCortexRpc.metadata.ensure]: async () => ensureMetadata(api),
    [HyperCortexRpc.metadata.save]: params => saveMetadata(api, requireObject(params, 'meta')),

    [HyperCortexRpc.favorites.tryLoad]: async () => tryLoadFavorites(api),
    [HyperCortexRpc.favorites.ensure]: async () => ensureFavorites(api),
    [HyperCortexRpc.favorites.save]: params => saveFavorites(api, requireObject(params, 'doc')),

    [HyperCortexRpc.trash.list]: params => listTrashItems(api, requireScope(params)),
    [HyperCortexRpc.trash.moveNote]: params => moveNoteToTrash(api, requireScope(params), requireObject(params, 'note')),
    [HyperCortexRpc.trash.permanentlyDeleteNoteDir]: params => permanentlyDeleteNoteDir(api, requireScope(params), requireString(params, 'noteId'), requireString(params, 'dir')),
    [HyperCortexRpc.trash.restore]: params => restoreTrashItem(api, requireScope(params), requireObject(params, 'item')),
    [HyperCortexRpc.trash.maybeAutoCleanup]: params => maybeAutoCleanupTrash(api, requireScope(params), requirePositiveInt(params, 'days')),

    [HyperCortexRpc.host.getLibraryDir]: async () => api.files.getLibraryDir(),
    [HyperCortexRpc.host.openDir]: params => api.files.openDir(requireString(params, 'dir')),
  }

  async function dispatch(method: string, params: unknown): Promise<unknown> {
    const handler = handlers[String(method || '')]
    if (!handler) throw new Error(`未知请求：${String(method || '')}`)
    return handler(params || {})
  }

  async function warmup() {
    await api.files.listDir({ scope: 'data', dir: null }).catch(() => {})
  }

  return { dispatch, warmup }
}

function asRecord(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('RPC 参数必须是对象')
  return params as Record<string, unknown>
}

function requireScope(params: unknown): VaultScope {
  const scope = String(asRecord(params).scope || '').trim()
  if (scope !== 'library' && scope !== 'data') throw new Error(`非法 scope：${scope}`)
  return scope
}

function requireString(params: unknown, key: string): string {
  const value = String(asRecord(params)[key] ?? '').trim()
  if (!value) throw new Error(`${key} 不能为空`)
  return value
}

function optionalString(params: unknown, key: string): string | undefined {
  const value = String(asRecord(params)[key] ?? '').trim()
  return value || undefined
}

function requirePositiveInt(params: unknown, key: string): number {
  const value = Number(asRecord(params)[key])
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${key} 必须是正整数`)
  return value
}

function optionalPositiveInt(params: unknown, key: string): number | undefined {
  const value = asRecord(params)[key]
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${key} 必须是正整数`)
  return n
}

function optionalFiniteNumber(params: unknown, key: string): number | null {
  const value = asRecord(params)[key]
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`${key} 必须是有限数字`)
  return n
}

function requireObject<T extends object = Record<string, unknown>>(params: unknown, key: string): T {
  const value = asRecord(params)[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${key} 必须是对象`)
  return value as T
}

function requireArray<T = unknown>(params: unknown, key: string): T[] {
  const value = asRecord(params)[key]
  if (!Array.isArray(value)) throw new Error(`${key} 必须是数组`)
  return value as T[]
}
