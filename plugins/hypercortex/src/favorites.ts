import { type Api } from './core'
import { wouldCreateFolderReferenceCycle } from './favoritesGraph'

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

function stableRefId(folderId: string, kind: FavoriteItemRef['kind'], targetId: string): string {
  // 仅用于脏数据修复：当 ref.id 缺失时，生成一个“稳定”的 id（同样输入得到同样输出）
  return `ref_${folderId}__${kind}__${targetId}`
}

function defaultLayout(): GridLayout {
  return { x: 0, y: 0, w: 2, h: 2 }
}

function nextAutoLayout(doc: HyperCortexFavoritesDocV1, folderId: string): GridLayout {
  const refs = getRefsByFolderId(doc, folderId)
  let maxBottom = 0
  for (const ref of refs) {
    const y = Number.isFinite(ref?.layout?.y) ? Math.max(0, Math.floor(ref.layout.y)) : 0
    const h = Number.isFinite(ref?.layout?.h) ? Math.max(1, Math.floor(ref.layout.h)) : defaultLayout().h
    maxBottom = Math.max(maxBottom, y + h)
  }
  return { ...defaultLayout(), y: maxBottom }
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

function asRecord(v: unknown): Record<string, any> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as any) : null
}

function normalizeLayout(raw: any): GridLayout {
  const x = Number.isFinite(raw?.x) ? Math.max(0, Math.floor(raw.x)) : 0
  const y = Number.isFinite(raw?.y) ? Math.max(0, Math.floor(raw.y)) : 0
  const w = Number.isFinite(raw?.w) ? Math.max(1, Math.floor(raw.w)) : defaultLayout().w
  const h = Number.isFinite(raw?.h) ? Math.max(1, Math.floor(raw.h)) : defaultLayout().h
  return { x, y, w, h }
}

function normalizeFolder(nowMs: number, id: string, raw: any): FavoriteFolder {
  const title = String(raw?.title ?? '').trim() || '未命名收藏夹'
  const createdAtMs = Number.isFinite(raw?.createdAtMs) ? Math.max(0, Math.floor(raw.createdAtMs)) : nowMs
  const updatedAtMs = Number.isFinite(raw?.updatedAtMs) ? Math.max(0, Math.floor(raw.updatedAtMs)) : createdAtMs
  return { id, title, createdAtMs, updatedAtMs }
}

function normalizeKind(raw: any): FavoriteItemRef['kind'] | null {
  const k = String(raw ?? '').trim()
  if (k === 'note' || k === 'asset' || k === 'folder') return k
  return null
}

function normalizeRef(nowMs: number, folderId: string, raw: any): FavoriteItemRef | null {
  const kind = normalizeKind(raw?.kind)
  if (!kind) return null
  const targetId = String(raw?.targetId ?? '').trim()
  if (!targetId) return null

  const id = String(raw?.id ?? '').trim() || stableRefId(folderId, kind, targetId)
  const createdAtMs = Number.isFinite(raw?.createdAtMs) ? Math.max(0, Math.floor(raw.createdAtMs)) : nowMs
  const updatedAtMs = Number.isFinite(raw?.updatedAtMs) ? Math.max(0, Math.floor(raw.updatedAtMs)) : createdAtMs
  const layout = normalizeLayout(raw?.layout)

  return { id, folderId, kind, targetId, layout, createdAtMs, updatedAtMs }
}

