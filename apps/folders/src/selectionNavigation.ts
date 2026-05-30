export type SelectionNavigationDirection = 'previous' | 'next'
export type SelectionNavigationBoundary = 'wrap' | 'stop'

export function resolveAdjacentSelectionId<T extends string>(ids: T[], currentId: string, direction: SelectionNavigationDirection, boundary: SelectionNavigationBoundary = 'wrap'): T | null {
  const current = currentId.trim()
  if (ids.length < 2 || !current) return null

  const currentIndex = ids.findIndex(id => id === current)
  if (currentIndex < 0) return null

  if (boundary === 'stop') {
    const nextIndex = direction === 'previous' ? currentIndex - 1 : currentIndex + 1
    return ids[nextIndex] || null
  }

  const nextIndex = direction === 'previous'
    ? (currentIndex - 1 + ids.length) % ids.length
    : (currentIndex + 1) % ids.length
  return ids[nextIndex]
}
