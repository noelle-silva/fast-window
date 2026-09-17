export function deriveNameFromTarget(target: string): string {
  const trimmed = target.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    if (url.protocol === 'http:' || url.protocol === 'https:') return deriveNameFromHttpUrl(url.toString())
  } catch {
    return ''
  }
  return ''
}

export function deriveNameFromHttpUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl.trim())
    return url.hostname.replace(/^www\./i, '') || rawUrl.trim()
  } catch {
    return rawUrl.trim()
  }
}
