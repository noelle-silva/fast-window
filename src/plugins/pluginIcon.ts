export function isDataImageUrl(value: string): boolean {
  return value.startsWith('data:image/')
}

export function getPluginAssetMime(path: string): string {
  const lower = path.toLowerCase()
  return lower.endsWith('.png') ? 'image/png'
    : (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) ? 'image/jpeg'
    : lower.endsWith('.webp') ? 'image/webp'
    : lower.endsWith('.gif') ? 'image/gif'
    : lower.endsWith('.ico') ? 'image/x-icon'
    : lower.endsWith('.svg') ? 'image/svg+xml'
    : ''
}

export function isSupportedPluginIconPath(path: string): boolean {
  return !!getPluginAssetMime(path)
}

export function resolveLocalPluginIconPath(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value || value.startsWith('data:image/')) return ''
  if (value.startsWith('svg:')) return value.slice('svg:'.length).trim()
  if (value.startsWith('file:')) return value.slice('file:'.length).trim()
  if (value.includes(':')) return ''
  return isSupportedPluginIconPath(value) ? value : ''
}
