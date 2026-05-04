import { buildEmptyHtmlViewDoc, normalizeHtmlViewContent } from './noteHtml'

export const HYPERCORTEX_NOTE_FACE_SCHEMA_VERSION = 2

export const MARKDOWN_FACE_KIND = 'markdown'
export const HTML_FACE_KIND = 'html'

export type HyperCortexNoteFaceRoleV2 = 'primary' | 'alternate' | 'derived' | 'attachment'

export type HyperCortexNoteFaceSettingsV2 = Record<string, unknown>

export type HyperCortexNoteFaceCapabilitiesV2 = {
  editable: boolean
  searchable: boolean
  previewable: boolean
  linkable: boolean
  creatable: boolean
  deletable: boolean
}

export type HyperCortexNoteFaceManifestV2 = {
  id: string
  kind: string
  title: string
  file: string
  role: HyperCortexNoteFaceRoleV2
  settings: HyperCortexNoteFaceSettingsV2
  capabilities: HyperCortexNoteFaceCapabilitiesV2
}

export type HyperCortexNoteFaceAdapter = {
  kind: string
  label: string
  defaultFaceId: string
  defaultFileName: string
  defaultRole: HyperCortexNoteFaceRoleV2
  capabilities: HyperCortexNoteFaceCapabilitiesV2
  normalizeContent: (content: string) => string
  createEmptyContent: (input: { noteId: string; title: string }) => string
  normalizeSettings: (settings?: HyperCortexNoteFaceSettingsV2 | null) => HyperCortexNoteFaceSettingsV2
}

function normalizeTextContent(value: string): string {
  return String(value || '').replace(/\r\n/g, '\n')
}

function normalizePlainSettings(value?: HyperCortexNoteFaceSettingsV2 | null): HyperCortexNoteFaceSettingsV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return { ...value }
}

function normalizeFixedScale(value: unknown): number | undefined {
  const n = Number(value)
  if (!Number.isFinite(n)) return undefined
  if (n < 0.25) return 0.25
  if (n > 2) return 2
  return n
}

const MARKDOWN_FACE_ADAPTER: HyperCortexNoteFaceAdapter = {
  kind: MARKDOWN_FACE_KIND,
  label: '文本',
  defaultFaceId: 'text',
  defaultFileName: 'text.md',
  defaultRole: 'primary',
  capabilities: {
    editable: true,
    searchable: true,
    previewable: true,
    linkable: true,
    creatable: true,
    deletable: false,
  },
  normalizeContent: normalizeTextContent,
  createEmptyContent: () => '',
  normalizeSettings: normalizePlainSettings,
}

const HTML_FACE_ADAPTER: HyperCortexNoteFaceAdapter = {
  kind: HTML_FACE_KIND,
  label: 'HTML',
  defaultFaceId: 'html',
  defaultFileName: 'html-view.html',
  defaultRole: 'alternate',
  capabilities: {
    editable: true,
    searchable: false,
    previewable: true,
    linkable: false,
    creatable: true,
    deletable: true,
  },
  normalizeContent: normalizeHtmlViewContent,
  createEmptyContent: input => buildEmptyHtmlViewDoc({ title: input.title, noteId: input.noteId, schemaVersion: HYPERCORTEX_NOTE_FACE_SCHEMA_VERSION }),
  normalizeSettings: settings => {
    const fixedScale = normalizeFixedScale(settings?.fixedScale)
    return fixedScale !== undefined ? { fixedScale } : {}
  },
}

const NOTE_FACE_REGISTRY: Record<string, HyperCortexNoteFaceAdapter> = {
  [MARKDOWN_FACE_ADAPTER.kind]: MARKDOWN_FACE_ADAPTER,
  [HTML_FACE_ADAPTER.kind]: HTML_FACE_ADAPTER,
}

export function listNoteFaceAdapters(): HyperCortexNoteFaceAdapter[] {
  return Object.values(NOTE_FACE_REGISTRY)
}

export function getNoteFaceAdapter(kind: string): HyperCortexNoteFaceAdapter | null {
  return NOTE_FACE_REGISTRY[String(kind || '').trim()] || null
}

export function requireNoteFaceAdapter(kind: string): HyperCortexNoteFaceAdapter {
  const adapter = getNoteFaceAdapter(kind)
  if (!adapter) throw new Error(`未知笔记面类型：${kind}`)
  return adapter
}

export function getNoteFaceAdapterByDefaultFaceId(faceId: string): HyperCortexNoteFaceAdapter | null {
  const id = String(faceId || '').trim()
  return listNoteFaceAdapters().find(adapter => adapter.defaultFaceId === id) || null
}

export function createDefaultFaceManifest(kind: string, input?: {
  id?: string
  title?: string
  file?: string
  role?: HyperCortexNoteFaceRoleV2
  settings?: HyperCortexNoteFaceSettingsV2 | null
}): HyperCortexNoteFaceManifestV2 {
  const adapter = requireNoteFaceAdapter(kind)
  const settings = adapter.normalizeSettings(input?.settings || null)
  return {
    id: String(input?.id || '').trim() || adapter.defaultFaceId,
    kind: adapter.kind,
    title: String(input?.title || '').trim() || adapter.label,
    file: String(input?.file || '').trim() || adapter.defaultFileName,
    role: input?.role || adapter.defaultRole,
    settings,
    capabilities: { ...adapter.capabilities },
  }
}

export function normalizeFaceManifest(input: unknown): HyperCortexNoteFaceManifestV2 | null {
  const raw = input as any
  if (!raw || typeof raw !== 'object') return null
  const kind = String(raw.kind || '').trim()
  const adapter = getNoteFaceAdapter(kind)
  if (!adapter) return null
  const id = String(raw.id || '').trim() || adapter.defaultFaceId
  const file = String(raw.file || '').trim() || adapter.defaultFileName
  const role = raw.role === 'primary' || raw.role === 'alternate' || raw.role === 'derived' || raw.role === 'attachment'
    ? raw.role
    : adapter.defaultRole
  return createDefaultFaceManifest(adapter.kind, {
    id,
    title: raw.title,
    file,
    role,
    settings: raw.settings,
  })
}

export function isHtmlFace(face: HyperCortexNoteFaceManifestV2 | null | undefined): boolean {
  return face?.kind === HTML_FACE_KIND
}

export function isMarkdownFace(face: HyperCortexNoteFaceManifestV2 | null | undefined): boolean {
  return face?.kind === MARKDOWN_FACE_KIND
}

export function getHtmlFaceFixedScale(face: HyperCortexNoteFaceManifestV2 | null | undefined): number | undefined {
  if (!isHtmlFace(face)) return undefined
  return normalizeFixedScale(face?.settings?.fixedScale)
}

export function labelForFaceKind(kind: string): string {
  return getNoteFaceAdapter(kind)?.label || String(kind || '').trim() || '未知'
}
