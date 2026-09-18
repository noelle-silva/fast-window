import type { StoreImageIconRef } from './catalogTypes'

export function storeIconToDisplay(icon: StoreImageIconRef | undefined): string {
  if (!icon) return ''
  if (icon.type === 'url') return icon.url
  return icon.dataUrl
}

export function isStoreImageIcon(icon: string): boolean {
  return /^https:\/\//i.test(icon) || icon.startsWith('data:image/')
}
