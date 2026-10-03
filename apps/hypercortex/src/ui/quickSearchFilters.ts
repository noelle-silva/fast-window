import type { AssetSearchQuery, NoteSearchQuery } from '../gateway/types'

/**
 * 快搜过滤条件：笔记与附件各自的勾选集合与请求构造。
 * 事实源在后端：这里的键只作为「用户勾选状态」的承载，可用项由后端搜索目录给出，
 * 前端不内置任何维度或面类型清单。
 */

export type NoteSearchFilters = {
  fields: string[]
  faceKinds: string[]
  folderId: string
  updatedFromMs: number
  updatedToMs: number
}

export type AssetSearchFilters = {
  fields: string[]
  kind: string
  sizeFrom: number
  sizeTo: number
  updatedFromMs: number
  updatedToMs: number
}

export const EMPTY_NOTE_FILTERS: NoteSearchFilters = {
  fields: [],
  faceKinds: [],
  folderId: '',
  updatedFromMs: 0,
  updatedToMs: 0,
}

export const EMPTY_ASSET_FILTERS: AssetSearchFilters = {
  fields: [],
  kind: '',
  sizeFrom: 0,
  sizeTo: 0,
  updatedFromMs: 0,
  updatedToMs: 0,
}

export function hasNoteFilters(filters: NoteSearchFilters): boolean {
  return (
    filters.fields.length > 0 ||
    filters.faceKinds.length > 0 ||
    !!filters.folderId ||
    filters.updatedFromMs > 0 ||
    filters.updatedToMs > 0
  )
}

export function hasAssetFilters(filters: AssetSearchFilters): boolean {
  return (
    filters.fields.length > 0 ||
    !!filters.kind ||
    filters.sizeFrom > 0 ||
    filters.sizeTo > 0 ||
    filters.updatedFromMs > 0 ||
    filters.updatedToMs > 0
  )
}

// 勾选集合切换：命中则移除，未命中则追加，保持稳定顺序。
export function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter(item => item !== value) : [...list, value]
}

// 把「YYYY-MM-DD」解析为当日 00:00 的毫秒；无效输入返回 0（不限）。
export function dateInputToStartMs(value: string): number {
  const text = String(value || '').trim()
  if (!text) return 0
  const parsed = new Date(`${text}T00:00:00`)
  const ms = parsed.getTime()
  return Number.isFinite(ms) ? ms : 0
}

// 把「YYYY-MM-DD」解析为当日 23:59:59.999 的毫秒；无效输入返回 0（不限）。
export function dateInputToEndMs(value: string): number {
  const text = String(value || '').trim()
  if (!text) return 0
  const parsed = new Date(`${text}T23:59:59.999`)
  const ms = parsed.getTime()
  return Number.isFinite(ms) ? ms : 0
}

// 毫秒转「YYYY-MM-DD」输入值；0 返回空串。
export function msToDateInput(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const date = new Date(ms)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// 大小过滤以 KB 呈现、以字节提交：0 表示不限。
export function kbInputToBytes(value: string): number {
  const kb = Number(String(value || '').trim())
  if (!Number.isFinite(kb) || kb <= 0) return 0
  return Math.round(kb * 1024)
}

export function bytesToKbInput(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  return String(Math.round(bytes / 1024))
}

// 请求签名：任一过滤项或关键词变化都会得到不同签名，从而触发整体重搜。
export function noteFiltersSignature(query: string, filters: NoteSearchFilters): string {
  return JSON.stringify([query, filters.fields, filters.faceKinds, filters.folderId, filters.updatedFromMs, filters.updatedToMs])
}

export function assetFiltersSignature(query: string, filters: AssetSearchFilters): string {
  return JSON.stringify([query, filters.fields, filters.kind, filters.sizeFrom, filters.sizeTo, filters.updatedFromMs, filters.updatedToMs])
}

export function buildNoteSearchQuery(
  query: string,
  filters: NoteSearchFilters,
  offset: number,
  limit: number,
): NoteSearchQuery {
  return {
    query: query.trim(),
    fields: filters.fields.length ? filters.fields : undefined,
    faceKinds: filters.faceKinds.length ? filters.faceKinds : undefined,
    folderId: filters.folderId || undefined,
    updatedFromMs: filters.updatedFromMs > 0 ? filters.updatedFromMs : undefined,
    updatedToMs: filters.updatedToMs > 0 ? filters.updatedToMs : undefined,
    limit,
    offset,
  }
}

export function buildAssetSearchQuery(
  query: string,
  filters: AssetSearchFilters,
  offset: number,
  limit: number,
): AssetSearchQuery {
  return {
    query: query.trim(),
    fields: filters.fields.length ? filters.fields : undefined,
    kind: filters.kind || undefined,
    sizeFrom: filters.sizeFrom > 0 ? filters.sizeFrom : undefined,
    sizeTo: filters.sizeTo > 0 ? filters.sizeTo : undefined,
    updatedFromMs: filters.updatedFromMs > 0 ? filters.updatedFromMs : undefined,
    updatedToMs: filters.updatedToMs > 0 ? filters.updatedToMs : undefined,
    limit,
    offset,
  }
}
