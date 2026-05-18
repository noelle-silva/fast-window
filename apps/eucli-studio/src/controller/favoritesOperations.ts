import { now, uid } from '../core/utils'
import { favoriteChatRefKey, collectFavoriteFolderSubtreeIds } from '../domain/favorites'
import { validateFavoriteFolderName } from '../domain/favoriteValidator'

export function createFavoritesOperations(deps: {
  getState: () => any
  save: () => Promise<void>
  emit: () => void
  showToast?: (msg: string) => void
  activeTargetKind: () => string
  activeRole: () => any
  activeGroup: () => any
}) {
  const { getState, save, emit, showToast } = deps

  function ensureFavoritesBare() {
    const data = getState().data
    if (!data) return null
    if (!data.favorites || typeof data.favorites !== 'object') data.favorites = { folders: [], chatRefsByFolderId: {} }
    const fav = data.favorites
    if (!Array.isArray(fav.folders)) fav.folders = []
    if (!fav.chatRefsByFolderId || typeof fav.chatRefsByFolderId !== 'object') fav.chatRefsByFolderId = {}
    return fav
  }

  function getFavoriteFolderIdsForChat(targetKind: any, targetId: any, chatId: any) {
    const fav = ensureFavoritesBare()
    if (!fav) return []
    const key = favoriteChatRefKey(targetKind, targetId, chatId)
    if (!key) return []
    const out: string[] = []
    for (const f of Array.isArray(fav.folders) ? fav.folders : []) {
      const fid = String((f as any)?.id || '').trim()
      if (!fid) continue
      const refs = Array.isArray(fav.chatRefsByFolderId?.[fid]) ? fav.chatRefsByFolderId[fid] : []
      if (refs.some((ref: any) => favoriteChatRefKey(ref?.targetKind, ref?.targetId, ref?.chatId) === key)) out.push(fid)
    }
    return out
  }

  function cleanupFavoriteRefsForChat(targetKind: any, targetId: any, chatId: any) {
    const fav = ensureFavoritesBare()
    if (!fav) return
    const key = favoriteChatRefKey(targetKind, targetId, chatId)
    if (!key) return
    for (const f of Array.isArray(fav.folders) ? fav.folders : []) {
      const fid = String((f as any)?.id || '').trim()
      if (!fid) continue
      const refs = Array.isArray(fav.chatRefsByFolderId?.[fid]) ? fav.chatRefsByFolderId[fid] : []
      fav.chatRefsByFolderId[fid] = refs.filter((ref: any) => favoriteChatRefKey(ref?.targetKind, ref?.targetId, ref?.chatId) !== key)
    }
  }

  function cleanupFavoriteRefsForTarget(targetKind: any, targetId: any) {
    const fav = ensureFavoritesBare()
    if (!fav) return
    const kind = String(targetKind || '').trim() === 'group' ? 'group' : 'role'
    const tid = String(targetId || '').trim()
    if (!tid) return
    for (const f of Array.isArray(fav.folders) ? fav.folders : []) {
      const fid = String((f as any)?.id || '').trim()
      if (!fid) continue
      const refs = Array.isArray(fav.chatRefsByFolderId?.[fid]) ? fav.chatRefsByFolderId[fid] : []
      fav.chatRefsByFolderId[fid] = refs.filter((ref: any) => !(String(ref?.targetKind || '').trim() === kind && String(ref?.targetId || '').trim() === tid))
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
    if (!v.ok) return showToast?.(v.error || '文件夹名无效')
    const pid = String(parentId || '').trim()
    if (pid && !fav.folders.some((f: any) => String(f?.id || '') === pid)) return showToast?.('父文件夹不存在')
    if (favoriteFolderNameExists(v.name)) return showToast?.('文件夹已存在')
    const t = now()
    const id = uid('favf')
    fav.folders = fav.folders.concat([{ id, name: v.name, parentId: pid, createdAt: t, updatedAt: t }])
    fav.chatRefsByFolderId = { ...(fav.chatRefsByFolderId || {}), [id]: [] }
    save().catch(() => {})
    emit()
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
    if (!v.ok) return showToast?.(v.error || '文件夹名无效')
    if (favoriteFolderNameExists(v.name, fid)) return showToast?.('文件夹已存在')
    fav.folders = fav.folders.map((f: any) => (String(f?.id || '') === fid ? { ...f, name: v.name, updatedAt: now() } : f))
    save().catch(() => {})
    emit()
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
    if (!parentId && ownRefs.length && (!moveTargetId || moveTargetId === fid)) return showToast?.('请选择一个目标文件夹来承接内容')
    if (moveTargetId && !fav.folders.some((f: any) => String(f?.id || '') === moveTargetId && String(f?.id || '') !== fid)) {
      return showToast?.('目标文件夹不存在')
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
        const key = favoriteChatRefKey(ref?.targetKind, ref?.targetId, ref?.chatId)
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      })
    }
    try {
      delete nextRefs[fid]
    } catch (_) {}
    fav.chatRefsByFolderId = nextRefs
    save().catch(() => {})
    emit()
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
    save().catch(() => {})
    emit()
  }

  function clearFavoriteFolderRefs(folderId: any) {
    const fav = ensureFavoritesBare()
    if (!fav) return
    const fid = String(folderId || '').trim()
    if (!fid) return
    if (!fav.folders.some((f: any) => String(f?.id || '').trim() === fid)) return
    fav.chatRefsByFolderId = { ...(fav.chatRefsByFolderId || {}), [fid]: [] }
    save().catch(() => {})
    emit()
  }

  function moveFavoriteFolder(folderId: any, nextParentId?: any) {
    const fav = ensureFavoritesBare()
    if (!fav) return
    const fid = String(folderId || '').trim()
    if (!fid) return
    const folder = fav.folders.find((f: any) => String(f?.id || '').trim() === fid) || null
    if (!folder) return showToast?.('文件夹不存在')

    const pid = String(nextParentId || '').trim()
    if (pid === fid) return showToast?.('不能移动到自己下面')
    if (pid) {
      const parent = fav.folders.find((f: any) => String(f?.id || '').trim() === pid) || null
      if (!parent) return showToast?.('目标文件夹不存在')
      const subtree = new Set(collectFavoriteFolderSubtreeIds(fav.folders, fid))
      if (subtree.has(pid)) return showToast?.('不能移动到自己的子文件夹下面')
    }

    const curParentId = String(folder?.parentId || '').trim()
    if (curParentId === pid) return

    fav.folders = fav.folders.map((f: any) => (String(f?.id || '').trim() === fid ? { ...f, parentId: pid, updatedAt: now() } : f))
    save().catch(() => {})
    emit()
  }

  function setChatFavoriteFolders(targetKind: any, targetId: any, chatId: any, folderIds: any) {
    const fav = ensureFavoritesBare()
    if (!fav) return
    const kind = String(targetKind || '').trim() === 'group' ? 'group' : 'role'
    const tid = String(targetId || '').trim()
    const cid = String(chatId || '').trim()
    const key = favoriteChatRefKey(kind, tid, cid)
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
      const next = refs.filter((ref: any) => favoriteChatRefKey(ref?.targetKind, ref?.targetId, ref?.chatId) !== key)
      if (validFolderIds.has(fid)) next.push({ targetKind: kind, targetId: tid, chatId: cid, addedAt })
      fav.chatRefsByFolderId[fid] = next
    }
    save().catch(() => {})
    emit()
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
  }
}
