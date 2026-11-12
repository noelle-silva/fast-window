import { now, uid } from '../core/utils'
import { chatListItemsOfBox } from './chatListOrdering'
import { favoriteChatRefKey, normalizeFavoriteChatRef } from './favorites'
import { latestContextTokens, normalizeMessageContextTokens } from './message'
import { SESSION_REF_PENDING_TITLE } from './sessionRefPlaceholder'
import { sessionRefBox, sessionRefIdentity } from './sessionRefScope'
import { workspaceIconImageSrc } from './workspaceIcon'

// 工作桌面：后端 eucli-box 里的 sessions/desks.json（类型 SessionDesks）。
//
// 事实是一条有序清单：每一项要么是一条会话引用，要么是一个分组。
// 客户端只读写这一份数据，不另存副本：改完写回同一条存储通道。
//
// 旧版是两层结构（folders + chatRefsByFolderId），读取时一次性摊平迁移，写入只产出 items。
// 分组数据会原样读进来、原样写回去，但这版界面还只显示顶层的会话项。

export type DeskTargetKind = 'role' | 'group' | 'workspace'

export type DeskChatRef = {
  targetKind: DeskTargetKind
  targetId: string
  roleId: string
  chatId: string
  addedAt: number
}

export type DeskGroup = {
  id: string
  name: string
  color: string
  collapsed: boolean
  chats: DeskChatRef[]
  createdAt: number
  updatedAt: number
}

export type DeskItem =
  | { type: 'chat'; chat: DeskChatRef }
  | { type: 'group'; group: DeskGroup }

export type SessionDesks = { items: DeskItem[] }

// 桌面条目的悬停换图标开关属于客户端外观偏好，跟着设置走，不进后端数据。
export const DESK_HOVER_ROLE_ICON_SETTING_KEY = 'deskHoverShowsRoleIcon'
export const DESK_HOVER_ROLE_ICON_DEFAULT = true

export function normalizeDeskHoverRoleIcon(raw: unknown): boolean {
  if (raw === undefined || raw === null) return DESK_HOVER_ROLE_ICON_DEFAULT
  return raw === true
}

export function defaultDesks(): SessionDesks {
  return { items: [] }
}

// 分组颜色是受限的样式标记，与后端同一条规则：只收 #hex 或 css 颜色函数。
const DESK_GROUP_COLOR_MAX = 40
const DESK_GROUP_COLOR_PATTERN = /^(#[0-9a-fA-F]{3,8}|(hsl|hsla|rgb|rgba)\(\s*[0-9.,%\s]+\))$/
export const DESK_GROUP_NAME_MAX = 60

function normalizeDeskGroupColor(value: unknown): string {
  const color = String(value ?? '').trim()
  if (!color || color.length > DESK_GROUP_COLOR_MAX || !DESK_GROUP_COLOR_PATTERN.test(color)) return ''
  return color
}

/**
 * 归一化工作桌面。
 *
 * 认两种形态：
 *   - items            当前形态，唯一事实
 *   - folders + refs   旧版形态，读到时一次性摊平
 * 判断依据是「字段在不在」，不是「空不空」——空清单是合法的空桌面。
 */
export function normalizeDesks(raw: any): SessionDesks {
  const src = raw && typeof raw === 'object' ? raw : {}
  const items = Array.isArray((src as any).items)
    ? normalizeDeskItems((src as any).items)
    : migrateLegacyDesks(src)
  return { items }
}

const LEGACY_DESK_ROOT_FOLDER_ID = 'desk-root'

function migrateLegacyDesks(src: any): DeskItem[] {
  const folders = Array.isArray(src?.folders) ? src.folders : []
  const refsByFolder = src?.chatRefsByFolderId && typeof src.chatRefsByFolderId === 'object' ? src.chatRefsByFolderId : {}
  const items: DeskItem[] = []
  const seen = new Set<string>()

  for (const folder of folders) {
    if (!folder || typeof folder !== 'object') continue
    const folderId = String((folder as any).id || '').trim()
    if (!folderId) continue
    const refs = Array.isArray(refsByFolder[folderId]) ? refsByFolder[folderId] : []

    if (folderId === LEGACY_DESK_ROOT_FOLDER_ID) {
      for (const raw of refs) {
        const chat = takeDeskChat(raw, seen)
        if (chat) items.push({ type: 'chat', chat })
      }
      continue
    }

    const group = normalizeDeskGroup({ ...(folder as any), chats: refs }, seen)
    if (group) items.push({ type: 'group', group })
  }
  return items
}

function normalizeDeskItems(rawItems: any[]): DeskItem[] {
  const items: DeskItem[] = []
  const seen = new Set<string>()

  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue
    const type = String((raw as any).type || '').trim()

    if (type === 'chat') {
      const chat = takeDeskChat((raw as any).chat, seen)
      if (chat) items.push({ type: 'chat', chat })
      continue
    }

    if (type === 'group') {
      const group = normalizeDeskGroup((raw as any).group, seen)
      if (group) items.push({ type: 'group', group })
    }
  }
  return items
}

