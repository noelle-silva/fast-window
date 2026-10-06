import type { VaultScope } from './core'
import type { HyperCortexGateway } from './gateway'
import type { FavoriteRefIdentity } from './gateway/types'
import { isDraftNoteId } from './drafts'
import type { FavoriteItemRef, GridLayout, HyperCortexFavoritesDocV1 } from './favorites'

// 收藏夹账本管理员：收藏夹文档的唯一读写入口，也是「前端收藏夹写」的唯一出口。
// - 读：从后端装载（后端是唯一规范化权威），并记录当前内存态基线。
// - 写：把一次「基线 → 新态」的变更收敛为一组语义写操作（建夹/改夹/放入/移出/挪夹/排序/布局/删除），
//   逐个报给后端在同一把串行锁下应用；不再整份文档覆盖写回。
// - 草稿引用只活在内存：指向未落盘草稿笔记的引用不产生任何写操作；草稿转正后按真实笔记标识登记。
// 只描述发生变化的局部，因此不同来源的并发写天然不互相覆盖；不引入版本保险丝。

export type FavoritesLedger = {
  /** 从后端装载文档并记录为当前基线；返回内存态文档（保留草稿引用）。 */
  load: () => Promise<HyperCortexFavoritesDocV1>
  /** 采纳后端权威文档（外部改动就地重载、回收站恢复）：只更新基线，不产生写操作。 */
  adopt: (doc: HyperCortexFavoritesDocV1) => void
  /** 提交内存态变更：与基线比对后收敛为语义写操作报给后端。 */
  commit: (next: HyperCortexFavoritesDocV1) => void
}

// 收藏夹语义写操作：与后端语义入口一一对应，调用者只表达意图。
type FavoritesOp =
  | { type: 'createFolder'; id: string; parentId: string; title: string; description: string }
  | { type: 'updateFolder'; folderId: string; title: string; description: string }
  | { type: 'deleteFolder'; folderId: string }
  | { type: 'addItem'; folderId: string; kind: FavoriteItemRef['kind']; targetId: string }
  | { type: 'removeItem'; folderId: string; kind: FavoriteItemRef['kind']; targetId: string }
  | { type: 'moveItem'; fromFolderId: string; toFolderId: string; kind: FavoriteItemRef['kind']; targetId: string }
  | { type: 'reorderItems'; folderId: string; ordered: FavoriteRefIdentity[] }
  | { type: 'updateItemLayout'; folderId: string; kind: FavoriteItemRef['kind']; targetId: string; layout: GridLayout }

const ROOT_FOLDER_ID = 'root'

// 草稿引用：指向尚未落盘草稿笔记的 note 引用。草稿只活在内存，不产生任何后端写操作。
function isDraftRef(ref: FavoriteItemRef): boolean {
  return ref.kind === 'note' && isDraftNoteId(ref.targetId)
}

function identityKey(kind: string, targetId: string): string {
  return `${kind}:${targetId}`
}

function splitIdentityKey(key: string): { kind: FavoriteItemRef['kind']; targetId: string } {
  const index = key.indexOf(':')
  return { kind: key.slice(0, index) as FavoriteItemRef['kind'], targetId: key.slice(index + 1) }
}

function refsOf(doc: HyperCortexFavoritesDocV1, folderId: string): FavoriteItemRef[] {
  const list = (doc.refsByFolderId as any)?.[folderId]
  return Array.isArray(list) ? list : []
}

// liveRefs 剔除草稿引用：草稿只参与内存展示，不参与语义写操作。
function liveRefs(refs: FavoriteItemRef[]): FavoriteItemRef[] {
  return refs.filter(ref => !isDraftRef(ref))
}

function sameLayout(a: GridLayout, b: GridLayout): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}

