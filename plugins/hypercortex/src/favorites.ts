import { type Api } from './core'

export const FAVORITES_FILE = 'hypercortex-favorites.json'

export type GridLayout = {
  x: number
  y: number
  w: number
  h: number
}

export type FavoriteFolder = {
  id: string
  title: string
  createdAtMs: number
  updatedAtMs: number
}

export type FavoriteItemRef = {
  id: string
  folderId: string
  kind: 'note' | 'asset' | 'folder'
  targetId: string
  layout: GridLayout
  createdAtMs: number
  updatedAtMs: number
}

export type HyperCortexFavoritesDocV1 = {
  version: 1
  rootFolderId: 'root'
  folders: Record<string, FavoriteFolder>
  refsByFolderId: Record<string, FavoriteItemRef[]>
}

function nowId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function defaultLayout(): GridLayout {
  return { x: 0, y: 0, w: 2, h: 2 }
}

function createFreshFavoritesDocV1(nowMs: number): HyperCortexFavoritesDocV1 {
  const root: FavoriteFolder = {
    id: 'root',
    title: '收藏夹',
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  }
  return {
    version: 1,
    rootFolderId: 'root',
    folders: { root },
    refsByFolderId: { root: [] },
  }
}

export async function tryLoadFavorites(api: Api): Promise<HyperCortexFavoritesDocV1 | null> {
  try {
    const raw = await api.files.readText({ scope: 'data', path: FAVORITES_FILE })
    const parsed = JSON.parse(raw || 'null')
    if (!parsed || typeof parsed !== 'object') return null
    if ((parsed as any).version !== 1) return null
    return parsed as HyperCortexFavoritesDocV1
  } catch {
    return null
  }
}

export async function ensureFavorites(api: Api): Promise<HyperCortexFavoritesDocV1> {
  const existing = await tryLoadFavorites(api)
  if (existing) return existing
  const fresh = createFreshFavoritesDocV1(Date.now())
  await api.files
    .writeText({ scope: 'data', path: FAVORITES_FILE, text: JSON.stringify(fresh, null, 2), overwrite: true })
    .catch(() => {})
  return fresh
}

export async function saveFavorites(api: Api, doc: HyperCortexFavoritesDocV1): Promise<void> {
  await api.files.writeText({ scope: 'data', path: FAVORITES_FILE, text: JSON.stringify(doc, null, 2), overwrite: true })
}

export function getRefsByFolderId(doc: HyperCortexFavoritesDocV1, folderId: string): FavoriteItemRef[] {
  const refs = (doc.refsByFolderId as any)?.[folderId]
  return Array.isArray(refs) ? refs : []
}

export function getFolderById(doc: HyperCortexFavoritesDocV1, folderId: string): FavoriteFolder | undefined {
  return doc.folders[folderId]
}

export function getAllFolders(doc: HyperCortexFavoritesDocV1): FavoriteFolder[] {
  return Object.values(doc.folders).sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0))
}

export function getNoteRefs(doc: HyperCortexFavoritesDocV1, folderId: string): FavoriteItemRef[] {
  return getRefsByFolderId(doc, folderId).filter(ref => ref.kind === 'note')
}

export function getAssetRefs(doc: HyperCortexFavoritesDocV1, folderId: string): FavoriteItemRef[] {
  return getRefsByFolderId(doc, folderId).filter(ref => ref.kind === 'asset')
}

export function getFolderRefs(doc: HyperCortexFavoritesDocV1, folderId: string): FavoriteItemRef[] {
  return getRefsByFolderId(doc, folderId).filter(ref => ref.kind === 'folder')
}

export function createFolder(
  doc: HyperCortexFavoritesDocV1,
  title?: string,
): { doc: HyperCortexFavoritesDocV1; folder: FavoriteFolder } {
  const nowMs = Date.now()
  const id = nowId()
  const folder: FavoriteFolder = {
    id,
    title: String(title ?? '').trim() || '新收藏夹',
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  }
  const next: HyperCortexFavoritesDocV1 = {
    ...doc,
    folders: { ...doc.folders, [id]: folder },
    refsByFolderId: { ...doc.refsByFolderId, [id]: [] },
  }
  return { doc: next, folder }
}

export function renameFolder(doc: HyperCortexFavoritesDocV1, folderId: string, title: string): HyperCortexFavoritesDocV1 | null {
  const existing = doc.folders[folderId]
  if (!existing) return null
  const nextTitle = String(title ?? '').trim()
  if (!nextTitle) return null
  const nowMs = Date.now()
  return {
    ...doc,
    folders: {
      ...doc.folders,
      [folderId]: { ...existing, title: nextTitle, updatedAtMs: nowMs },
    },
  }
}

