import { now } from '../core/utils'
import { chatListItemsOfBox } from './chatListOrdering'
import { favoriteChatRefKey, normalizeFavoriteChatRef, normalizeFavoriteFolder } from './favorites'
import { SESSION_REF_PENDING_TITLE } from './sessionRefPlaceholder'
import { workspaceIconImageSrc } from './workspaceIcon'
import { workspaceRoleTargetId } from './workspaceRoleTarget'

// 工作桌面：后端 eucli-box 里的 sessions/desks.json（类型 SessionDesks），
// 与会话收藏夹（sessions/favorites.json / SessionFavorites）逐字段同构，但两类数据各自独立。
// 客户端只负责读写这一份数据，不另存副本：增删改之后写回同一条存储通道。
// 眼下的用法是平铺——所有引用挂在一个固定的根收藏夹下；结构本身支持层级，用的时候加收藏夹即可。

export const DESK_ROOT_FOLDER_ID = 'desk-root'
export const DESK_ROOT_FOLDER_NAME = '桌面'

export type DeskTargetKind = 'role' | 'group' | 'workspace'

export type SessionDesks = {
  folders: any[]
  chatRefsByFolderId: Record<string, any[]>
}

// 桌面条目的悬停换图标开关属于客户端外观偏好，跟着设置走，不进后端数据。
export const DESK_HOVER_ROLE_ICON_SETTING_KEY = 'deskHoverShowsRoleIcon'
export const DESK_HOVER_ROLE_ICON_DEFAULT = true

export function normalizeDeskHoverRoleIcon(raw: unknown): boolean {
  if (raw === undefined || raw === null) return DESK_HOVER_ROLE_ICON_DEFAULT
  return raw === true
}

export function defaultDesks(): SessionDesks {
  return { folders: [], chatRefsByFolderId: {} }
}

// 归一化：与收藏夹同一套规则（收藏夹去重、父子关系自愈、引用校验与去重）。
export function normalizeDesks(raw: any): SessionDesks {
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
    const pid = String(f.parentId || '').trim()
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

  const refs0 =
    (src as any).chatRefsByFolderId && typeof (src as any).chatRefsByFolderId === 'object'
      ? (src as any).chatRefsByFolderId
      : {}
  const chatRefsByFolderId: Record<string, any[]> = {}
  for (const f of folders) {
    const fid = String(f.id || '')
    const list0 = Array.isArray((refs0 as any)[fid]) ? (refs0 as any)[fid] : []
    const list: any[] = []
    const seen = new Set<string>()
    for (const it of list0) {
      const ref = normalizeFavoriteChatRef(it)
      if (!ref) continue
      const key = favoriteChatRefKey(ref.targetKind, ref.targetId, ref.roleId, ref.chatId)
      if (!key || seen.has(key)) continue
      seen.add(key)
      list.push(ref)
      if (list.length >= 5000) break
    }
    chatRefsByFolderId[fid] = list
  }

  return { folders, chatRefsByFolderId }
}

// 平铺用法需要一个根收藏夹承载引用；第一次写入时补上，之后原样复用。
export function ensureDeskRoot(desks: SessionDesks): SessionDesks {
  if (desks.folders.some((f) => String(f?.id || '') === DESK_ROOT_FOLDER_ID)) {
    const next = {
      ...desks,
      chatRefsByFolderId: {
        ...desks.chatRefsByFolderId,
        [DESK_ROOT_FOLDER_ID]: Array.isArray(desks.chatRefsByFolderId[DESK_ROOT_FOLDER_ID])
          ? desks.chatRefsByFolderId[DESK_ROOT_FOLDER_ID]
          : [],
      },
    }
    return next
  }
  const t = now()
  return {
    folders: [
      { id: DESK_ROOT_FOLDER_ID, name: DESK_ROOT_FOLDER_NAME, parentId: '', createdAt: t, updatedAt: t },
      ...desks.folders,
    ],
    chatRefsByFolderId: { ...desks.chatRefsByFolderId, [DESK_ROOT_FOLDER_ID]: [] },
  }
}

