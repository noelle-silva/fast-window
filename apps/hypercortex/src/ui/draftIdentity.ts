import * as React from 'react'
import type { NoteMeta } from '../core'
import { isDraftNoteId } from '../drafts'
import type { FavoriteItemRef, HyperCortexFavoritesDocV1 } from '../favorites'
import { noteIdFromTabKey, noteTabKey, tabKind } from '../tabKey'
import type { SidebarItem } from './sidebarModel'
import type { NoteDetailSnapshotV1 } from './NoteDetailSession'

/**
 * 草稿身份档案：草稿「是否草稿、元数据、初始快照、归属侧、转正后的新标识」的唯一内存事实源。
 * 只活在界面内存，草稿身份不落盘；转正落盘仍由既有唯一写盘通道完成，档案不直接写盘。
 * 消费方（打开的标签、解析名单、收藏夹引用）一律向档案查询，不再各自保存草稿副本。
 */

/** 草稿归属侧：左侧标签栏或右侧收藏夹。 */
export type DraftSide = 'tabs' | 'favorites'

/** 草稿诞生所需的档案内容。 */
export type DraftRecordInput = {
  meta: NoteMeta
  initSnapshot: NoteDetailSnapshotV1
  side: DraftSide
}

type DraftRecord = {
  meta: NoteMeta
  side: DraftSide
  /** 转正后指向的真实笔记标识；未转正为空。 */
  successorId: string | null
}

export type DraftIdentity = {
  /** 草稿诞生：登记元数据、初始快照与归属侧。 */
  register(input: DraftRecordInput): void
  /** 草稿转正：档案内把标识改指向真实笔记（可带上新会话初始快照），消费方据此自动跟随迁移。 */
  promote(draftId: string, noteId: string, initSnapshotForNewId?: NoteDetailSnapshotV1): void
  /** 草稿放弃或关闭：档案注销，消费方据此自动清理，不留幽灵条目。 */
  discard(draftId: string): void
  /** 标识解析：已转正草稿返回真实笔记标识，其余原样返回。 */
  resolveId(noteId: string): string
  /** 是否在册草稿（含已转正）；草稿标识但从未登记返回 false。 */
  isKnownDraft(noteId: string): boolean
  /** 在册且未转正草稿的归属侧。 */
  getSide(noteId: string): DraftSide | null
  /** 登记一笔待装载的会话初始快照（非草稿的新建笔记也走这里）。 */
  putInitSnapshot(noteId: string, snapshot: NoteDetailSnapshotV1): void
  /** 取走会话初始快照（会话首次装载消费一次）。 */
  takeInitSnapshot(noteId: string): NoteDetailSnapshotV1 | null
  /** 在册且未转正的草稿清单，供解析名单与打开标签合并。 */
  listLiveDrafts(): { id: string; meta: NoteMeta }[]
  /** 订阅档案变化（useSyncExternalStore 入口）。 */
  subscribe(listener: () => void): () => void
  /** 档案版本号（订阅快照）。 */
  getVersion(): number
}

