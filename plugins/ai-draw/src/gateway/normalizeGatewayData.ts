import { normalizeImageDataUrlOrBase64 } from '../core/images'
import type { AiDrawPickedImage, AiDrawTask } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function normalizePickedImages(raw: unknown, maxCount: number): AiDrawPickedImage[] {
  const limit = Number.isFinite(maxCount) && maxCount > 0 ? Math.floor(maxCount) : 0
  if (!limit || !Array.isArray(raw)) return []
  const out: AiDrawPickedImage[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const name = typeof item.name === 'string' ? item.name : ''
    const sourcePath = typeof item.sourcePath === 'string' ? item.sourcePath : undefined
    const rawData =
      typeof item.dataUrl === 'string'
        ? item.dataUrl
        : typeof item.data_url === 'string'
          ? item.data_url
          : typeof item.base64 === 'string'
            ? item.base64
            : ''
    const dataUrl = normalizeImageDataUrlOrBase64(rawData)
    if (!dataUrl.startsWith('data:image/')) continue
    out.push({ name, dataUrl, ...(sourcePath ? { sourcePath } : {}) })
    if (out.length >= limit) break
  }
  return out
}

export function normalizeTask(raw: unknown): AiDrawTask | null {
  if (!isRecord(raw)) return null
  const id = String(raw.id || '').trim()
  if (!id) return null
  const status = String(raw.status || '').trim() || 'pending'
  const result = isRecord(raw.result) ? raw.result : null
  const meta = isRecord(raw.meta) ? raw.meta : null
  return {
    id,
    status,
    ...(raw.kind != null ? { kind: String(raw.kind || '') } : {}),
    ...(result ? { result: result as AiDrawTask['result'] } : {}),
    ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
    ...(meta ? { meta: meta as AiDrawTask['meta'] } : {}),
  }
}

export function normalizeTaskList(raw: unknown): AiDrawTask[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => normalizeTask(item)).filter((item): item is AiDrawTask => !!item)
}

export function normalizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => String(item || '').trim()).filter(Boolean)
}

export function normalizeOutputPath(raw: unknown): string {
  return String(raw || '').trim()
}