/** 归一化一条会话引用；已出现过的引用直接丢掉，保证桌面上一条会话只有一处。 */
function takeDeskChat(raw: any, seen: Set<string>): DeskChatRef | null {
  const chat = normalizeFavoriteChatRef(raw) as DeskChatRef | null
  if (!chat) return null
  const key = deskChatKey(chat)
  if (!key || seen.has(key)) return null
  seen.add(key)
  return chat
}

function normalizeDeskGroup(raw: any, seen: Set<string>): DeskGroup | null {
  if (!raw || typeof raw !== 'object') return null

  const id = String((raw as any).id || '').trim() || uid('deskg')
  let name = String((raw as any).name || '').replace(/\s+/g, ' ').trim()
  if (!name) name = '分组'
  if (name.length > DESK_GROUP_NAME_MAX) name = name.slice(0, DESK_GROUP_NAME_MAX).trim() || '分组'

  const createdAt = Number((raw as any).createdAt || 0) || now()
  const updatedAt = Number((raw as any).updatedAt || 0) || createdAt
  const rawChats = Array.isArray((raw as any).chats) ? (raw as any).chats : []
  const chats: DeskChatRef[] = []
  for (const item of rawChats) {
    const chat = takeDeskChat(item, seen)
    if (chat) chats.push(chat)
  }

  return {
    id,
    name,
    color: normalizeDeskGroupColor((raw as any).color),
    collapsed: (raw as any).collapsed === true,
    chats,
    createdAt,
    updatedAt,
  }
}

export function deskChatKey(ref: DeskChatRef | null | undefined): string {
  if (!ref) return ''
  return favoriteChatRefKey(ref.targetKind, ref.targetId, ref.roleId, ref.chatId)
}

// ---------------------------------------------------------------- 读取

/** 桌面上平铺的那一串会话：只取顶层条目，分组里的成员不在这里。 */
export function deskFlatRefs(desks: SessionDesks | null | undefined): DeskChatRef[] {
  const out: DeskChatRef[] = []
  for (const item of desks?.items || []) {
    if (item.type === 'chat') out.push(item.chat)
  }
  return out
}

/** 桌面上全部会话引用，含分组里的成员。清理类动作用它，避免漏掉组内条目。 */
export function deskAllRefs(desks: SessionDesks | null | undefined): DeskChatRef[] {
  const out: DeskChatRef[] = []
  for (const item of desks?.items || []) {
    if (item.type === 'chat') out.push(item.chat)
    else out.push(...item.group.chats)
  }
  return out
}

// ---------------------------------------------------------------- 原子动作

// index 省略时追加到末尾；给出时插在该位置（临时条目转正靠它保住原位）。
// index 指的是「第几条顶层会话」，分组项不参与计数。
export function addDeskRef(desks: SessionDesks, raw: any, index?: number): { desks: SessionDesks; added: boolean } {
  const chat = normalizeFavoriteChatRef(raw) as DeskChatRef | null
  if (!chat) return { desks, added: false }
  const key = deskChatKey(chat)
  if (!key || deskAllRefs(desks).some((item) => deskChatKey(item) === key)) {
    return { desks, added: false }
  }

  const items = desks.items.slice()
  const chatPositions: number[] = []
  items.forEach((item, position) => {
    if (item.type === 'chat') chatPositions.push(position)
  })

  const at =
    typeof index === 'number' && isFinite(index)
      ? index < chatPositions.length
        ? chatPositions[Math.max(0, Math.floor(index))]
        : items.length
      : items.length

  items.splice(at, 0, { type: 'chat', chat })
  return { desks: { items }, added: true }
}