// 顶层清单：眼下桌面就是根收藏夹下这一串引用。
export function deskFlatRefs(desks: SessionDesks | null | undefined): any[] {
  const list = Array.isArray(desks?.chatRefsByFolderId?.[DESK_ROOT_FOLDER_ID])
    ? desks!.chatRefsByFolderId[DESK_ROOT_FOLDER_ID]
    : []
  const out: any[] = []
  for (const item of list) {
    const ref = normalizeFavoriteChatRef(item)
    if (ref) out.push(ref)
  }
  return out
}

export function setDeskFlatRefs(desks: SessionDesks, refs: readonly any[]): SessionDesks {
  const withRoot = ensureDeskRoot(desks)
  return {
    ...withRoot,
    chatRefsByFolderId: { ...withRoot.chatRefsByFolderId, [DESK_ROOT_FOLDER_ID]: [...refs] },
  }
}

// index 省略时追加到末尾；给出时插在该位置（临时条目转正靠它保住原位）。
export function addDeskRef(desks: SessionDesks, raw: any, index?: number): { desks: SessionDesks; added: boolean } {
  const ref = normalizeFavoriteChatRef(raw)
  const withRoot = ensureDeskRoot(desks)
  if (!ref) return { desks: withRoot, added: false }
  const refs = deskFlatRefs(withRoot)
  const key = favoriteChatRefKey(ref.targetKind, ref.targetId, ref.roleId, ref.chatId)
  if (refs.some((it) => favoriteChatRefKey(it.targetKind, it.targetId, it.roleId, it.chatId) === key)) {
    return { desks: withRoot, added: false }
  }
  const next = refs.slice()
  const at = typeof index === 'number' && isFinite(index) ? Math.max(0, Math.min(Math.floor(index), next.length)) : next.length
  next.splice(at, 0, ref)
  return { desks: setDeskFlatRefs(withRoot, next), added: true }
}

export function removeDeskRef(desks: SessionDesks, raw: any): SessionDesks {
  const ref = normalizeFavoriteChatRef(raw)
  const withRoot = ensureDeskRoot(desks)
  if (!ref) return withRoot
  const key = favoriteChatRefKey(ref.targetKind, ref.targetId, ref.roleId, ref.chatId)
  return setDeskFlatRefs(
    withRoot,
    deskFlatRefs(withRoot).filter(
      (it) => favoriteChatRefKey(it.targetKind, it.targetId, it.roleId, it.chatId) !== key,
    ),
  )
}

export function moveDeskRef(desks: SessionDesks, activeKey: string, overKey: string): SessionDesks {
  const withRoot = ensureDeskRoot(desks)
  const refs = deskFlatRefs(withRoot)
  const from = refs.findIndex((it) => favoriteChatRefKey(it.targetKind, it.targetId, it.roleId, it.chatId) === String(activeKey || ''))
  const to = refs.findIndex((it) => favoriteChatRefKey(it.targetKind, it.targetId, it.roleId, it.chatId) === String(overKey || ''))
  if (from < 0 || to < 0 || from === to) return withRoot
  const next = refs.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return setDeskFlatRefs(withRoot, next)
}

function mapAllRefs(desks: SessionDesks, map: (refs: any[]) => any[]): SessionDesks {
  const next: Record<string, any[]> = {}
  for (const folderId of Object.keys(desks.chatRefsByFolderId || {})) {
    next[folderId] = map(Array.isArray(desks.chatRefsByFolderId[folderId]) ? desks.chatRefsByFolderId[folderId] : [])
  }
  return { ...desks, chatRefsByFolderId: next }
}

export function removeDeskRefsByChatId(desks: SessionDesks, chatId: unknown): SessionDesks {
  const cid = String(chatId || '').trim()
  if (!cid) return desks
  return mapAllRefs(desks, (refs) => refs.filter((it: any) => String(it?.chatId || '') !== cid))
}

export function removeDeskRefsForTarget(desks: SessionDesks, targetKind: unknown, targetId: unknown): SessionDesks {
  const kindText = String(targetKind || '').trim()
  const kind = kindText === 'group' ? 'group' : kindText === 'workspace' ? 'workspace' : 'role'
  const tid = String(targetId || '').trim()
  if (!tid) return desks
  return mapAllRefs(desks, (refs) =>
    refs.filter((it: any) => !(String(it?.targetKind || '').trim() === kind && String(it?.targetId || '').trim() === tid)),
  )
}

