import { now } from '../core/utils'
import { chatListItemsOfBox } from './chatListOrdering'
import { favoriteChatRefKey } from './favorites'
import { workspaceIconImageSrc } from './workspaceIcon'
import { workspaceRoleTargetId } from './workspaceRoleTarget'

// 工作桌面：一个有序的会话引用列表，与收藏夹同构（同一套会话引用键、同一套打开方式），
// 区别只在用途：收藏夹负责归档分类，桌面只管「现在摆在手边」。
// 桌面只持有引用，不动会话本体；会话被删除时由清理入口摘掉对应引用。

export type DeskTargetKind = 'role' | 'group' | 'workspace'

export type DeskChatRef = {
  targetKind: DeskTargetKind
  targetId: string
  roleId: string
  chatId: string
  addedAt: number
}

export type DeskData = { refs: DeskChatRef[] }

// 桌面是客户端偏好的一部分：和侧边栏布局一样存在 settings 里，随偏好通道落盘。
export const DESK_SETTING_KEY = 'desk'

function normalizeTargetKind(raw: unknown): DeskTargetKind {
  const text = String(raw ?? '').trim()
  return text === 'group' ? 'group' : text === 'workspace' ? 'workspace' : 'role'
}

// 会话引用键：与收藏夹走同一份规则，两处对「同一个会话」的判定不会分叉。
export function deskChatRefKey(ref: { targetKind?: unknown; targetId?: unknown; roleId?: unknown; chatId?: unknown } | null | undefined): string {
  return favoriteChatRefKey(ref?.targetKind, ref?.targetId, ref?.roleId, ref?.chatId)
}

export function normalizeDeskChatRef(raw: any): DeskChatRef | null {
  if (!raw || typeof raw !== 'object') return null
  const targetKind = normalizeTargetKind(raw.targetKind)
  const targetId = String(raw.targetId || '').trim()
  const roleId = targetKind === 'workspace' ? String(raw.roleId || '').trim() : ''
  const chatId = String(raw.chatId || '').trim()
  if (!targetId || !chatId) return null
  if (targetKind === 'workspace' && !roleId) return null
  return {
    targetKind,
    targetId,
    roleId,
    chatId,
    addedAt: Number(raw.addedAt || now()),
  }
}

export function normalizeDesk(raw: any): DeskData {
  const src = raw && typeof raw === 'object' ? raw : {}
  const list = Array.isArray((src as any).refs) ? (src as any).refs : []
  const refs: DeskChatRef[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const ref = normalizeDeskChatRef(item)
    if (!ref) continue
    const key = deskChatRefKey(ref)
    if (!key || seen.has(key)) continue
    seen.add(key)
    refs.push(ref)
    if (refs.length >= 2000) break
  }
  return { refs }
}

export function resolveDeskData(settings: any): DeskData {
  const box = settings && typeof settings === 'object' ? settings : {}
  return normalizeDesk((box as any)[DESK_SETTING_KEY])
}

// 添加到桌面末尾；已经在桌上就原样返回，避免重复条目与顺序抖动。
export function upsertDeskChatRef(refs: readonly DeskChatRef[], raw: any): DeskChatRef[] {
  const next = Array.isArray(refs) ? refs.slice() : []
  const ref = normalizeDeskChatRef(raw)
  if (!ref) return next
  const key = deskChatRefKey(ref)
  if (next.some((it) => deskChatRefKey(it) === key)) return next
  next.push(ref)
  return next
}

export function removeDeskChatRef(refs: readonly DeskChatRef[], raw: any): DeskChatRef[] {
  const key = deskChatRefKey(normalizeDeskChatRef(raw) || (raw as any))
  const next = Array.isArray(refs) ? refs.slice() : []
  if (!key) return next
  return next.filter((it) => deskChatRefKey(it) !== key)
}

// 会话被删除：摘掉所有指向它的引用。
export function removeDeskRefsForChat(refs: readonly DeskChatRef[], targetKind: unknown, targetId: unknown, roleId: unknown, chatId: unknown): DeskChatRef[] {
  const key = favoriteChatRefKey(targetKind, targetId, roleId, chatId)
  const next = Array.isArray(refs) ? refs.slice() : []
  if (!key) return next
  return next.filter((it) => deskChatRefKey(it) !== key)
}

