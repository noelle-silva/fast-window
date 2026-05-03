export function generateSafeId(name: string, fallback = 'untitled'): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || fallback
}
