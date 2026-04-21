import { assetRefKey } from './assetTypes'

export type TabKey = string
export type TabKind = 'note' | 'asset' | ''

export function noteTabKey(noteId: string): TabKey {
  const nid = String(noteId || '').trim()
  return `note:${nid}`
}

export function assetTabKeyFromRef(assetRef: { assetId: string; ext: string }): TabKey {
  return `asset:${assetRefKey(assetRef)}`
}

export function tabKind(key: string): TabKind {
  const s = String(key || '').trim()
  if (s.startsWith('note:')) return 'note'
  if (s.startsWith('asset:')) return 'asset'
  return ''
}

export function isNoteTabKey(key: string): boolean {
  return tabKind(key) === 'note'
}

export function isAssetTabKey(key: string): boolean {
  return tabKind(key) === 'asset'
}

export function noteIdFromTabKey(key: string): string {
  const s = String(key || '').trim()
  if (!s.startsWith('note:')) return ''
  return s.slice('note:'.length).trim()
}

export function assetRefKeyFromTabKey(key: string): string {
  const s = String(key || '').trim()
  if (!s.startsWith('asset:')) return ''
  return s.slice('asset:'.length).trim()
}

export function parseAssetRefKey(refKey: string): { assetId: string; ext: string } | null {
  const ref = String(refKey || '').trim()
  if (!ref) return null
  const dotIdx = ref.lastIndexOf('.')
  const assetId = dotIdx > 0 ? ref.slice(0, dotIdx) : ref
  const ext = dotIdx > 0 ? ref.slice(dotIdx + 1).toLowerCase() : ''
  if (!assetId) return null
  return { assetId, ext }
}