/** 从桌面上摘掉一条会话引用，顶层和组内成员都算。 */
export function removeDeskRef(desks: SessionDesks, raw: any): SessionDesks {
  const chat = normalizeFavoriteChatRef(raw) as DeskChatRef | null
  const key = deskChatKey(chat)
  if (!key) return desks

  let touched = false
  const items = desks.items.flatMap((item): DeskItem[] => {
    if (item.type === 'chat') {
      if (deskChatKey(item.chat) !== key) return [item]
      touched = true
      return []
    }
    const chats = item.group.chats.filter((entry) => deskChatKey(entry) !== key)
    if (chats.length === item.group.chats.length) return [item]
    touched = true
    return [{ type: 'group', group: { ...item.group, chats, updatedAt: now() } }]
  })
  return touched ? { items } : desks
}

// 顶层之间换位：分组项保持原位不动，会话项按新旧位置重排。
export function moveDeskRef(desks: SessionDesks, activeKey: string, overKey: string): SessionDesks {
  const items = desks.items.slice()
  const from = items.findIndex((item) => item.type === 'chat' && deskChatKey(item.chat) === String(activeKey || ''))
  const to = items.findIndex((item) => item.type === 'chat' && deskChatKey(item.chat) === String(overKey || ''))
  if (from < 0 || to < 0 || from === to) return desks
  const [moved] = items.splice(from, 1)
  if (!moved) return desks
  items.splice(to, 0, moved)
  return { items }
}

function mapAllRefs(desks: SessionDesks, keep: (ref: DeskChatRef) => boolean): SessionDesks {
  let touched = false
  const items = desks.items.flatMap((item): DeskItem[] => {
    if (item.type === 'chat') {
      if (keep(item.chat)) return [item]
      touched = true
      return []
    }
    const chats = item.group.chats.filter(keep)
    if (chats.length === item.group.chats.length) return [item]
    touched = true
    return [{ type: 'group', group: { ...item.group, chats, updatedAt: now() } }]
  })
  return touched ? { items } : desks
}

export function removeDeskRefsByChatId(desks: SessionDesks, chatId: unknown): SessionDesks {
  const cid = String(chatId || '').trim()
  if (!cid) return desks
  return mapAllRefs(desks, (chat) => String(chat.chatId || '') !== cid)
}

export function removeDeskRefsForTarget(desks: SessionDesks, targetKind: unknown, targetId: unknown): SessionDesks {
  const kindText = String(targetKind || '').trim()
  const kind = kindText === 'group' ? 'group' : kindText === 'workspace' ? 'workspace' : 'role'
  const tid = String(targetId || '').trim()
  if (!tid) return desks
  return mapAllRefs(desks, (chat) => !(chat.targetKind === kind && chat.targetId === tid))
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
  // contextTokens 是这条会话已使用的上下文规模；0 表示上游没有真值，不在展示层估算。
  contextTokens: number
}

// 会话事实缺失时的标题兜底，口径与后端 buildSessionIndex 的 fallbackTitle 一致。
function chatFallbackTitle(kind: DeskTargetKind): string {
  if (kind === 'group') return '群聊'
  if (kind === 'workspace') return '工作区会话'
  return '新聊天'
}

function chatBoxOf(data: any, ref: any): any {
  const identity = sessionRefIdentity(ref)
  return identity ? sessionRefBox(data, identity) : null
}

