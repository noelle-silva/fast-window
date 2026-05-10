import type { StoreIconRef } from './catalogTypes'

export function storeIconToDisplay(icon: StoreIconRef | undefined): string {
  if (!icon) return ''
  if (icon.type === 'emoji') return icon.value
  if (icon.type === 'url') return icon.url
  return icon.dataUrl
}

export function isStoreImageIcon(icon: string): boolean {
  return /^https:\/\//i.test(icon) || icon.startsWith('data:image/')
}