export function createDraftIdentity(): DraftIdentity {
  const records = new Map<string, DraftRecord>()
  const pendingSnapshots = new Map<string, NoteDetailSnapshotV1>()
  const listeners = new Set<() => void>()
  let version = 0

  const normalizeId = (value: unknown): string => String(value || '').trim()

  const emit = (): void => {
    version += 1
    for (const listener of Array.from(listeners)) listener()
  }

  const liveRecord = (noteId: string): DraftRecord | null => {
    const id = normalizeId(noteId)
    if (!id) return null
    const record = records.get(id)
    if (!record || record.successorId) return null
    return record
  }

  return {
    register(input) {
      const id = normalizeId(input?.meta?.id)
      if (!id) return
      records.set(id, { meta: input.meta, side: input.side, successorId: null })
      pendingSnapshots.set(id, input.initSnapshot)
      emit()
    },
    promote(draftId, noteId, initSnapshotForNewId) {
      const id = normalizeId(draftId)
      const next = normalizeId(noteId)
      if (!id || !next || id === next) return
      const record = records.get(id)
      if (!record) return
      record.successorId = next
      pendingSnapshots.delete(id)
      if (initSnapshotForNewId) pendingSnapshots.set(next, initSnapshotForNewId)
      emit()
    },
    discard(draftId) {
      const id = normalizeId(draftId)
      if (!id) return
      let changed = records.delete(id) || pendingSnapshots.delete(id)
      // 已转正草稿：按转正后的新标识回找原记录一并注销，避免档案里留下永久别名。
      for (const [key, record] of records) {
        if (record.successorId === id) {
          records.delete(key)
          changed = true
        }
      }
      if (changed) emit()
    },
    resolveId(noteId) {
      const id = normalizeId(noteId)
      if (!id) return ''
      return records.get(id)?.successorId || id
    },
    isKnownDraft(noteId) {
      const id = normalizeId(noteId)
      return !!id && records.has(id)
    },
    getSide(noteId) {
      return liveRecord(noteId)?.side || null
    },
    putInitSnapshot(noteId, snapshot) {
      const id = normalizeId(noteId)
      if (!id) return
      pendingSnapshots.set(id, snapshot)
    },
    takeInitSnapshot(noteId) {
      const id = normalizeId(noteId)
      if (!id) return null
      const snapshot = pendingSnapshots.get(id)
      if (!snapshot) return null
      pendingSnapshots.delete(id)
      return snapshot
    },
    listLiveDrafts() {
      const out: { id: string; meta: NoteMeta }[] = []
      for (const [id, record] of records) {
        if (record.successorId) continue
        out.push({ id, meta: record.meta })
      }
      return out
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getVersion() {
      return version
    },
  }
}

/** 订阅档案版本：档案变化即触发消费方重渲染。 */
export function useDraftIdentityVersion(identity: DraftIdentity): number {
  return React.useSyncExternalStore(
    React.useCallback((listener: () => void) => identity.subscribe(listener), [identity]),
    () => identity.getVersion(),
    () => identity.getVersion(),
  )
}

/**
 * 收藏夹引用的草稿目标解析：草稿标识未在册（已放弃）返回 null 表示剔除，
 * 已转正返回真实标识，在册未转正原样返回；非草稿标识原样返回。
 */
export function resolveDraftRefTarget(identity: DraftIdentity, targetId: string): string | null {
  const id = String(targetId || '').trim()
  if (!isDraftNoteId(id)) return id
  if (!identity.isKnownDraft(id)) return null
  return identity.resolveId(id)
}

/** 标签键的草稿解析：已转正草稿的 note 键改指向真实笔记键，其余原样返回。 */
export function resolveDraftTabKey(identity: DraftIdentity, tabKey: string): string {
  const key = String(tabKey || '').trim()
  if (tabKind(key) !== 'note') return key
  const id = noteIdFromTabKey(key)
  const resolved = identity.resolveId(id)
  return resolved && resolved !== id ? noteTabKey(resolved) : key
}

/**
 * 按档案调和左侧标签栏条目：草稿标签已转正改指向真实笔记键，已放弃剔除，未转正原样保留。
 * 返回同一引用表示无变化，调用方可据此跳过写盘。
 */
export function reconcileDraftSidebarItems(identity: DraftIdentity, items: SidebarItem[]): SidebarItem[] {
  let changed = false
  const seen = new Set<string>()
  const mapTabKey = (rawKey: string): string => {
    const key = String(rawKey || '').trim()
    if (tabKind(key) !== 'note') return key
    const id = noteIdFromTabKey(key)
    if (isDraftNoteId(id) && !identity.isKnownDraft(id)) return ''
    const resolved = resolveDraftTabKey(identity, key)
    return resolved
  }
  const next: SidebarItem[] = []
  for (const item of items) {
    if (item.type === 'tab') {
      const mapped = mapTabKey(item.tabKey)
      if (!mapped) {
        changed = true
        continue
      }
      if (seen.has(mapped)) {
        changed = true
        continue
      }
      seen.add(mapped)
      if (mapped !== item.tabKey) {
        changed = true
        next.push({ type: 'tab', tabKey: mapped })
      } else {
        next.push(item)
      }
      continue
    }
    let groupChanged = false
    const tabKeys: string[] = []
    for (const rawKey of item.tabKeys) {
      const mapped = mapTabKey(rawKey)
      if (!mapped) {
        groupChanged = true
        continue
      }
      if (seen.has(mapped)) {
        groupChanged = true
        continue
      }
      seen.add(mapped)
      if (mapped !== rawKey) groupChanged = true
      tabKeys.push(mapped)
    }
    if (groupChanged) {
      changed = true
      next.push({ ...item, tabKeys })
    } else {
      next.push(item)
    }
  }
  return changed ? next : items
}

/**
 * 按档案调和收藏夹引用：草稿引用已转正则把目标改指向真实笔记，已放弃则剔除，未转正原样保留。
 * 这是收藏夹消费方「向档案查询」的唯一入口；调和后按 (kind,targetId) 去重，不留幽灵条目。
 */
export function reconcileDraftNoteRefs(identity: DraftIdentity, doc: HyperCortexFavoritesDocV1): HyperCortexFavoritesDocV1 {
  let changed = false
  const nextRefsByFolderId: Record<string, FavoriteItemRef[]> = {}
  for (const [folderId, refs] of Object.entries(doc.refsByFolderId)) {
    const list = Array.isArray(refs) ? refs : []
    const seen = new Set<string>()
    const nextList: FavoriteItemRef[] = []
    for (const ref of list) {
      let target = ref
      if (ref.kind === 'note' && isDraftNoteId(ref.targetId)) {
        const resolved = resolveDraftRefTarget(identity, ref.targetId)
        if (resolved === null) {
          changed = true
          continue
        }
        if (resolved !== ref.targetId) {
          target = { ...ref, targetId: resolved }
          changed = true
        }
      }
      const key = `${target.kind}:${target.targetId}`
      if (seen.has(key)) {
        changed = true
        continue
      }
      seen.add(key)
      nextList.push(target)
    }
    nextRefsByFolderId[folderId] = nextList
  }
  return changed ? { ...doc, refsByFolderId: nextRefsByFolderId } : doc
}
