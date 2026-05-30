export function deriveNameFromTarget(target: string): string {
  const trimmed = target.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    if (url.protocol === 'http:' || url.protocol === 'https:') return deriveNameFromHttpUrl(url.toString())
  } catch {
    // Non-URL targets fall through to path naming.
  }
  return deriveNameFromPath(trimmed)
}

export function deriveNameFromHttpUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl.trim())
    return url.hostname.replace(/^www\./i, '') || rawUrl.trim()
  } catch {
    return rawUrl.trim()
  }
}

export function deriveNameFromPath(path: string): string {
  const value = path.trim()
  const withoutTrailingSlash = value.replace(/[\\/]+$/, '') || value
  const parts = withoutTrailingSlash.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || value
}
