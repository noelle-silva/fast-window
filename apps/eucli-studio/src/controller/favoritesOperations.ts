import { now, uid } from '../core/utils'
import { favoriteChatRefKey, collectFavoriteFolderSubtreeIds } from '../domain/favorites'
import { validateFavoriteFolderName } from '../domain/favoriteValidator'
import { refreshScopes } from '../domain/uiRefreshScope'
import type { AiChatShowToast } from '../gateway/capabilities'

export function createFavoritesOperations(deps: {
  getState: () => any
  save: () => Promise<void>
  emitScope: (scope: string) => void
  showToast?: AiChatShowToast
  activeTargetKind: () => string
  activeRole: () => any
  activeGroup: () => any
}) {
  const { getState, save, emitScope, showToast } = deps

  // 收藏夹只属于 favorites 实体域：树、弹层、收藏标记都按此地址取版本。
  function emitFavorites() {
    emitScope(refreshScopes.entities('favorites'))
  }

  function normalizeTargetKind(targetKind: any) {
    const kindText = String(targetKind || '').trim()
    return kindText === 'group' ? 'group' : kindText === 'workspace' ? 'workspace' : 'role'
  }

  function favoriteRefTarget(targetKind: any, targetId: any, roleId: any) {
    const kind = normalizeTargetKind(targetKind)
    const tid = String(targetId || '').trim()
    if (!tid) return null
    const rid = kind === 'workspace' ? String(roleId || '').trim() : ''
    if (kind === 'workspace' && !rid) return null
    return { kind, targetId: tid, roleId: rid }
  }

  function persistFavorites() {
    save().catch((e: any) => showToast?.(String(e?.message || e || '保存收藏失败'), { kind: 'error' }))
  }

  function ensureFavoritesBare() {
    const data = getState().data
    if (!data) return null
    if (!data.favorites || typeof data.favorites !== 'object') data.favorites = { folders: [], chatRefsByFolderId: {} }
    const fav = data.favorites
    if (!Array.isArray(fav.folders)) fav.folders = []
    if (!fav.chatRefsByFolderId || typeof fav.chatRefsByFolderId !== 'object') fav.chatRefsByFolderId = {}
    return fav
  }

  function getFavoriteFolderIdsForChat(targetKind: any, targetId: any, roleId: any, chatId: any) {
    const fav = ensureFavoritesBare()
    if (!fav) return []
    const target = favoriteRefTarget(targetKind, targetId, roleId)
    if (!target) return []
    const key = favoriteChatRefKey(target.kind, target.targetId, target.roleId, chatId)
    if (!key) return []
    const out: string[] = []
    for (const f of Array.isArray(fav.folders) ? fav.folders : []) {
      const fid = String((f as any)?.id || '').trim()
      if (!fid) continue
      const refs = Array.isArray(fav.chatRefsByFolderId?.[fid]) ? fav.chatRefsByFolderId[fid] : []
      if (refs.some((ref: any) => favoriteChatRefKey(ref?.targetKind, ref?.targetId, ref?.roleId, ref?.chatId) === key)) out.push(fid)
    }
    return out
  }

  function cleanupFavoriteRefsForChat(targetKind: any, targetId: any, roleId: any, chatId: any) {
    const fav = ensureFavoritesBare()
    if (!fav) return
    const target = favoriteRefTarget(targetKind, targetId, roleId)
    if (!target) return
    const key = favoriteChatRefKey(target.kind, target.targetId, target.roleId, chatId)
    if (!key) return
    for (const f of Array.isArray(fav.folders) ? fav.folders : []) {
      const fid = String((f as any)?.id || '').trim()
      if (!fid) continue
      const refs = Array.isArray(fav.chatRefsByFolderId?.[fid]) ? fav.chatRefsByFolderId[fid] : []
      fav.chatRefsByFolderId[fid] = refs.filter((ref: any) => favoriteChatRefKey(ref?.targetKind, ref?.targetId, ref?.roleId, ref?.chatId) !== key)
    }
  }

  function cleanupFavoriteRefsForTarget(targetKind: any, targetId: any) {
    const fav = ensureFavoritesBare()
    if (!fav) return
    const kind = normalizeTargetKind(targetKind)
    const tid = String(targetId || '').trim()
    if (!tid) return
    for (const f of Array.isArray(fav.folders) ? fav.folders : []) {
      const fid = String((f as any)?.id || '').trim()
      if (!fid) continue
      const refs = Array.isArray(fav.chatRefsByFolderId?.[fid]) ? fav.chatRefsByFolderId[fid] : []
      fav.chatRefsByFolderId[fid] = refs.filter((ref: any) => {
        if (String(ref?.targetKind || '').trim() !== kind) return true
        return String(ref?.targetId || '').trim() !== tid
      })
    }
  }

  function favoriteFolderNameExists(name: any, excludeId?: any) {
    const fav = ensureFavoritesBare()
    if (!fav) return false
    const nextName = String(name || '').replace(/\s+/g, ' ').trim().toLowerCase()
    const skipId = String(excludeId || '').trim()
    if (!nextName) return false
    return fav.folders.some((f: any) => {
      const fid = String(f?.id || '').trim()
      if (skipId && fid === skipId) return false
      return String(f?.name || '').replace(/\s+/g, ' ').trim().toLowerCase() === nextName
    })
  }

  function createFavoriteFolder(name: any, parentId?: any) {
    const fav = ensureFavoritesBare()
    if (!fav) return
    const v = validateFavoriteFolderName(name)
    if (!v.ok) return showToast?.(v.error || '文件夹名无效', { kind: 'error' })
    const pid = String(parentId || '').trim()
    if (pid && !fav.folders.some((f: any) => String(f?.id || '') === pid)) return showToast?.('父文件夹不存在', { kind: 'error' })
    if (favoriteFolderNameExists(v.name)) return showToast?.('文件夹已存在', { kind: 'error' })
    const t = now()
    const id = uid('favf')
    fav.folders = fav.folders.concat([{ id, name: v.name, parentId: pid, createdAt: t, updatedAt: t }])
    fav.chatRefsByFolderId = { ...(fav.chatRefsByFolderId || {}), [id]: [] }
    persistFavorites()
    emitFavorites()
    return id
  }

  function renameFavoriteFolder(folderId: any, name: any) {
    const fav = ensureFavoritesBare()
    if (!fav) return
    const fid = String(folderId || '').trim()
    if (!fid) return
    const folder = fav.folders.find((f: any) => String(f?.id || '') === fid) || null
    if (!folder) return
    const v = validateFavoriteFolderName(name)
    if (!v.ok) return showToast?.(v.error || '文件夹名无效', { kind: 'error' })
    if (favoriteFolderNameExists(v.name, fid)) return showToast?.('文件夹已存在', { kind: 'error' })
    fav.folders = fav.folders.map((f: any) => (String(f?.id || '') === fid ? { ...f, name: v.name, updatedAt: now() } : f))
    persistFavorites()
    emitFavorites()
  }

  function deleteFavoriteFolderKeepContents(folderId: any, targetFolderId?: any) {
    const fav = ensureFavoritesBare()
    if (!fav) return
    const fid = String(folderId || '').trim()
    if (!fid) return
    const folder = fav.folders.find((f: any) => String(f?.id || '') === fid) || null
    if (!folder) return
    const parentId = String(folder?.parentId || '').trim()
    const ownRefs = Array.isArray(fav.chatRefsByFolderId?.[fid]) ? fav.chatRefsByFolderId[fid] : []
    const targetIdRaw = String(targetFolderId || '').trim()
    const moveTargetId = parentId || targetIdRaw
    if (!parentId && ownRefs.length && (!moveTargetId || moveTargetId === fid)) return showToast?.('请选择一个目标文件夹来承接内容', { kind: 'error' })
    if (moveTargetId && !fav.folders.some((f: any) => String(f?.id || '') === moveTargetId && String(f?.id || '') !== fid)) {
      return showToast?.('目标文件夹不存在', { kind: 'error' })
    }

    fav.folders = fav.folders
      .filter((f: any) => String(f?.id || '') !== fid)
      .map((f: any) => (String(f?.parentId || '').trim() === fid ? { ...f, parentId: moveTargetId, updatedAt: now() } : f))

    const nextRefs = { ...(fav.chatRefsByFolderId || {}) }
    if (moveTargetId) {
      const prev = Array.isArray(nextRefs[moveTargetId]) ? nextRefs[moveTargetId] : []
      const merged = prev.concat(ownRefs)
      const seen = new Set<string>()
      nextRefs[moveTargetId] = merged.filter((ref: any) => {
        const key = favoriteChatRefKey(ref?.targetKind, ref?.targetId, ref?.roleId, ref?.chatId)
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      })
    }
    try {
      delete nextRefs[fid]
    } catch (_) {}
    fav.chatRefsByFolderId = nextRefs
    persistFavorites()
    emitFavorites()
  }

  function deleteFavoriteFolderTree(folderId: any) {
    const fav = ensureFavoritesBare()
    if (!fav) return
    const ids = new Set(collectFavoriteFolderSubtreeIds(fav.folders, folderId))
    if (!ids.size) return
    fav.folders = fav.folders.filter((f: any) => !ids.has(String(f?.id || '').trim()))
    const nextRefs = { ...(fav.chatRefsByFolderId || {}) }
    for (const id of ids) {
      try {
        delete nextRefs[id]
      } catch (_) {}
    }
    fav.chatRefsByFolderId = nextRefs
    persistFavorites()
    emitFavorites()
  }

  function clearFavoriteFolderRefs(folderId: any) {
    const fav = ensureFavoritesBare()
    if (!fav) return
    const fid = String(folderId || '').trim()
    if (!fid) return
    if (!fav.folders.some((f: any) => String(f?.id || '').trim() === fid)) return
    fav.chatRefsByFolderId = { ...(fav.chatRefsByFolderId || {}), [fid]: [] }
    persistFavorites()
    emitFavorites()
  }

  function moveFavoriteFolder(folderId: any, nextParentId?: any) {
    const fav = ensureFavoritesBare()
    if (!fav) return
    const fid = String(folderId || '').trim()
    if (!fid) return
    const folder = fav.folders.find((f: any) => String(f?.id || '').trim() === fid) || null
    if (!folder) return showToast?.('文件夹不存在', { kind: 'error' })

    const pid = String(nextParentId || '').trim()
    if (pid === fid) return showToast?.('不能移动到自己下面', { kind: 'error' })
    if (pid) {
      const parent = fav.folders.find((f: any) => String(f?.id || '').trim() === pid) || null
      if (!parent) return showToast?.('目标文件夹不存在', { kind: 'error' })
      const subtree = new Set(collectFavoriteFolderSubtreeIds(fav.folders, fid))
      if (subtree.has(pid)) return showToast?.('不能移动到自己的子文件夹下面', { kind: 'error' })
    }

    const curParentId = String(folder?.parentId || '').trim()
    if (curParentId === pid) return

    fav.folders = fav.folders.map((f: any) => (String(f?.id || '').trim() === fid ? { ...f, parentId: pid, updatedAt: now() } : f))
    persistFavorites()
    emitFavorites()
  }

  function setChatFavoriteFolders(targetKind: any, targetId: any, roleId: any, chatId: any, folderIds: any) {
    const fav = ensureFavoritesBare()
    if (!fav) return
    const target = favoriteRefTarget(targetKind, targetId, roleId)
    if (!target) return
    const kind = target.kind
    const tid = target.targetId
    const rid = target.roleId
    const cid = String(chatId || '').trim()
    const key = favoriteChatRefKey(kind, tid, rid, cid)
    if (!key) return
    const validFolderIds = new Set(
      (Array.isArray(folderIds) ? folderIds : [])
        .map((x: any) => String(x || '').trim())
        .filter((x: string) => !!x && fav.folders.some((f: any) => String(f?.id || '') === x)),
    )
    const addedAt = now()
    for (const f of Array.isArray(fav.folders) ? fav.folders : []) {
      const fid = String((f as any)?.id || '').trim()
      if (!fid) continue
      const refs = Array.isArray(fav.chatRefsByFolderId?.[fid]) ? fav.chatRefsByFolderId[fid] : []
      const next = refs.filter((ref: any) => favoriteChatRefKey(ref?.targetKind, ref?.targetId, ref?.roleId, ref?.chatId) !== key)
      if (validFolderIds.has(fid)) next.push({ targetKind: kind, targetId: tid, roleId: rid, chatId: cid, addedAt })
      fav.chatRefsByFolderId[fid] = next
    }
    persistFavorites()
    emitFavorites()
  }

  /** 同一父层下的文件夹重排：只换这些文件夹在扁平表里的占位顺序，其他层不受影响。 */
  function reorderFavoriteFolders(parentId: any, orderedFolderIds: any) {
    const fav = ensureFavoritesBare()
    if (!fav) return
    const pid = String(parentId || '').trim()
    const siblings = fav.folders.filter((f: any) => String(f?.parentId || '').trim() === pid)
    if (siblings.length < 2) return
    const byId = new Map<string, any>(siblings.map((f: any) => [String(f?.id || '').trim(), f]))
    const order = (Array.isArray(orderedFolderIds) ? orderedFolderIds : [])
      .map((id: any) => String(id || '').trim())
      .filter((id: string) => byId.has(id))
    if (!order.length) return

    // 提交序列以界面上看得到的项为准；同层未列出的文件夹按原顺序补在后面。
    const orderedSet = new Set(order)
    const next = [
      ...order.map((id: string) => byId.get(id)),
      ...siblings.filter((f: any) => !orderedSet.has(String(f?.id || '').trim())),
    ]

    let cursor = 0
    fav.folders = fav.folders.map((f: any) => {
      if (String(f?.parentId || '').trim() !== pid) return f
      return next[cursor++] || f
    })
    persistFavorites()
    emitFavorites()
  }

  /** 层内会话引用重排：只认界面上看得到的引用，失效引用不参与排序。 */
  function reorderFavoriteChatRefs(folderId: any, orderedRefKeys: any) {
    const fav = ensureFavoritesBare()
    if (!fav) return
    const fid = String(folderId || '').trim()
    if (!fid || !fav.folders.some((f: any) => String(f?.id || '') === fid)) return
    const refs = Array.isArray(fav.chatRefsByFolderId?.[fid]) ? fav.chatRefsByFolderId[fid] : []
    const refKeyOf = (ref: any) => favoriteChatRefKey(ref?.targetKind, ref?.targetId, ref?.roleId, ref?.chatId)
    const byKey = new Map<string, any>(
      refs.map((ref: any) => [refKeyOf(ref), ref]),
    )
    const order = (Array.isArray(orderedRefKeys) ? orderedRefKeys : [])
      .map((key: any) => String(key || '').trim())
      .filter((key: string) => byKey.has(key))
    if (!refs.length || !order.length) return

    // 界面上看不到的引用（会话已失效）按原顺序补在末尾，不能被它们卡住整层排序。
    const orderedSet = new Set(order)
    fav.chatRefsByFolderId = {
      ...(fav.chatRefsByFolderId || {}),
      [fid]: [
        ...order.map((key: string) => byKey.get(key)),
        ...refs.filter((ref: any) => !orderedSet.has(refKeyOf(ref))),
      ],
    }
    persistFavorites()
    emitFavorites()
  }

  /** 把一条会话引用移进目标收藏夹，落在该层末尾；已在目标里则不动。 */
  function moveFavoriteChatRef(refKey: any, targetFolderId: any) {
    const fav = ensureFavoritesBare()
    if (!fav) return
    const key = String(refKey || '').trim()
    const targetId = String(targetFolderId || '').trim()
    if (!key || !targetId) return
    if (!fav.folders.some((f: any) => String(f?.id || '') === targetId)) return

    const refKeyOf = (ref: any) => favoriteChatRefKey(ref?.targetKind, ref?.targetId, ref?.roleId, ref?.chatId)
    let moving: any = null
    for (const f of Array.isArray(fav.folders) ? fav.folders : []) {
      const fid = String((f as any)?.id || '').trim()
      const refs = Array.isArray(fav.chatRefsByFolderId?.[fid]) ? fav.chatRefsByFolderId[fid] : []
      const found = refs.find((ref: any) => refKeyOf(ref) === key)
      if (found) {
        moving = found
        break
      }
    }
    if (!moving) return

    const next: Record<string, any[]> = {}
    for (const f of Array.isArray(fav.folders) ? fav.folders : []) {
      const fid = String((f as any)?.id || '').trim()
      if (!fid) continue
      const refs = Array.isArray(fav.chatRefsByFolderId?.[fid]) ? fav.chatRefsByFolderId[fid] : []
      next[fid] = refs.filter((ref: any) => refKeyOf(ref) !== key)
    }
    next[targetId] = [...(next[targetId] || []), moving]
    fav.chatRefsByFolderId = next
    persistFavorites()
    emitFavorites()
  }

  return {
    ensureFavoritesBare,
    getFavoriteFolderIdsForChat,
    cleanupFavoriteRefsForChat,
    cleanupFavoriteRefsForTarget,
    favoriteFolderNameExists,
    createFavoriteFolder,
    renameFavoriteFolder,
    deleteFavoriteFolderKeepContents,
    deleteFavoriteFolderTree,
    clearFavoriteFolderRefs,
    moveFavoriteFolder,
    setChatFavoriteFolders,
    reorderFavoriteFolders,
    reorderFavoriteChatRefs,
    moveFavoriteChatRef,
  }
}
