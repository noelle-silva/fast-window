import {
  HYPERCORTEX_NOTE_FACE_SCHEMA_VERSION,
  HTML_FACE_KIND,
  MARKDOWN_FACE_KIND,
  createDefaultFaceManifest,
  normalizeFaceManifest,
  type HyperCortexNoteFaceManifestV2,
  type HyperCortexNoteFaceSettingsV2,
} from './noteFaces'
import type { HyperCortexNoteResourceRef } from './noteSchema'

export const NOTE_MANIFEST_FILE = 'manifest.json'

export type HyperCortexNoteManifestV2 = {
  schemaVersion: number
  id: string
  title: string
  description: string
  tags: string[]
  createdAtMs: number
  updatedAtMs: number
  primaryFaceId: string
  faceOrder: string[]
  faces: Record<string, HyperCortexNoteFaceManifestV2>
  resources: HyperCortexNoteResourceRef[]
}

function normalizeTag(value: string): string {
  return String(value || '').trim()
}

function normalizeResources(list?: HyperCortexNoteResourceRef[]): HyperCortexNoteResourceRef[] {
  return Array.from(
    new Map(
      (list || [])
        .map(item => ({
          assetId: String(item?.assetId || '').trim(),
          mime: String(item?.mime || '').trim() || undefined,
          ext: String(item?.ext || '').trim() || undefined,
          kind: String(item?.kind || '').trim() || undefined,
          name: String(item?.name || '').trim() || undefined,
        }))
        .filter(item => item.assetId)
        .map(item => [item.assetId, item]),
    ).values(),
  )
}

function normalizeFaceOrder(faceOrder: unknown, faces: Record<string, HyperCortexNoteFaceManifestV2>, primaryFaceId: string): string[] {
  const out: string[] = []
  const push = (id: unknown) => {
    const faceId = String(id || '').trim()
    if (!faceId || !faces[faceId] || out.includes(faceId)) return
    out.push(faceId)
  }
  push(primaryFaceId)
  if (Array.isArray(faceOrder)) faceOrder.forEach(push)
  Object.keys(faces).forEach(push)
  return out
}

function normalizeFaces(input: unknown): Record<string, HyperCortexNoteFaceManifestV2> {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const faces: Record<string, HyperCortexNoteFaceManifestV2> = {}

  for (const [rawId, value] of Object.entries(raw)) {
    const rawFace = value as any
    const face = normalizeFaceManifest({ ...rawFace, id: String(rawFace?.id || rawId).trim() || rawId })
    if (!face) continue
    faces[face.id] = face
  }

  if (!faces.text) faces.text = createDefaultFaceManifest(MARKDOWN_FACE_KIND)
  return faces
}

export function createNoteManifest(input: {
  id: string
  title?: string
  description?: string
  tags?: string[]
  createdAtMs?: number
  updatedAtMs?: number
  schemaVersion?: number
  resources?: HyperCortexNoteResourceRef[]
  primaryFaceId?: string
  faceOrder?: string[]
  faces?: Record<string, HyperCortexNoteFaceManifestV2>
}): HyperCortexNoteManifestV2 {
  const createdAtMs = Number(input.createdAtMs) > 0 ? Number(input.createdAtMs) : Date.now()
  const updatedAtMs = Number(input.updatedAtMs) > 0 ? Number(input.updatedAtMs) : createdAtMs
  const faces = normalizeFaces(input.faces)
  const requestedPrimaryFaceId = String(input.primaryFaceId || '').trim()
  const primaryFaceId = faces[requestedPrimaryFaceId] ? requestedPrimaryFaceId : faces.text ? 'text' : Object.keys(faces)[0]
  return {
    schemaVersion: HYPERCORTEX_NOTE_FACE_SCHEMA_VERSION,
    id: String(input.id || '').trim(),
    title: String(input.title || '').trim() || '未命名',
    description: String(input.description ?? '').trim(),
    tags: Array.from(new Set((input.tags || []).map(normalizeTag).filter(Boolean))),
    createdAtMs,
    updatedAtMs,
    primaryFaceId,
    faceOrder: normalizeFaceOrder(input.faceOrder, faces, primaryFaceId),
    faces,
    resources: normalizeResources(input.resources),
  }
}

export function createDefaultNoteFaces(input?: {
  includeHtml?: boolean
  htmlSettings?: HyperCortexNoteFaceSettingsV2 | null
}): Record<string, HyperCortexNoteFaceManifestV2> {
  const faces: Record<string, HyperCortexNoteFaceManifestV2> = {
    text: createDefaultFaceManifest(MARKDOWN_FACE_KIND),
  }
  if (input?.includeHtml) {
    faces.html = createDefaultFaceManifest(HTML_FACE_KIND, { settings: input.htmlSettings })
  }
  return faces
}
