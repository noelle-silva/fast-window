import { isDraftNoteId } from './drafts'
import { wouldCreateFolderReferenceCycle } from './favoritesGraph'

// 草稿引用的判定：指向尚未落盘草稿笔记的 note 引用。草稿只活在内存，
// 落盘时会被过滤（见 stripDraftNoteRefs），保证磁盘上不残留指向草稿的引用。
function isDraftNoteRef(ref: FavoriteItemRef): boolean {
  return ref.kind === 'note' && isDraftNoteId(ref.targetId)
}

export type GridLayout = {
  x: number
  y: number
  w: number
  h: number
}

export type FavoriteFolder = {
  id: string
  title: string
  description: string
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

// 默认布局与后端 defaultFavoriteLayout 保持同一套规矩（宽度 2、高度 2）：
// 界面内存镜像仅用于即时预览，新条目最终形态以后端规范化为准。
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

/**
 * 落盘前剔除草稿引用：草稿只活在内存，磁盘上不得残留指向草稿的引用。
 * 与左侧标签栏的 stripDraftTabKeys 同构，保证持久层永远干净。
 */
export function stripDraftNoteRefs(doc: HyperCortexFavoritesDocV1): HyperCortexFavoritesDocV1 {
  let changed = false
  const nextRefsByFolderId: Record<string, FavoriteItemRef[]> = {}
  for (const [fid, refs] of Object.entries(doc.refsByFolderId)) {
    const list = Array.isArray(refs) ? refs : []
    const filtered = list.filter(ref => !isDraftNoteRef(ref))
    if (filtered.length !== list.length) changed = true
    nextRefsByFolderId[fid] = filtered
  }
  return changed ? { ...doc, refsByFolderId: nextRefsByFolderId } : doc
}

/**
 * 取某页收藏夹的引用列表：文档在进内存时已由账本管理员整理一次，
 * 此后读取直接取用，不再每次全量重算规整。
 */
export function getRefsByFolderId(doc: HyperCortexFavoritesDocV1, folderId: string): FavoriteItemRef[] {
  const refs = (doc.refsByFolderId as any)?.[String(folderId || '').trim()]
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
  description?: string,
): { doc: HyperCortexFavoritesDocV1; folder: FavoriteFolder } {
  const nowMs = Date.now()
  const id = nowId()
  const folder: FavoriteFolder = {
    id,
    title: String(title ?? '').trim() || '新收藏夹',
    description: String(description ?? '').trim(),
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
  return updateFolderInfo(doc, folderId, { title })
}

export function updateFolderInfo(
  doc: HyperCortexFavoritesDocV1,
  folderId: string,
  patch: { title: string; description?: string },
): HyperCortexFavoritesDocV1 | null {
  const existing = doc.folders[folderId]
  if (!existing) return null
  const nextTitle = String(patch.title ?? '').trim()
  if (!nextTitle) return null
  const nextDescription = String(patch.description ?? existing.description ?? '').trim()
  if (existing.title === nextTitle && (existing.description || '') === nextDescription) return doc
  const nowMs = Date.now()
  return {
    ...doc,
    folders: {
      ...doc.folders,
      [folderId]: { ...existing, title: nextTitle, description: nextDescription, updatedAtMs: nowMs },
    },
  }
}

/**
 * 删除收藏夹实体：移除收藏夹本体与其页面条目清单；别处指向它的引用保留在文档中，
 * 目标缺失期间显示为已丢失，可随回收站恢复复活。根收藏夹与未知标识不可删除。
 */
export function deleteFolder(doc: HyperCortexFavoritesDocV1, folderId: string): HyperCortexFavoritesDocV1 | null {
  const id = String(folderId || '').trim()
  if (!id) return null
  if (id === doc.rootFolderId) return null
  if (!doc.folders[id]) return null

  const nextFolders: Record<string, FavoriteFolder> = { ...doc.folders }
  delete nextFolders[id]

  const nextRefsByFolderId: Record<string, FavoriteItemRef[]> = { ...doc.refsByFolderId }
  delete nextRefsByFolderId[id]

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

/** 按引用标识在整份文档中查找引用（引用可能位于任一收藏夹页）。 */
export function findRefById(doc: HyperCortexFavoritesDocV1, refId: string): FavoriteItemRef | undefined {
  const id = String(refId || '').trim()
  if (!id) return undefined
  for (const refs of Object.values(doc.refsByFolderId)) {
    const found = (Array.isArray(refs) ? refs : []).find(ref => ref?.id === id)
    if (found) return found
  }
  return undefined
}

/**
 * 判断一条引用能否迁移到目标收藏夹：目标页存在、不是源引用当前所在页，且文件夹引用不会形成自环或循环。
 * 「移动到…」与拖拽移动共用的目标准入规则：右键选择器由树结构天然排除非法页，拖拽悬停用它判定可放入，
 * moveRef 的逐目标过滤也复用它，保证交互预期与底层结果同源一致。
 */
export function canMoveRefToFolder(doc: HyperCortexFavoritesDocV1, ref: FavoriteItemRef, targetFolderId: string): boolean {
  const target = String(targetFolderId || '').trim()
  if (!target || target === ref.folderId) return false
  if (!doc.folders[target]) return false
  if (ref.kind === 'folder' && wouldCreateFolderReferenceCycle(doc, target, ref.targetId)) return false
  return true
}

/**
 * 拖拽移动模式的目标解析：悬停行是一条可迁入的收藏夹引用时返回该行标识，否则返回空串。
 * 供收藏夹侧边栏判定「悬停即高亮」，与 canMoveRefToFolder 同源。
 */
export function resolveMoveDropTargetRefId(doc: HyperCortexFavoritesDocV1, activeRefId: string, overRefId: string): string {
  const active = findRefById(doc, activeRefId)
  const over = findRefById(doc, overRefId)
  if (!active || !over || over.kind !== 'folder') return ''
  return canMoveRefToFolder(doc, active, over.targetId) ? over.id : ''
}

/** 移动引用的结果：成功迁出、源引用不存在、没有可用目标。 */
export type MoveRefOutcome = 'moved' | 'missing-ref' | 'no-target'

export type MoveRefResult = {
  doc: HyperCortexFavoritesDocV1
  outcome: MoveRefOutcome
  /** 成功落位的目标收藏夹数（含目标已存在同源引用、无需新增的情况）。 */
  movedCount: number
  /** 因循环引用或非法目标被跳过的收藏夹数。 */
  skippedCount: number
}

/**
 * 把一条引用从它当前所在的收藏夹迁移到一个或多个目标收藏夹：先加入所有目标、再移除源引用。
 * 与「收藏到」的复制语义相对：移动后源收藏夹不再保留该引用。
 * 单个目标失败只跳过该目标（如循环引用），不做整体回滚；只要至少一个目标落位，源引用才移除，故不会丢内容。
 */
export function moveRef(
  doc: HyperCortexFavoritesDocV1,
  refId: string,
  targetFolderIds: readonly string[],
): MoveRefResult {
  const source = findRefById(doc, refId)
  if (!source) return { doc, outcome: 'missing-ref', movedCount: 0, skippedCount: 0 }

  const targets: string[] = []
  const seen = new Set<string>()
  for (const raw of targetFolderIds) {
    const target = String(raw || '').trim()
    if (!target || target === source.folderId || seen.has(target) || !doc.folders[target]) continue
    seen.add(target)
    targets.push(target)
  }

  let next = doc
  let movedCount = 0
  let skippedCount = 0
  for (const target of targets) {
    if (!canMoveRefToFolder(next, source, target)) {
      skippedCount++
      continue
    }
    const added = addRef(next, target, source.kind, source.targetId)
    if (added) {
      next = added.doc
      movedCount++
      continue
    }
    // addRef 返回空：目标页已有同源引用（无需新增，也算落位），否则视为非法目标。
    if (getRefsByFolderId(next, target).some(ref => ref.kind === source.kind && ref.targetId === source.targetId)) movedCount++
    else skippedCount++
  }

  if (movedCount === 0) return { doc, outcome: 'no-target', movedCount, skippedCount }
  return { doc: removeRef(next, source.id), outcome: 'moved', movedCount, skippedCount }
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

export function reorderRefsInFolder(doc: HyperCortexFavoritesDocV1, folderId: string, orderedRefIds: string[]): HyperCortexFavoritesDocV1 {
  const fid = String(folderId || '').trim()
  if (!fid) return doc
  const refs = getRefsByFolderId(doc, fid)
  if (refs.length <= 1) return doc

  const idOrder = orderedRefIds.map(id => String(id || '').trim()).filter(Boolean)
  if (idOrder.length !== refs.length) return doc

  const byId = new Map(refs.map(ref => [ref.id, ref] as const))
  const nextRefs = idOrder.map(id => byId.get(id)).filter((ref): ref is FavoriteItemRef => Boolean(ref))
  if (nextRefs.length !== refs.length) return doc

  const unchanged = refs.every((ref, index) => nextRefs[index]?.id === ref.id)
  if (unchanged) return doc

  const nowMs = Date.now()
  const folder = doc.folders[fid]
  return {
    ...doc,
    folders: folder ? { ...doc.folders, [fid]: { ...folder, updatedAtMs: nowMs } } : doc.folders,
    refsByFolderId: {
      ...doc.refsByFolderId,
      [fid]: nextRefs,
    },
  }
}

