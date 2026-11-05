// 选择图片的统一入口：取一张图 → 等比缩小到上限 → 交回可入库的 data URL。
// 角色头像、群组头像与工作区图标都走这条路，彼此只在缩放上限上不同，
// 「取图 / 缩图 / 判空」这套动作不各写一遍。
import { looksLikeImageDataUrl } from '../domain/textProcessing'

export type PickedImage =
  | { kind: 'picked'; dataUrl: string }
  | { kind: 'cancelled' }
  | { kind: 'invalid' }
  | { kind: 'unavailable' }

export async function pickShrunkImage(options: {
  pickImageFiles?: (maxCount?: number) => Promise<any[]>
  shrinkImageDataUrl: (dataUrl: string, maxSide: number) => Promise<string>
  maxSide: number
}): Promise<PickedImage> {
  const { pickImageFiles, shrinkImageDataUrl, maxSide } = options
  if (typeof pickImageFiles !== 'function') return { kind: 'unavailable' }

  const items = await pickImageFiles(1)
  const list = Array.isArray(items) ? items : []
  const source = String(list.length ? list[0]?.dataUrl || '' : '')
  if (!source) return { kind: 'cancelled' }
  if (!looksLikeImageDataUrl(source)) return { kind: 'invalid' }

  const shrunk = await shrinkImageDataUrl(source, maxSide)
  const dataUrl = looksLikeImageDataUrl(shrunk) ? shrunk : source
  return { kind: 'picked', dataUrl }
}
