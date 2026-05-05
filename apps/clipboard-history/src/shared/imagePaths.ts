export function isDataUrl(value: string): boolean {
  return String(value || '').startsWith('data:')
}

export function pickImagePath(item: { content?: string; path?: string } | null | undefined): string {
  const path = String(item && item.path ? item.path : '').trim()
  if (path) return path
  const content = String(item && item.content ? item.content : '').trim()
  return isDataUrl(content) ? '' : content
}

export function basenameFromPath(path: string): string {
  return String(path || '').replaceAll('\\', '/').split('/').filter(Boolean).pop() || ''
}

export function isManagedClipboardImagePath(path: string): boolean {
  return /^clipboard-image-[a-f0-9]{8}\.png$/i.test(basenameFromPath(path))
}
