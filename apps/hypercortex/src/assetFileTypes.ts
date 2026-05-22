import assetFileTypes from '../backend-go/shared/asset_file_types.json'

type AssetFileKind = 'image' | 'audio' | 'video' | 'document'

type AssetFileType = {
  ext: string
  mime: string
  kind: AssetFileKind
  mimeAliases?: readonly string[]
}

const ASSET_FILE_TYPES = loadAssetFileTypes(assetFileTypes as readonly AssetFileType[])

const ASSET_FILE_TYPE_BY_EXT = new Map(ASSET_FILE_TYPES.map(item => [item.ext, item]))
const EXT_BY_MIME = new Map<string, string>()
const KIND_BY_MIME = new Map<string, AssetFileKind>()

for (const item of ASSET_FILE_TYPES) {
  setPreferredMimeExt(item.mime, item.ext)
  setPreferredMimeKind(item.mime, item.kind)
  for (const alias of item.mimeAliases || []) setPreferredMimeExt(alias, item.ext)
  for (const alias of item.mimeAliases || []) setPreferredMimeKind(alias, item.kind)
}

export function extFromMime(mime: string): string {
  return EXT_BY_MIME.get(normalizeMime(mime)) || ''
}

export function mimeFromExt(ext: string): string {
  return ASSET_FILE_TYPE_BY_EXT.get(normalizeExt(ext))?.mime || ''
}

export function kindFromMime(mime: string): string {
  const m = normalizeMime(mime)
  const catalogKind = KIND_BY_MIME.get(m)
  if (catalogKind) return catalogKind
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('audio/')) return 'audio'
  if (m.startsWith('video/')) return 'video'
  return 'document'
}

export const ACCEPTED_FILE_EXTENSIONS = ASSET_FILE_TYPES.map(item => item.ext)

function normalizeExt(ext: string): string {
  return String(ext || '').toLowerCase().replace(/^\./, '').trim()
}

function normalizeMime(mime: string): string {
  return String(mime || '').toLowerCase().split(';')[0].trim()
}

function setPreferredMimeExt(mime: string, ext: string): void {
  const normalizedMime = normalizeMime(mime)
  if (!normalizedMime || EXT_BY_MIME.has(normalizedMime)) return
  EXT_BY_MIME.set(normalizedMime, ext)
}

function setPreferredMimeKind(mime: string, kind: AssetFileKind): void {
  const normalizedMime = normalizeMime(mime)
  if (!normalizedMime || KIND_BY_MIME.has(normalizedMime)) return
  KIND_BY_MIME.set(normalizedMime, kind)
}

function loadAssetFileTypes(items: readonly AssetFileType[]): readonly AssetFileType[] {
  if (!items.length) throw new Error('asset file types cannot be empty')
  const seenExts = new Set<string>()
  for (const item of items) {
    const ext = normalizeExt(item.ext)
    const mime = normalizeMime(item.mime)
    if (!ext || !mime || !isAssetFileKind(item.kind)) throw new Error(`invalid asset file type: ${JSON.stringify(item)}`)
    if (seenExts.has(ext)) throw new Error(`duplicate asset file extension: ${ext}`)
    seenExts.add(ext)
  }
  return items
}

function isAssetFileKind(kind: unknown): kind is AssetFileKind {
  return kind === 'image' || kind === 'audio' || kind === 'video' || kind === 'document'
}