// 只知道会话标识时的清理：会话标识全局唯一，按它摘除即可，
// 用于删除事实只带 kind/targetId/chatId、不带角色的工作区路径。
export function removeDeskRefsByChatId(refs: readonly DeskChatRef[], chatId: unknown): DeskChatRef[] {
  const cid = String(chatId || '').trim()
  const next = Array.isArray(refs) ? refs.slice() : []
  if (!cid) return next
  return next.filter((it) => it.chatId !== cid)
}

// 目标（角色 / 群 / 工作区）被删除：摘掉该目标下的全部引用。
export function removeDeskRefsForTarget(refs: readonly DeskChatRef[], targetKind: unknown, targetId: unknown): DeskChatRef[] {
  const kind = normalizeTargetKind(targetKind)
  const tid = String(targetId || '').trim()
  const next = Array.isArray(refs) ? refs.slice() : []
  if (!tid) return next
  return next.filter((it) => !(it.targetKind === kind && it.targetId === tid))
}

// 桌面内拖动排序：把 active 挪到 over 的位置上（按下标整体重排，其余保持相对次序）。
export function moveDeskChatRef(refs: readonly DeskChatRef[], activeKey: string, overKey: string): DeskChatRef[] {
  const next = Array.isArray(refs) ? refs.slice() : []
  const from = next.findIndex((it) => deskChatRefKey(it) === String(activeKey || ''))
  const to = next.findIndex((it) => deskChatRefKey(it) === String(overKey || ''))
  if (from < 0 || to < 0 || from === to) return next
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

// 桌面条目：引用 + 渲染所需的标题、来源与头像（会话本体可能还没加载，标题从索引取）。
export type DeskEntry = DeskChatRef & {
  key: string
  title: string
  targetName: string
  avatarImage: string
}

function chatItemsOf(data: any, ref: DeskChatRef): any[] {
  if (ref.targetKind === 'workspace') {
    return chatListItemsOfBox(data?.chatsByWorkspace?.[workspaceRoleTargetId(ref.targetId, ref.roleId)])
  }
  if (ref.targetKind === 'group') return chatListItemsOfBox(data?.chatsByGroup?.[ref.targetId])
  return chatListItemsOfBox(data?.chatsByRole?.[ref.targetId])
}

function targetMetaOf(data: any, ref: DeskChatRef): { name: string; avatarImage: string } {
  if (ref.targetKind === 'workspace') {
    const workspace = (Array.isArray(data?.workspaces) ? data.workspaces : []).find((it: any) => String(it?.id || '') === ref.targetId)
    // 工作区图标是独立资源，必须经 workspaceIconImageSrc 转成可渲染地址，否则条目左侧一片空白。
    return { name: String(workspace?.name || '工作区'), avatarImage: workspaceIconImageSrc(workspace?.icon) }
  }
  if (ref.targetKind === 'group') {
    const group = (Array.isArray(data?.groups) ? data.groups : []).find((it: any) => String(it?.id || '') === ref.targetId)
    return { name: String(group?.name || '群聊'), avatarImage: String(group?.avatarImage || '') }
  }
  const role = (Array.isArray(data?.roles) ? data.roles : []).find((it: any) => String(it?.id || '') === ref.targetId)
  return { name: String(role?.name || '角色'), avatarImage: String(role?.avatarImage || '') }
}

export function resolveDeskEntries(data: any, refs: readonly DeskChatRef[]): DeskEntry[] {
  const out: DeskEntry[] = []
  for (const ref of Array.isArray(refs) ? refs : []) {
    const key = deskChatRefKey(ref)
    if (!key) continue
    const chat = chatItemsOf(data, ref).find((it: any) => String(it?.id || '') === ref.chatId)
    const meta = targetMetaOf(data, ref)
    out.push({
      ...ref,
      key,
      title: String(chat?.title || '').trim() || '新聊天',
      targetName: meta.name,
      avatarImage: meta.avatarImage,
    })
  }
  return out
}