export function deleteFolder(doc: HyperCortexFavoritesDocV1, folderId: string): HyperCortexFavoritesDocV1 | null {
  const id = String(folderId || '').trim()
  if (!id) return null
  if (id === doc.rootFolderId) return null
  if (!doc.folders[id]) return null

  const nowMs = Date.now()
  const nextFoldersBase: Record<string, FavoriteFolder> = { ...doc.folders }
  delete nextFoldersBase[id]

  const nextRefsByFolderId: Record<string, FavoriteItemRef[]> = { ...doc.refsByFolderId }
  delete nextRefsByFolderId[id]

  const touchedFolderIds = new Set<string>()

  for (const [fid, refs] of Object.entries(doc.refsByFolderId)) {
    if (fid === id) continue
    const list = Array.isArray(refs) ? refs : []
    const filtered = list.filter(ref => !(ref?.folderId === id || (ref?.kind === 'folder' && ref?.targetId === id)))
    if (filtered.length !== list.length) {
      nextRefsByFolderId[fid] = filtered
      touchedFolderIds.add(fid)
    }
  }

  if (touchedFolderIds.size === 0) return { ...doc, folders: nextFoldersBase, refsByFolderId: nextRefsByFolderId }

  const nextFolders: Record<string, FavoriteFolder> = { ...nextFoldersBase }
  for (const fid of touchedFolderIds) {
    const f = nextFolders[fid]
    if (!f) continue
    nextFolders[fid] = { ...f, updatedAtMs: nowMs }
  }

  return { ...doc, folders: nextFolders, refsByFolderId: nextRefsByFolderId }
}

export function addRef(
  doc: HyperCortexFavoritesDocV1,
  folderId: string,
  kind: FavoriteItemRef['kind'],
  targetId: string,
  layout?: GridLayout,
): { doc: HyperCortexFavoritesDocV1; ref: FavoriteItemRef } | null {
  const fid = String(folderId || '').trim()
  if (!fid) return null
  if (!doc.folders[fid]) return null
  const tid = String(targetId || '').trim()
  if (!tid) return null

  const refs = getRefsByFolderId(doc, fid)
  if (refs.some(r => r.folderId === fid && r.kind === kind && r.targetId === tid)) return null

  const nowMs = Date.now()
  const ref: FavoriteItemRef = {
    id: nowId(),
    folderId: fid,
    kind,
    targetId: tid,
    layout: layout ?? defaultLayout(),
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  }

  const nextRefsByFolderId: Record<string, FavoriteItemRef[]> = {
    ...doc.refsByFolderId,
    [fid]: [...refs, ref],
  }

  const folder = doc.folders[fid]
  const nextFolders: Record<string, FavoriteFolder> = {
    ...doc.folders,
    [fid]: { ...folder, updatedAtMs: nowMs },
  }

  return { doc: { ...doc, folders: nextFolders, refsByFolderId: nextRefsByFolderId }, ref }
}

export function removeRef(doc: HyperCortexFavoritesDocV1, refId: string): HyperCortexFavoritesDocV1 {
  const id = String(refId || '').trim()
  if (!id) return doc

  let changed = false
  const nowMs = Date.now()
  const nextRefsByFolderId: Record<string, FavoriteItemRef[]> = { ...doc.refsByFolderId }
  const touchedFolderIds = new Set<string>()

  for (const [fid, refs] of Object.entries(doc.refsByFolderId)) {
    const list = Array.isArray(refs) ? refs : []
    const filtered = list.filter(ref => ref?.id !== id)
    if (filtered.length !== list.length) {
      nextRefsByFolderId[fid] = filtered
      touchedFolderIds.add(fid)
      changed = true
    }
  }

  if (!changed) return doc

  const nextFolders: Record<string, FavoriteFolder> = { ...doc.folders }
  for (const fid of touchedFolderIds) {
    const f = nextFolders[fid]
    if (!f) continue
    nextFolders[fid] = { ...f, updatedAtMs: nowMs }
  }

  return { ...doc, folders: nextFolders, refsByFolderId: nextRefsByFolderId }
}

export function updateRefLayout(doc: HyperCortexFavoritesDocV1, refId: string, layout: GridLayout): HyperCortexFavoritesDocV1 {
  const id = String(refId || '').trim()
  if (!id) return doc

  let changed = false
  const nowMs = Date.now()
  const nextRefsByFolderId: Record<string, FavoriteItemRef[]> = { ...doc.refsByFolderId }
  const touchedFolderIds = new Set<string>()

  for (const [fid, refs] of Object.entries(doc.refsByFolderId)) {
    const list = Array.isArray(refs) ? refs : []
    let didChange = false
    const nextList = list.map(ref => {
      if (ref?.id !== id) return ref
      didChange = true
      return { ...ref, layout, updatedAtMs: nowMs }
    })
    if (didChange) {
      nextRefsByFolderId[fid] = nextList
      touchedFolderIds.add(fid)
      changed = true
    }
  }

  if (!changed) return doc

  const nextFolders: Record<string, FavoriteFolder> = { ...doc.folders }
  for (const fid of touchedFolderIds) {
    const f = nextFolders[fid]
    if (!f) continue
    nextFolders[fid] = { ...f, updatedAtMs: nowMs }
  }

  return { ...doc, folders: nextFolders, refsByFolderId: nextRefsByFolderId }
}