// 桌面条目：引用 + 渲染所需的标题、来源与头像（会话本体可能还没加载，标题从索引取）。
//
// status 是「这条引用的事实到位了吗」的唯一判据：
//   loaded  该 target 的会话索引已在内存，title 是真实标题；
//   pending 会话事实还没进内存（典型是别的工作区 / 别的角色组合），title 只是占位。
// 判据只认「盒子里有没有这条会话」，绝不用标题值反推——「新聊天」本身也是合法标题。
export type DeskEntryStatus = 'loaded' | 'pending'

export type DeskEntry = {
  targetKind: DeskTargetKind
  targetId: string
  roleId: string
  chatId: string
  addedAt: number
  key: string
  status: DeskEntryStatus
  title: string
  targetName: string
  roleName: string
  avatarImage: string
  roleAvatarImage: string
}

// 会话事实缺失时的标题兜底，口径与后端 buildSessionIndex 的 fallbackTitle 一致。
function chatFallbackTitle(kind: DeskTargetKind): string {
  if (kind === 'group') return '群聊'
  if (kind === 'workspace') return '工作区会话'
  return '新聊天'
}

function chatItemsOf(data: any, ref: any): any[] {
  if (ref.targetKind === 'workspace') {
    return chatListItemsOfBox(data?.chatsByWorkspace?.[workspaceRoleTargetId(ref.targetId, ref.roleId)])
  }
  if (ref.targetKind === 'group') return chatListItemsOfBox(data?.chatsByGroup?.[ref.targetId])
  return chatListItemsOfBox(data?.chatsByRole?.[ref.targetId])
}

function findRole(data: any, roleId: string): any {
  return (Array.isArray(data?.roles) ? data.roles : []).find((it: any) => String(it?.id || '') === roleId) || null
}

function targetMetaOf(data: any, ref: any) {
  if (ref.targetKind === 'workspace') {
    const workspace = (Array.isArray(data?.workspaces) ? data.workspaces : []).find(
      (it: any) => String(it?.id || '') === ref.targetId,
    )
    const role = findRole(data, ref.roleId)
    return {
      name: String(workspace?.name || '工作区'),
      roleName: String(role?.name || ''),
      avatarImage: workspaceIconImageSrc(workspace?.icon),
      roleAvatarImage: String(role?.avatarImage || ''),
    }
  }
  if (ref.targetKind === 'group') {
    const group = (Array.isArray(data?.groups) ? data.groups : []).find((it: any) => String(it?.id || '') === ref.targetId)
    return {
      name: String(group?.name || '群聊'),
      roleName: '',
      avatarImage: String(group?.avatarImage || ''),
      roleAvatarImage: '',
    }
  }
  const role = findRole(data, ref.targetId)
  return {
    name: String(role?.name || '角色'),
    roleName: '',
    avatarImage: String(role?.avatarImage || ''),
    roleAvatarImage: '',
  }
}

export function resolveDeskEntries(data: any, desks: SessionDesks | null | undefined): DeskEntry[] {
  const out: DeskEntry[] = []
  for (const ref of deskFlatRefs(desks)) {
    const key = favoriteChatRefKey(ref.targetKind, ref.targetId, ref.roleId, ref.chatId)
    if (!key) continue
    const chat = chatItemsOf(data, ref).find((it: any) => String(it?.id || '') === ref.chatId)
    const meta = targetMetaOf(data, ref)
    const status: DeskEntryStatus = chat ? 'loaded' : 'pending'
    out.push({
      targetKind: ref.targetKind,
      targetId: ref.targetId,
      roleId: ref.roleId,
      chatId: ref.chatId,
      addedAt: Number(ref.addedAt || 0),
      key,
      status,
      title:
        status === 'loaded'
          ? String(chat?.title || '').trim() || chatFallbackTitle(ref.targetKind)
          : SESSION_REF_PENDING_TITLE,
      targetName: meta.name,
      roleName: meta.roleName,
      avatarImage: meta.avatarImage,
      roleAvatarImage: meta.roleAvatarImage,
    })
  }
  return out
}
