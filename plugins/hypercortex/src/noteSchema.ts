import { escapeHtml } from './html'

export const NOTE_SOURCE_TAG = 'hypercortex-note-source'
export const NOTE_TITLE_TAG = 'note-title'
export const NOTE_BODY_TAG = 'note-body'
export const NOTE_TAGS_TAG = 'note-tags'
export const NOTE_TAG_TAG = 'note-tag'
export const NOTE_META_TAG = 'note-meta'
export const NOTE_SCHEMA_VERSION_TAG = 'note-schema-version'
export const HYPERCORTEX_NOTE_SCHEMA_VERSION = 1

export type HyperCortexNoteSource = {
  title: string
  body: string
  tags: string[]
  schemaVersion: number
}

export type HyperCortexNoteSourceInput = Partial<HyperCortexNoteSource>

function normalizeText(value: string): string {
  return String(value || '').replace(/\r\n/g, '\n')
}

function normalizeTag(value: string): string {
  return String(value || '').trim()
}

export function createNoteSource(input?: HyperCortexNoteSourceInput): HyperCortexNoteSource {
  const title = String(input?.title || '').trim() || '未命名'
  const body = normalizeText(String(input?.body || ''))
  const tags = Array.from(new Set((input?.tags || []).map(normalizeTag).filter(Boolean)))
  const schemaVersion = Number(input?.schemaVersion) > 0 ? Number(input?.schemaVersion) : HYPERCORTEX_NOTE_SCHEMA_VERSION
  return { title, body, tags, schemaVersion }
}

export function serializeNoteSource(source: HyperCortexNoteSource): string {
  const normalized = createNoteSource(source)
  const tagsHtml = normalized.tags.map(tag => `      <${NOTE_TAG_TAG}>${escapeHtml(tag)}</${NOTE_TAG_TAG}>`).join('\n')
  return `<${NOTE_SOURCE_TAG} hidden>
  <${NOTE_TITLE_TAG}>${escapeHtml(normalized.title)}</${NOTE_TITLE_TAG}>
  <${NOTE_TAGS_TAG}>${tagsHtml ? `\n${tagsHtml}\n  ` : ''}</${NOTE_TAGS_TAG}>
  <${NOTE_BODY_TAG}>${escapeHtml(normalized.body)}</${NOTE_BODY_TAG}>
  <${NOTE_META_TAG}>
    <${NOTE_SCHEMA_VERSION_TAG}>${normalized.schemaVersion}</${NOTE_SCHEMA_VERSION_TAG}>
  </${NOTE_META_TAG}>
</${NOTE_SOURCE_TAG}>`
}

export function parseNoteSourceDocument(doc: Document): HyperCortexNoteSource {
  const root = doc.querySelector(NOTE_SOURCE_TAG)
  if (!root) throw new Error('笔记 source 区缺失')

  const title = String(root.querySelector(NOTE_TITLE_TAG)?.textContent || '').trim() || '未命名'
  const body = normalizeText(String(root.querySelector(NOTE_BODY_TAG)?.textContent || ''))
  const tags = Array.from(root.querySelectorAll(`${NOTE_TAGS_TAG} > ${NOTE_TAG_TAG}`))
    .map(node => normalizeTag(node.textContent || ''))
    .filter(Boolean)
  const schemaVersionRaw = String(root.querySelector(`${NOTE_META_TAG} > ${NOTE_SCHEMA_VERSION_TAG}`)?.textContent || '').trim()
  const schemaVersion = Number(schemaVersionRaw) || HYPERCORTEX_NOTE_SCHEMA_VERSION
  return createNoteSource({ title, body, tags, schemaVersion })
}
