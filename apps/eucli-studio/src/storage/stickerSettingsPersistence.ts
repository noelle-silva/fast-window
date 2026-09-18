import { STICKERS_KEY } from '../domain/constants'

type StickerSettingsReader = {
  get: (key: string) => Promise<any>
}

type StickerSettingsWriter = {
  set: (key: string, value: any) => Promise<void>
}

export function ensureStickerSettings(data: any) {
  if (!data || typeof data !== 'object') return null
  if (!data.settings || typeof data.settings !== 'object') data.settings = {}
  data.settings.stickers = stickerSettingsSnapshot(data.settings.stickers)
  return data.settings.stickers
}

export function stickerSettingsSnapshot(value: any) {
  const stickers = value && typeof value === 'object' ? value : {}
  return {
    ...stickers,
    enabled: !!stickers.enabled,
    categories: Array.isArray(stickers.categories) ? stickers.categories.slice() : [],
    map: stickers.map && typeof stickers.map === 'object' ? { ...stickers.map } : {},
  }
}

export async function loadStickerSettingsFromStorage(storage: StickerSettingsReader, getData?: () => any) {
  const stickers = await storage.get(STICKERS_KEY)
  const normalized = stickerSettingsSnapshot(stickers)
  const data = getData?.()
  if (data && typeof data === 'object') {
    if (!data.settings || typeof data.settings !== 'object') data.settings = {}
    data.settings.stickers = normalized
  }
  return normalized
}

export async function initializeStickerSettingsStorage(storage: StickerSettingsWriter) {
  await storage.set(STICKERS_KEY, stickerSettingsSnapshot(null))
}

export async function saveStickerSettingsOnly(storage: StickerSettingsWriter, getData: () => any) {
  const data = getData()
  if (!data || typeof data !== 'object') return
  const stickers = data.settings && typeof data.settings === 'object' ? data.settings.stickers : null
  await storage.set(STICKERS_KEY, stickerSettingsSnapshot(stickers))
}
