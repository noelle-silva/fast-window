import { HYPERCORTEX_NOTE_FACE_SCHEMA_VERSION } from './noteFaces'
import {
  createDefaultNoteFaces,
  createNoteManifest as createNoteManifestV2,
  type HyperCortexNoteManifestV2,
} from './noteManifest'

export const HYPERCORTEX_NOTE_SCHEMA_VERSION = HYPERCORTEX_NOTE_FACE_SCHEMA_VERSION
export { NOTE_MANIFEST_FILE } from './noteManifest'

export type HyperCortexNoteResourceRef = {
  assetId: string
  mime?: string
  ext?: string
  kind?: string
  name?: string
}

export type HyperCortexNoteManifestV1 = HyperCortexNoteManifestV2

export type HyperCortexNoteDocData = {
  id: string
  packageDir: string
  title: string
  description: string
  body: string
  tags: string[]
  createdAtMs: number
  updatedAtMs: number
  schemaVersion: number
  resources: HyperCortexNoteResourceRef[]
}

export type HyperCortexNoteDoc = HyperCortexNoteDocData & {
  displayHtml: string
}

export type HyperCortexNoteDocInput = Partial<Omit<HyperCortexNoteDocData, 'id' | 'packageDir'>> & {
  id: string
  packageDir: string
  title?: string
  description?: string
  body?: string
  tags?: string[]
}

function normalizeText(value: string): string {
  return String(value || '').replace(/\r\n/g, '\n')
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

export function createNoteDocData(input: HyperCortexNoteDocInput): HyperCortexNoteDocData {
  const createdAtMs = Number(input.createdAtMs) > 0 ? Number(input.createdAtMs) : Date.now()
  const updatedAtMs = Number(input.updatedAtMs) > 0 ? Number(input.updatedAtMs) : createdAtMs
  return {
    id: String(input.id || '').trim(),
    packageDir: String(input.packageDir || '').trim(),
    title: String(input.title || '').trim() || '未命名',
    description: String(input.description ?? '').trim(),
    body: normalizeText(String(input.body || '')),
    tags: Array.from(new Set((input.tags || []).map(normalizeTag).filter(Boolean))),
    createdAtMs,
    updatedAtMs,
    schemaVersion: Number(input.schemaVersion) > 0 ? Number(input.schemaVersion) : HYPERCORTEX_NOTE_SCHEMA_VERSION,
    resources: normalizeResources(input.resources),
  }
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
  faces?: HyperCortexNoteManifestV1['faces']
}): HyperCortexNoteManifestV1 {
  return createNoteManifestV2({
    ...input,
    faces: input.faces || createDefaultNoteFaces(),
  })
}