// 会话已使用的上下文规模沿用既有口径：最后一条带真值的消息（消息行、输入框也读这一份）。
// 正文已经在内存就按这条正文链算——流式期间它比索引新；正文不在内存时用索引 meta 上
// 后端按整份会话算好的值。两处都为 0 就是没有真值。
function deskContextTokensOf(box: any, indexedChat: any, chatId: string): number {
  const body = (Array.isArray(box?.chats) ? box.chats : []).find((it: any) => String(it?.id || '') === chatId) || null
  const fromBody = latestContextTokens(body?.messages)
  if (fromBody > 0) return fromBody
  return normalizeMessageContextTokens(indexedChat?.contextTokens)
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

/** 解析一条会话引用。顶层和组内成员共用这一份，形状完全一致。 */
export function resolveDeskEntry(data: any, ref: DeskChatRef): DeskEntry | null {
  const key = favoriteChatRefKey(ref.targetKind, ref.targetId, ref.roleId, ref.chatId)
  if (!key) return null
  const box = chatBoxOf(data, ref)
  const chat = chatListItemsOfBox(box).find((it: any) => String(it?.id || '') === ref.chatId)
  const meta = targetMetaOf(data, ref)
  const status: DeskEntryStatus = chat ? 'loaded' : 'pending'
  return {
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
    contextTokens: deskContextTokensOf(box, chat, ref.chatId),
  }
}

/** 顶层那条序列的条目。组内成员不在这里，按需用 resolveDeskEntry 单独解析。 */
export function resolveDeskEntries(data: any, desks: SessionDesks | null | undefined): DeskEntry[] {
  const out: DeskEntry[] = []
  for (const ref of deskFlatRefs(desks)) {
    const entry = resolveDeskEntry(data, ref)
    if (entry) out.push(entry)
  }
  return out
}

// ---------------------------------------------------------------- 列表结构
//
// 列表要渲染的是「单元 + 它挂着的成员」，不是一堆散条目。
// 这里把后端那份清单翻成渲染层直接能用的形状，界面不再自己拼。

export type DeskChatRowView = { kind: 'chat'; rowId: string; entry: DeskEntry }

export type DeskGroupRowView = {
  kind: 'group'
  rowId: string
  group: DeskGroup
  chats: DeskChatRowView[]
}

export type DeskRow = DeskChatRowView | DeskGroupRowView

export function resolveDeskRows(data: any, desks: SessionDesks | null | undefined): DeskRow[] {
  const out: DeskRow[] = []
  for (const item of desks?.items || []) {
    if (item.type === 'chat') {
      const entry = resolveDeskEntry(data, item.chat)
      if (entry) out.push({ kind: 'chat', rowId: deskChatRowId(entry.key), entry })
      continue
    }
    const chats: DeskChatRowView[] = []
    for (const ref of item.group.chats) {
      const entry = resolveDeskEntry(data, ref)
      if (entry) chats.push({ kind: 'chat', rowId: deskChatRowId(entry.key), entry })
    }
    out.push({ kind: 'group', rowId: deskGroupRowId(item.group.id), group: item.group, chats })
  }
  return out
}

// ---------------------------------------------------------------- 分组与混排

// 分组色板：20 个色相等距的中间饱和色。存的是颜色本身，落地时由界面按主题与纸面混合。
export const DESK_GROUP_PRESET_COLORS: readonly string[] = Array.from({ length: 20 }, (_item, index) => {
  const hue = Math.round((360 / 20) * index)
  return `hsl(${hue}, 58%, 58%)`
})

export const DESK_GROUP_DEFAULT_COLOR = DESK_GROUP_PRESET_COLORS[0]

const DESK_CHAT_ROW_PREFIX = 'desk-chat:'
const DESK_GROUP_ROW_PREFIX = 'desk-group:'

// 行标识：列表渲染与拖拽排序共用一把 id。
// 会话行按引用键区分（同一条会话在桌面上只出现一次），分组行按分组 id 区分。
export function deskChatRowId(refKey: string): string {
  return `${DESK_CHAT_ROW_PREFIX}${String(refKey || '')}`
}

export function deskGroupRowId(groupId: string): string {
  return `${DESK_GROUP_ROW_PREFIX}${String(groupId || '')}`
}

export type DeskRowRef = { kind: 'chat'; refKey: string } | { kind: 'group'; groupId: string }

export function parseDeskRowId(value: string): DeskRowRef | null {
  const raw = String(value || '')
  if (raw.startsWith(DESK_CHAT_ROW_PREFIX)) {
    const refKey = raw.slice(DESK_CHAT_ROW_PREFIX.length)
    return refKey ? { kind: 'chat', refKey } : null
  }
  if (raw.startsWith(DESK_GROUP_ROW_PREFIX)) {
    const groupId = raw.slice(DESK_GROUP_ROW_PREFIX.length)
    return groupId ? { kind: 'group', groupId } : null
  }
  return null
}

export function deskItemRowId(item: DeskItem): string {
  return item.type === 'chat' ? deskChatRowId(deskChatKey(item.chat)) : deskGroupRowId(item.group.id)
}

export function deskGroups(desks: SessionDesks | null | undefined): DeskGroup[] {
  return (desks?.items || []).flatMap((item) => (item.type === 'group' ? [item.group] : []))
}

export function findDeskGroup(desks: SessionDesks | null | undefined, groupId: unknown): DeskGroup | null {
  const id = String(groupId || '').trim()
  if (!id) return null
  return deskGroups(desks).find((group) => group.id === id) || null
}

function resolveNewGroupName(desired: string | undefined, groups: readonly DeskGroup[]): string {
  const text = String(desired ?? '').replace(/\s+/g, ' ').trim()
  if (text) return text.length > DESK_GROUP_NAME_MAX ? text.slice(0, DESK_GROUP_NAME_MAX).trim() : text
  const used = new Set(groups.map((group) => group.name))
  for (let index = 1; index <= 999; index += 1) {
    const name = `分组 ${index}`
    if (!used.has(name)) return name
  }
  return '分组'
}

function nextGroupColor(groups: readonly DeskGroup[]): string {
  const used = new Set(groups.map((group) => group.color).filter(Boolean))
  for (const color of DESK_GROUP_PRESET_COLORS) {
    if (!used.has(color)) return color
  }
  return DESK_GROUP_PRESET_COLORS[groups.length % DESK_GROUP_PRESET_COLORS.length] || DESK_GROUP_DEFAULT_COLOR
}

/** 新建一个分组：追加到清单末尾，名字与颜色取当前没用过的最小值。 */
export function createDeskGroup(desks: SessionDesks, input: { name?: string; color?: string } = {}): SessionDesks {
  const groups = deskGroups(desks)
  const stamp = now()
  const group: DeskGroup = {
    id: uid('deskg'),
    name: resolveNewGroupName(input.name, groups),
    color: normalizeDeskGroupColor(input.color) || nextGroupColor(groups),
    collapsed: false,
    chats: [],
    createdAt: stamp,
    updatedAt: stamp,
  }
  return { items: [...desks.items, { type: 'group', group }] }
}

/**
 * 改名 / 换色。颜色传空串是「清掉已有颜色」，与「没传这个字段」是两件事。
 * 名字为空时忽略这一项，不写坏数据。
 */
export function updateDeskGroup(
  desks: SessionDesks,
  groupId: unknown,
  patch: { name?: string; color?: string },
): SessionDesks {
  const id = String(groupId || '').trim()
  if (!id) return desks
  let touched = false
  const items = desks.items.map((item): DeskItem => {
    if (item.type !== 'group' || item.group.id !== id) return item
    const next: DeskGroup = { ...item.group }
    if (typeof patch.name === 'string') {
      const name = patch.name.replace(/\s+/g, ' ').trim()
      if (name) {
        const clipped = name.length > DESK_GROUP_NAME_MAX ? name.slice(0, DESK_GROUP_NAME_MAX).trim() : name
        if (clipped !== item.group.name) {
          next.name = clipped
          touched = true
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'color')) {
      const color = normalizeDeskGroupColor(patch.color)
      if (color !== item.group.color) {
        next.color = color
        touched = true
      }
    }
    if (!touched) return item
    next.updatedAt = now()
    return { type: 'group', group: next }
  })
  return touched ? { items } : desks
}

/** 连成员一起移出桌面：组和它肚子里的会话一起消失。 */
export function removeDeskGroupWithChats(desks: SessionDesks, groupId: unknown): SessionDesks {
  const id = String(groupId || '').trim()
  if (!id) return desks
  const items = desks.items.filter((item) => !(item.type === 'group' && item.group.id === id))
  return items.length === desks.items.length ? desks : { items }
}

/**
 * 解散分组的两种后果。
 *
 * 界面要告诉用户的不是「 gruppo 里有没有东西」，而是「这一下会带走多少、留下多少」。
 * 这份事实只有数据层知道，所以由这里算出来交给界面，界面不再自己拼句子。
 * 以后再加第三种解散方式，只需要在 mode 上加一项，描述自动跟着对。
 */
export type DeskGroupDisbandMode = 'dissolve' | 'remove-with-chats'

export type DeskGroupDisbandPlan = {
  mode: DeskGroupDisbandMode
  groupId: string
  groupName: string
  /** 会从桌面消失的会话条数。 */
  leavingChats: number
  /** 会保留下来、摊平到组原来位置的会话条数。 */
  keepingChats: number
}

export function planDeskGroupDisband(
  desks: SessionDesks | null | undefined,
  groupId: unknown,
  mode: DeskGroupDisbandMode,
): DeskGroupDisbandPlan | null {
  const id = String(groupId || '').trim()
  if (!id) return null
  const group = findDeskGroup(desks, id)
  if (!group) return null
  const total = group.chats.length
  return {
    mode,
    groupId: group.id,
    groupName: group.name,
    leavingChats: mode === 'remove-with-chats' ? total : 0,
    keepingChats: mode === 'dissolve' ? total : 0,
  }
}

/** 仅解散分组：组本身消失，成员按原顺序摊平到组原来的位置。 */
export function dissolveDeskGroup(desks: SessionDesks, groupId: unknown): SessionDesks {
  const id = String(groupId || '').trim()
  if (!id) return desks
  const at = desks.items.findIndex((item) => item.type === 'group' && item.group.id === id)
  if (at < 0) return desks
  const target = desks.items[at]
  if (target.type !== 'group') return desks
  const flat: DeskItem[] = target.group.chats.map((chat) => ({ type: 'chat', chat }))
  const items = desks.items.slice()
  items.splice(at, 1, ...flat)
  return { items }
}

/**
 * 把一个会话放进某个分组的末尾。
 *
 * 空分组没有成员可压，指针只能落在成员区那片空白上，
 * 所以这条路径必须单独存在 —— 它接住的正是「空组」这一种落点。
 */
export function moveDeskUnitToGroupEnd(desks: SessionDesks, activeUnitId: string, groupId: unknown): SessionDesks {
  const id = String(groupId || '').trim()
  if (!id) return desks

  const parsedActive = parseDeskRowId(activeUnitId)
  if (!parsedActive || parsedActive.kind !== 'chat') return desks

  const picked = extractDeskUnit(desks, activeUnitId)
  if (!picked.moved || picked.moved.type !== 'chat') return desks
  const movedChat = picked.moved.chat

  const at = picked.items.findIndex((item) => item.type === 'group' && item.group.id === id)
  if (at < 0) return desks
  const target = picked.items[at]
  if (target.type !== 'group') return desks
  if (target.group.chats.some((chat) => deskChatKey(chat) === deskChatKey(movedChat))) return desks

  const chats = [...target.group.chats, movedChat]
  const items = picked.items.slice()
  items[at] = { type: 'group', group: { ...target.group, chats, updatedAt: now() } }
  return { items }
}

/** 收起 / 展开。折叠只影响成员露不露出来，不改变它在序列里的身份。 */
export function toggleDeskGroupCollapsed(desks: SessionDesks, groupId: unknown): SessionDesks {
  const id = String(groupId || '').trim()
  if (!id) return desks
  let touched = false
  const items = desks.items.map((item): DeskItem => {
    if (item.type !== 'group' || item.group.id !== id) return item
    touched = true
    return { type: 'group', group: { ...item.group, collapsed: !item.group.collapsed, updatedAt: now() } }
  })
  return touched ? { items } : desks
}

// ---------------------------------------------------------------- 单元与换位
//
// 桌面上的每一项都叫「单元」：一条会话，或者一个分组。
// 换位的全部规则压在 moveDeskUnit 里 —— 顶层换位、进出分组、组内换序，
// 走的都是同一条路径，区别只在于「目标单元站在哪一层」。

const DESK_ROOT_CONTAINER = 'root'
const DESK_GROUP_CONTAINER_PREFIX = 'grp:'

/** 这个单元此刻挂在哪一层：'root' 或 'grp:<组 id>'。 */
export function deskUnitContainer(desks: SessionDesks | null | undefined, unitId: string): string | null {
  const parsed = parseDeskRowId(String(unitId || ''))
  if (!parsed) return null
  if (parsed.kind === 'group') return DESK_ROOT_CONTAINER
  for (const item of desks?.items || []) {
    if (item.type === 'chat' && deskChatKey(item.chat) === parsed.refKey) return DESK_ROOT_CONTAINER
    if (item.type === 'group' && item.group.chats.some((chat) => deskChatKey(chat) === parsed.refKey)) {
      return `${DESK_GROUP_CONTAINER_PREFIX}${item.group.id}`
    }
  }
  return null
}

/**
 * 把「指针落在谁身上」翻译成「真正要换到哪一层、哪个位置」。
 *
 * 分组只能待在顶层，所以目标落在某个组的肚子里时，落点改成那个组本身。
 */
function resolveDeskMoveTarget(desks: SessionDesks, activeUnitId: string, overUnitId: string) {
  const parsedActive = parseDeskRowId(activeUnitId)
  if (!parsedActive) return null

  let targetId = overUnitId
  let container = deskUnitContainer(desks, targetId)
  if (!container) return null

  if (parsedActive.kind === 'group' && container !== DESK_ROOT_CONTAINER) {
    targetId = deskGroupRowId(container.slice(DESK_GROUP_CONTAINER_PREFIX.length))
    container = DESK_ROOT_CONTAINER
  }

  return { targetId, container }
}

/** 把单元从它所在的层摘出来。组内成员摘出后统一包装成顶层那种形状。 */
function extractDeskUnit(desks: SessionDesks, unitId: string): { items: DeskItem[]; moved: DeskItem | null } {
  const parsed = parseDeskRowId(unitId)
  if (!parsed) return { items: desks.items, moved: null }

  if (parsed.kind === 'group') {
    const at = desks.items.findIndex((item) => item.type === 'group' && item.group.id === parsed.groupId)
    if (at < 0) return { items: desks.items, moved: null }
    const items = desks.items.slice()
    const [moved] = items.splice(at, 1)
    return { items, moved: moved || null }
  }

  for (let index = 0; index < desks.items.length; index += 1) {
    const item = desks.items[index]
    if (item.type === 'chat' && deskChatKey(item.chat) === parsed.refKey) {
      const items = desks.items.slice()
      const [moved] = items.splice(index, 1)
      return { items, moved: moved || null }
    }
    if (item.type === 'group') {
      const at = item.group.chats.findIndex((chat) => deskChatKey(chat) === parsed.refKey)
      if (at < 0) continue
      const chats = item.group.chats.slice()
      const [chat] = chats.splice(at, 1)
      const items = desks.items.slice()
      items[index] = { type: 'group', group: { ...item.group, chats, updatedAt: now() } }
      return { items, moved: chat ? { type: 'chat', chat } : null }
    }
  }

  return { items: desks.items, moved: null }
}

function deskUnitIndex(items: DeskItem[], unitId: string, container: string): number {
  if (container === DESK_ROOT_CONTAINER) return items.findIndex((item) => deskItemRowId(item) === unitId)
  const groupId = container.slice(DESK_GROUP_CONTAINER_PREFIX.length)
  const at = items.findIndex((item) => item.type === 'group' && item.group.id === groupId)
  if (at < 0) return -1
  const group = items[at]
  if (group.type !== 'group') return -1
  return group.group.chats.findIndex((chat) => deskChatRowId(deskChatKey(chat)) === unitId)
}

function insertDeskUnit(items: DeskItem[], moved: DeskItem, container: string, index: number): DeskItem[] {
  if (container === DESK_ROOT_CONTAINER) {
    const next = items.slice()
    next.splice(index < 0 ? next.length : index, 0, moved)
    return next
  }

  const groupId = container.slice(DESK_GROUP_CONTAINER_PREFIX.length)
  const at = items.findIndex((item) => item.type === 'group' && item.group.id === groupId)
  if (at < 0) return items
  // 组里只装会话，不装组。
  if (moved.type !== 'chat') return items

  const target = items[at]
  if (target.type !== 'group') return items
  const chats = target.group.chats.slice()
  chats.splice(index < 0 ? chats.length : index, 0, moved.chat)
  const next = items.slice()
  next[at] = { type: 'group', group: { ...target.group, chats, updatedAt: now() } }
  return next
}

/**
 * 一次换位。
 *
 * 落点索引必须在「摘出之前」算：摘出一个单元会让它后面的位置整体前移一位，
 * 拿摘出后的索引去插，向下拖永远差一格，看起来就像没动。
 */
export function moveDeskUnit(desks: SessionDesks, activeUnitId: string, overUnitId: string): SessionDesks {
  if (!activeUnitId || !overUnitId || activeUnitId === overUnitId) return desks

  const target = resolveDeskMoveTarget(desks, activeUnitId, overUnitId)
  if (!target) return desks
  if (activeUnitId === target.targetId) return desks

  const dropIndex = deskUnitIndex(desks.items, target.targetId, target.container)
  if (dropIndex < 0) return desks

  const picked = extractDeskUnit(desks, activeUnitId)
  if (!picked.moved) return desks

  const items = insertDeskUnit(picked.items, picked.moved, target.container, dropIndex)
  return items === picked.items ? desks : { items }
}
