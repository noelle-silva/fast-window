import { now, uid } from '../core/utils'

// 工作桌面的分组标签（客户端内存态）。
//
// 本轮不接后端：不读、不写 sessions/desks，只借用桌面列表的渲染与排序位置。
// 进程结束或页面刷新，这里的一切清空，这是本轮的预期行为。
//
// 混排顺序单独存一份 rowId 序列（会话行与会话标签共用一把 id）：
// 会话是从后端来的、分组是这里来的，两边谁增谁减都由「渲染时对齐」兜住。

export type DeskGroupTag = {
  id: string
  name: string
  color: string
}

// 与会话标签同构的色板：低饱和中间色，深浅主题由界面混合，不写死亮度。
export const DESK_GROUP_PRESET_COLORS: readonly string[] = Array.from({ length: 20 }, (_item, index) => {
  const hue = Math.round((360 / 20) * index)
  return `hsl(${hue}, 58%, 58%)`
})

export const DESK_GROUP_DEFAULT_COLOR = DESK_GROUP_PRESET_COLORS[0]
export const DESK_GROUP_NAME_MAX = 60

const DESK_GROUP_ROW_PREFIX = 'desk-group:'

export function deskGroupTagRowId(groupId: string): string {
  return `${DESK_GROUP_ROW_PREFIX}${String(groupId || '')}`
}

type DeskGroupTagsState = {
  groups: DeskGroupTag[]
  /** 混排顺序：`desk-group:<id>` 与 `desk-chat:<refKey>` 混在一起。 */
  order: string[]
}

let state: DeskGroupTagsState = { groups: [], order: [] }
let version = 0
const listeners = new Set<() => void>()

function bump() {
  version += 1
  for (const listener of listeners) listener()
}

export function subscribeDeskGroupTags(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getDeskGroupTagsVersion(): number {
  return version
}

export function getDeskGroupTagsState(): DeskGroupTagsState {
  return { groups: state.groups.map((group) => ({ ...group })), order: state.order.slice() }
}

function normalizeColor(value: unknown): string {
  const color = String(value ?? '').trim()
  if (!color) return ''
  return DESK_GROUP_PRESET_COLORS.includes(color) ? color : ''
}

function nextColor(groups: readonly DeskGroupTag[]): string {
  const used = new Set(groups.map((group) => group.color).filter(Boolean))
  for (const color of DESK_GROUP_PRESET_COLORS) {
    if (!used.has(color)) return color
  }
  return DESK_GROUP_PRESET_COLORS[groups.length % DESK_GROUP_PRESET_COLORS.length] || DESK_GROUP_DEFAULT_COLOR
}

function nextName(groups: readonly DeskGroupTag[]): string {
  const used = new Set(groups.map((group) => group.name))
  for (let index = 1; index <= 999; index += 1) {
    const name = `分组 ${index}`
    if (!used.has(name)) return name
  }
  return '分组'
}

/** 新建一个分组标签：追加到列表末尾，名字与颜色取当前没用过的最小值。 */
export function createDeskGroupTag(): DeskGroupTag {
  const group: DeskGroupTag = {
    id: uid('deskg'),
    name: nextName(state.groups),
    color: nextColor(state.groups),
  }
  state = {
    groups: [...state.groups, group],
    order: [...state.order, deskGroupTagRowId(group.id)],
  }
  bump()
  return { ...group }
}

export function renameDeskGroupTag(groupId: unknown, name: unknown): void {
  const id = String(groupId || '').trim()
  const next = String(name ?? '').replace(/\s+/g, ' ').trim()
  if (!id || !next) return
  const clipped = next.length > DESK_GROUP_NAME_MAX ? next.slice(0, DESK_GROUP_NAME_MAX).trim() : next
  if (!clipped) return
  const groups = state.groups.map((group) => (group.id === id ? { ...group, name: clipped } : group))
  state = { ...state, groups }
  bump()
}

export function setDeskGroupTagColor(groupId: unknown, color: unknown): void {
  const id = String(groupId || '').trim()
  if (!id) return
  const next = normalizeColor(color)
  if (!next) return
  const groups = state.groups.map((group) => (group.id === id ? { ...group, color: next } : group))
  state = { ...state, groups }
  bump()
}

export function removeDeskGroupTag(groupId: unknown): void {
  const id = String(groupId || '').trim()
  if (!id) return
  const rowId = deskGroupTagRowId(id)
  state = {
    groups: state.groups.filter((group) => group.id !== id),
    order: state.order.filter((item) => item !== rowId),
  }
  bump()
}

/** 记录混排顺序；只保留当前还有意义的行，其余在渲染时自动补齐。 */
export function setDeskRowOrder(order: readonly string[]): void {
  const next = order.map((item) => String(item || '').trim()).filter(Boolean)
  if (!next.length && !state.order.length) return
  state = { ...state, order: next }
  bump()
}

export function resetDeskGroupTags(): void {
  if (!state.groups.length && !state.order.length) return
  state = { groups: [], order: [] }
  bump()
}

/** 供界面显示的当前时间戳，避免调用方自己算。 */
export function deskGroupTagStamp(): number {
  return now()
}