function pushInto(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

// findParentFolderId 找出引用某收藏夹的上级收藏夹；新建收藏夹时据此确定归属。
function findParentFolderId(doc: HyperCortexFavoritesDocV1, folderId: string): string {
  for (const [candidate, refs] of Object.entries(doc.refsByFolderId)) {
    for (const ref of Array.isArray(refs) ? refs : []) {
      if (ref.kind === 'folder' && ref.targetId === folderId) return candidate
    }
  }
  return ''
}

// diffFavorites 把一次「基线 → 新态」的变更收敛为语义写操作：只描述发生变化的局部。
export function diffFavorites(prev: HyperCortexFavoritesDocV1, next: HyperCortexFavoritesDocV1): FavoritesOp[] {
  const ops: FavoritesOp[] = []
  const prevFolderIds = new Set(Object.keys(prev.folders))
  const nextFolderIds = new Set(Object.keys(next.folders))
  const createdParents = new Map<string, string>()

  for (const id of nextFolderIds) {
    if (prevFolderIds.has(id)) continue
    const folder = next.folders[id]
    const parentId = findParentFolderId(next, id) || String(next.rootFolderId || ROOT_FOLDER_ID)
    createdParents.set(id, parentId)
    ops.push({ type: 'createFolder', id, parentId, title: folder.title, description: folder.description })
  }

  for (const id of prevFolderIds) {
    if (nextFolderIds.has(id)) continue
    if (id === prev.rootFolderId || id === ROOT_FOLDER_ID) continue
    ops.push({ type: 'deleteFolder', folderId: id })
  }

  for (const id of nextFolderIds) {
    if (!prevFolderIds.has(id)) continue
    const before = prev.folders[id]
    const after = next.folders[id]
    if (before.title !== after.title || before.description !== after.description) {
      ops.push({ type: 'updateFolder', folderId: id, title: after.title, description: after.description })
    }
  }

  // 已删除的收藏夹不参与条目比对：其页面条目清单随本体一并消失。
  const commonFolderIds = [...nextFolderIds].filter(id => prevFolderIds.has(id))
  const removedByIdentity = new Map<string, string[]>()
  const addedByIdentity = new Map<string, string[]>()
  const layoutChanges: { folderId: string; kind: FavoriteItemRef['kind']; targetId: string; layout: GridLayout }[] = []

  for (const folderId of commonFolderIds) {
    const beforeList = liveRefs(refsOf(prev, folderId))
    const afterList = liveRefs(refsOf(next, folderId))
    const beforeByKey = new Map(beforeList.map(ref => [identityKey(ref.kind, ref.targetId), ref] as const))
    const afterByKey = new Map(afterList.map(ref => [identityKey(ref.kind, ref.targetId), ref] as const))
    for (const [key] of beforeByKey) {
      if (!afterByKey.has(key)) pushInto(removedByIdentity, key, folderId)
    }
    for (const [key, ref] of afterByKey) {
      if (!beforeByKey.has(key)) {
        // 新建收藏夹的父引用由 createFolder 一并建立，避免重复放入。
        if (ref.kind === 'folder' && createdParents.get(ref.targetId) === folderId) continue
        pushInto(addedByIdentity, key, folderId)
      } else if (!sameLayout(beforeByKey.get(key)!.layout, ref.layout)) {
        layoutChanges.push({ folderId, kind: ref.kind, targetId: ref.targetId, layout: ref.layout })
      }
    }
  }

  // 同一身份从一处消失、在另一处出现且各只有一处：收敛为「挪夹」。
  const handled = new Set<string>()
  for (const [key, fromFolders] of removedByIdentity) {
    const toFolders = addedByIdentity.get(key)
    if (toFolders && fromFolders.length === 1 && toFolders.length === 1 && fromFolders[0] !== toFolders[0]) {
      const { kind, targetId } = splitIdentityKey(key)
      ops.push({ type: 'moveItem', fromFolderId: fromFolders[0], toFolderId: toFolders[0], kind, targetId })
      handled.add(key)
    }
  }
  for (const [key, folders] of removedByIdentity) {
    if (handled.has(key)) continue
    const { kind, targetId } = splitIdentityKey(key)
    for (const folderId of folders) ops.push({ type: 'removeItem', folderId, kind, targetId })
  }
  for (const [key, folders] of addedByIdentity) {
    if (handled.has(key)) continue
    const { kind, targetId } = splitIdentityKey(key)
    for (const folderId of folders) ops.push({ type: 'addItem', folderId, kind, targetId })
  }
  for (const change of layoutChanges) ops.push({ type: 'updateItemLayout', ...change })

  // 排序：与「追加式新增」的预期顺序比对，只有相对顺序真的变了才报排序，避免无谓写入。
  for (const folderId of commonFolderIds) {
    const beforeList = liveRefs(refsOf(prev, folderId))
    const afterList = liveRefs(refsOf(next, folderId))
    if (afterList.length <= 1) continue
    const beforeKeys = beforeList.map(ref => identityKey(ref.kind, ref.targetId))
    const afterKeys = afterList.map(ref => identityKey(ref.kind, ref.targetId))
    const beforeSet = new Set(beforeKeys)
    const afterSet = new Set(afterKeys)
    const expected: string[] = []
    for (const key of beforeKeys) if (afterSet.has(key)) expected.push(key)
    for (const key of afterKeys) if (!beforeSet.has(key)) expected.push(key)
    if (expected.length === afterKeys.length && expected.every((key, index) => key === afterKeys[index])) continue
    ops.push({
      type: 'reorderItems',
      folderId,
      ordered: afterList.map(ref => ({ kind: ref.kind, targetId: ref.targetId })),
    })
  }

  return ops
}

export function createFavoritesLedger(
  gateway: HyperCortexGateway,
  scope: VaultScope,
  options: { onError?: (message: string) => void } = {},
): FavoritesLedger {
  let current: HyperCortexFavoritesDocV1 | null = null

  const dispatch = (op: FavoritesOp): void => {
    const promise = (() => {
      switch (op.type) {
        case 'createFolder':
          return gateway.favorites.createFolder(scope, op.parentId, op.title, op.description, op.id)
        case 'updateFolder':
          return gateway.favorites.updateFolder(scope, op.folderId, { title: op.title, description: op.description })
        case 'deleteFolder':
          return gateway.favorites.deleteFolder(scope, op.folderId)
        case 'addItem':
          return gateway.favorites.addItem(scope, op.folderId, op.kind, op.targetId)
        case 'removeItem':
          return gateway.favorites.removeItem(scope, op.folderId, op.kind, op.targetId)
        case 'moveItem':
          return gateway.favorites.moveItem(scope, op.fromFolderId, op.toFolderId, op.kind, op.targetId)
        case 'reorderItems':
          return gateway.favorites.reorderItems(scope, op.folderId, op.ordered)
        case 'updateItemLayout':
          return gateway.favorites.updateItemLayout(scope, op.folderId, op.kind, op.targetId, op.layout)
      }
    })()
    void Promise.resolve(promise).catch((error: unknown) => {
      options.onError?.(String((error as any)?.message || error || '收藏夹写入失败'))
    })
  }

  const load = async (): Promise<HyperCortexFavoritesDocV1> => {
    const doc = await gateway.favorites.ensureFavorites(scope)
    current = doc
    return doc
  }

  const adopt = (doc: HyperCortexFavoritesDocV1): void => {
    current = doc
  }

  const commit = (next: HyperCortexFavoritesDocV1): void => {
    const prev = current
    current = next
    if (!prev) return
    for (const op of diffFavorites(prev, next)) dispatch(op)
  }

  return { load, adopt, commit }
}
