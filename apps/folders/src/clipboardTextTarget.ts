import type { CollectionCategoryId } from './types'
import { deriveNameFromHttpUrl, deriveNameFromPath } from './targetNaming'

export type ParsedClipboardTextTarget =
  | { kind: 'url'; categoryId: 'url'; target: string; name: string }
  | { kind: 'path'; target: string }

export type ClipboardPathInspection = {
  kind: 'folder' | 'file'
  path: string
  name: string
}

export type ResolvedClipboardTextTarget = {
  categoryId: CollectionCategoryId
  target: string
  name: string
}

export function parseClipboardTextTarget(text: string): ParsedClipboardTextTarget | null {
  const value = normalizeSingleClipboardText(text)
  if (!value) return null

  const url = normalizeHttpUrl(value)
  if (url) return { kind: 'url', categoryId: 'url', target: url, name: deriveNameFromHttpUrl(url) }
  if (looksLikeAbsolutePath(value)) return { kind: 'path', target: value }
  return null
}

export function resolvedClipboardTargetFromPathInspection(inspection: ClipboardPathInspection): ResolvedClipboardTextTarget {
  return {
    categoryId: inspection.kind,
    target: inspection.path.trim(),
    name: inspection.name.trim() || deriveNameFromPath(inspection.path),
  }
}

function normalizeSingleClipboardText(text: string): string {
  const cleanText = text.replace(/\0/g, '').trim()
  if (!cleanText) return ''

  const lines = cleanText.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length !== 1) return ''
  return unwrapMatchingQuotes(lines[0])
}

function unwrapMatchingQuotes(value: string): string {
  const pairs: Array<[string, string]> = [['"', '"'], ["'", "'"]]
  for (const [left, right] of pairs) {
    if (value.startsWith(left) && value.endsWith(right) && value.length >= 2) {
      return value.slice(1, -1).trim()
    }
  }
  return value
}

function normalizeHttpUrl(value: string): string | null {
  if (!/^https?:\/\//i.test(value)) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname) return null
    return url.toString()
  } catch {
    return null
  }
}

function looksLikeAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value)
    || /^\\\\[^\\/]+[\\/][^\\/]+/.test(value)
    || /^\//.test(value)
}
