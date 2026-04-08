export const HYPERCORTEX_NOTE_SCHEMA_VERSION = 1
export const NOTE_MANIFEST_FILE = 'manifest.json'
export const NOTE_TEXT_FILE = 'text.md'
export const NOTE_HTML_VIEW_FILE = 'html-view.html'

export type HyperCortexNoteResourceRef = {
  assetId: string
  mime?: string
  ext?: string
  kind?: string
  name?: string
}

export type HyperCortexNoteManifestV1 = {
  schemaVersion: number
  id: string
  title: string
  tags: string[]
  createdAtMs: number
  updatedAtMs: number
  faces: {
    text?: { file: string }
    htmlView?: { file: string }
  }
  resources: HyperCortexNoteResourceRef[]
}

export type HyperCortexNoteDocData = {
  id: string
  packageDir: string
  title: string
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

function normalizeFaces(faces?: HyperCortexNoteManifestV1['faces']): HyperCortexNoteManifestV1['faces'] {
  const next: HyperCortexNoteManifestV1['faces'] = {}
  const textFile = String(faces?.text?.file || '').trim()
  const htmlViewFile = String(faces?.htmlView?.file || '').trim()
  if (textFile) next.text = { file: textFile }
  if (htmlViewFile) next.htmlView = { file: htmlViewFile }
  return next
}

export function createNoteDocData(input: HyperCortexNoteDocInput): HyperCortexNoteDocData {
  const createdAtMs = Number(input.createdAtMs) > 0 ? Number(input.createdAtMs) : Date.now()
  const updatedAtMs = Number(input.updatedAtMs) > 0 ? Number(input.updatedAtMs) : createdAtMs
  return {
    id: String(input.id || '').trim(),
    packageDir: String(input.packageDir || '').trim(),
    title: String(input.title || '').trim() || '未命名',
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
  tags?: string[]
  createdAtMs?: number
  updatedAtMs?: number
  schemaVersion?: number
  resources?: HyperCortexNoteResourceRef[]
  faces?: HyperCortexNoteManifestV1['faces']
}): HyperCortexNoteManifestV1 {
  const createdAtMs = Number(input.createdAtMs) > 0 ? Number(input.createdAtMs) : Date.now()
  const updatedAtMs = Number(input.updatedAtMs) > 0 ? Number(input.updatedAtMs) : createdAtMs
  return {
    schemaVersion: Number(input.schemaVersion) > 0 ? Number(input.schemaVersion) : HYPERCORTEX_NOTE_SCHEMA_VERSION,
    id: String(input.id || '').trim(),
    title: String(input.title || '').trim() || '未命名',
    tags: Array.from(new Set((input.tags || []).map(normalizeTag).filter(Boolean))),
    createdAtMs,
    updatedAtMs,
    faces: normalizeFaces(input.faces),
    resources: normalizeResources(input.resources),
  }
}
