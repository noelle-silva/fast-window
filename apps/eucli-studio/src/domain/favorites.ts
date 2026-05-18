import { now, uid } from '../core/utils'

export function favoriteChatRefKey(targetKind: any, targetId: any, chatId: any) {
  const kind = String(targetKind || '').trim() === 'group' ? 'group' : 'role'
  const tid = String(targetId || '').trim()
  const cid = String(chatId || '').trim()
  if (!tid || !cid) return ''
  return `${kind}::${tid}::${cid}`
}

export function normalizeFavoriteFolder(input: any) {
  const raw = input && typeof input === 'object' ? input : {}
  const id = String((raw as any).id || uid('favf')).trim() || uid('favf')
  let name = String((raw as any).name || '').replace(/\s+/g, ' ').trim()
  if (!name) name = '未命名文件夹'
  if (name.length > 60) name = name.slice(0, 60).trim() || '未命名文件夹'
  const createdAt = Number((raw as any).createdAt || now())
  const updatedAt = Number((raw as any).updatedAt || createdAt || now())
  const parentId0 = String((raw as any).parentId || '').trim()
  return {
    id,
    name,
    parentId: parentId0 && parentId0 !== id ? parentId0 : '',
    createdAt,
    updatedAt,
  }
}

export function normalizeFavoriteChatRef(input: any) {
  const raw = input && typeof input === 'object' ? input : null
  if (!raw) return null
  const targetKind = String((raw as any).targetKind || '').trim() === 'group' ? 'group' : 'role'
  const targetId = String((raw as any).targetId || '').trim()
  const chatId = String((raw as any).chatId || '').trim()
  if (!targetId || !chatId) return null
  return {
    targetKind,
    targetId,
    chatId,
    addedAt: Number((raw as any).addedAt || now()),
  }
}

export function normalizeFavorites(raw: any) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const folders0 = Array.isArray((src as any).folders) ? (src as any).folders : []
  const folders: any[] = []
  const folderIdSet = new Set<string>()
  for (const it of folders0) {
    const f = normalizeFavoriteFolder(it)
    if (!f.id || folderIdSet.has(f.id)) continue
    folderIdSet.add(f.id)
    folders.push(f)
    if (folders.length >= 1000) break
  }

  const parentMap = new Map<string, string>()
  for (const f of folders) parentMap.set(String(f.id || ''), String(f.parentId || ''))
  for (const f of folders) {
    let pid = String(f.parentId || '').trim()
    if (!pid || !folderIdSet.has(pid) || pid === String(f.id || '')) {
      f.parentId = ''
      continue
    }
    const seen = new Set<string>([String(f.id || '')])
    let cur = pid
    let ok = true
    while (cur) {
      if (!folderIdSet.has(cur) || seen.has(cur)) {
        ok = false
        break
      }
      seen.add(cur)
      cur = String(parentMap.get(cur) || '').trim()
    }
    if (!ok) f.parentId = ''
  }

  const refs0 = (src as any).chatRefsByFolderId && typeof (src as any).chatRefsByFolderId === 'object' ? (src as any).chatRefsByFolderId : {}
  const chatRefsByFolderId: Record<string, any[]> = {}
  for (const f of folders) {
    const fid = String(f.id || '')
    const list0 = Array.isArray((refs0 as any)[fid]) ? (refs0 as any)[fid] : []
    const list: any[] = []
    const seen = new Set<string>()
    for (const it of list0) {
      const ref = normalizeFavoriteChatRef(it)
      if (!ref) continue
      const key = favoriteChatRefKey(ref.targetKind, ref.targetId, ref.chatId)
      if (!key || seen.has(key)) continue
      seen.add(key)
      list.push(ref)
      if (list.length >= 5000) break
    }
    chatRefsByFolderId[fid] = list
  }

  return { folders, chatRefsByFolderId }
}

export function collectFavoriteFolderSubtreeIds(folders: any[], parentId: any): string[] {
  const rootId = String(parentId || '').trim()
  if (!rootId) return []
  const out: string[] = []
  const stack = [rootId]
  while (stack.length) {
    const cur = String(stack.pop() || '').trim()
    if (!cur || out.includes(cur)) continue
    out.push(cur)
    for (const f of folders) {
      if (String((f as any)?.parentId || '').trim() === cur) stack.push(String((f as any)?.id || '').trim())
    }
  }
  return out
}
