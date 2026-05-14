import type { CollectionContainer } from './types'

export type ContainerDropSurface = 'icon' | 'grid' | 'unavailable'

export function resolveContainerDropSurface(containerId: string, openContainer: CollectionContainer | null, hasContainerGrid: boolean): ContainerDropSurface {
  if (hasContainerGrid) return 'grid'
  return openContainer?.id === containerId ? 'unavailable' : 'icon'
}
