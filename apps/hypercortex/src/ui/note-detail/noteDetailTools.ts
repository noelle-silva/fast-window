import type { HyperCortexNoteResourceRef } from '../../noteSchema'

/** 笔记详情会话的纯工具：基础类型、字段规范化与脏比较。 */

export type NoteFaceId = string

export type NoteBaseFields = {
  title: string
  description: string
  tags: string[]
  resources: HyperCortexNoteResourceRef[]
}

export function normalizeTagText(value: string): string {
  return String(value || '').trim()
}

export function appendTag(list: string[], raw: string): string[] {
  const tag = normalizeTagText(raw)
  if (!tag) return list
  if (list.includes(tag)) return list
  return [...list, tag]
}

export function areStringListsEqual(a: string[], b: string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/** 笔记级字段的脏比较：资源清单不参与（与迁移前一致）。 */
export function areNoteBaseFieldsEqual(a: NoteBaseFields, b: NoteBaseFields): boolean {
  return a.title === b.title && a.description === b.description && areStringListsEqual(a.tags, b.tags)
}