function normalizeFavoritesDocV1(nowMs: number, rawDoc: any): { doc: HyperCortexFavoritesDocV1; changed: boolean } {
  // 目标：在加载/ensure 阶段做文档级“结构修复 + 同页唯一性去重”
  // - 同页唯一性：对每个 folder 页面按 (kind,targetId) 去重，保留“首条”，保持稳定
  // - 结构健壮：root/rootFolderId/folders/refsByFolderId 保底存在
  let changed = false

  const base: HyperCortexFavoritesDocV1 = createFreshFavoritesDocV1(nowMs)
  const docRec = asRecord(rawDoc)
  if (!docRec) return { doc: base, changed: true }

  const foldersRec = asRecord(docRec.folders) ?? {}
  const refsByFolderIdRec = asRecord(docRec.refsByFolderId) ?? {}

  const nextFolders: Record<string, FavoriteFolder> = {}
  // 先把 folders 规范化
  for (const [key, value] of Object.entries(foldersRec)) {
    const id = String(key ?? '').trim()
    if (!id) {
      changed = true
      continue
    }
    nextFolders[id] = normalizeFolder(nowMs, id, value)
    if (value?.id !== id) changed = true
  }

  // root 强制存在，且 rootFolderId 强制为 'root'
  if (!nextFolders.root) {
    nextFolders.root = normalizeFolder(nowMs, 'root', { title: '收藏夹', createdAtMs: nowMs, updatedAtMs: nowMs })
    changed = true
  } else {
    // root 标题若缺失，补上
    if (!String(nextFolders.root.title ?? '').trim()) {
      nextFolders.root = { ...nextFolders.root, title: '收藏夹', updatedAtMs: Math.max(nowMs, nextFolders.root.updatedAtMs || 0) }
      changed = true
    }
  }

  const nextRefsByFolderId: Record<string, FavoriteItemRef[]> = {}

  // 1) 先处理 refsByFolderId 中已存在的页面列表
  for (const [fidRaw, refsRaw] of Object.entries(refsByFolderIdRec)) {
    const fid = String(fidRaw ?? '').trim()
    if (!fid) {
      changed = true
      continue
    }

    // 若 refsByFolderId 存在，但 folders 缺失对应页面，则补一个占位 folder，保证结构可用
    if (!nextFolders[fid]) {
      nextFolders[fid] = normalizeFolder(nowMs, fid, null)
      changed = true
    }

    const list = Array.isArray(refsRaw) ? refsRaw : []
    if (!Array.isArray(refsRaw)) changed = true

    const seen = new Set<string>()
    const nextList: FavoriteItemRef[] = []

    for (const item of list) {
      const ref = normalizeRef(nowMs, fid, item)
      if (!ref) {
        changed = true
        continue
      }

      // 同页唯一性约束：按 (kind,targetId) 判重，保留首条（稳定）
      const uniqKey = `${ref.kind}:${ref.targetId}`
      if (seen.has(uniqKey)) {
        changed = true
        continue
      }
      seen.add(uniqKey)
      nextList.push(ref)

      // 若原 ref 的 folderId 不等于当前页面 id，修正
      if (String(item?.folderId ?? '').trim() !== fid) changed = true
    }

    nextRefsByFolderId[fid] = nextList
  }

  // 2) 对 folders 中存在但 refsByFolderId 缺失的页面补空数组
  for (const fid of Object.keys(nextFolders)) {
    if (!nextRefsByFolderId[fid]) {
      nextRefsByFolderId[fid] = []
      if (!(fid in refsByFolderIdRec)) changed = true
    }
  }

  const normalized: HyperCortexFavoritesDocV1 = {
    version: 1,
    rootFolderId: 'root',
    folders: nextFolders,
    refsByFolderId: nextRefsByFolderId,
  }

  if (docRec.version !== 1) changed = true
  if (docRec.rootFolderId !== 'root') changed = true
  if (docRec.folders !== foldersRec) {
    // 这里不做引用级别对比，只用于提醒：结构已被重建
  }

  return { doc: normalized, changed }
}

async function tryLoadFavoritesInternal(
  api: Api,
): Promise<{ doc: HyperCortexFavoritesDocV1; changed: boolean } | null> {
  try {
    const raw = await api.files.readText({ scope: 'data', path: FAVORITES_FILE })
    const parsed = JSON.parse(raw || 'null')
    if (!parsed || typeof parsed !== 'object') return null
    if ((parsed as any).version !== 1) return null
    const normalized = normalizeFavoritesDocV1(Date.now(), parsed)
    return normalized
  } catch {
    return null
  }
}

export async function tryLoadFavorites(api: Api): Promise<HyperCortexFavoritesDocV1 | null> {
  try {
    const raw = await api.files.readText({ scope: 'data', path: FAVORITES_FILE })
    const parsed = JSON.parse(raw || 'null')
    if (!parsed || typeof parsed !== 'object') return null
    if ((parsed as any).version !== 1) return null
    return normalizeFavoritesDocV1(Date.now(), parsed).doc
  } catch {
    return null
  }
}

export async function ensureFavorites(api: Api): Promise<HyperCortexFavoritesDocV1> {
  const existing = await tryLoadFavoritesInternal(api)
  if (existing) {
    if (existing.changed) {
      // 加载阶段发现脏数据：自动规范化并回写，确保“同页唯一性约束”落地到磁盘
      await api.files
        .writeText({
          scope: 'data',
          path: FAVORITES_FILE,
          text: JSON.stringify(existing.doc, null, 2),
          overwrite: true,
        })
        .catch(() => {})
    }
    return existing.doc
  }
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
  if (kind === 'folder' && wouldCreateFolderReferenceCycle(doc, fid, tid)) return null

  const nowMs = Date.now()
  const ref: FavoriteItemRef = {
    id: nowId(),
    folderId: fid,
    kind,
    targetId: tid,
    layout: layout ?? nextAutoLayout(doc, fid),
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

