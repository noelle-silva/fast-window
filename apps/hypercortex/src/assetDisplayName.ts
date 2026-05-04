function normalizeExt(ext: unknown): string {
  return String(ext || '')
    .toLowerCase()
    .replace(/^\./, '')
    .trim()
}

export function pickAssetDisplayName(input: { explicitName?: unknown; indexName?: unknown; ext?: unknown }): string {
  const explicit = String(input?.explicitName || '').trim()
  if (explicit) return explicit

  const indexName = String(input?.indexName || '').trim()
  if (indexName) return indexName

  const ext = normalizeExt(input?.ext)
  if (ext) return `.${ext}`

  return '文件'
}

