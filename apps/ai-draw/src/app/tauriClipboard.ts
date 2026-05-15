import { Image as TauriImage } from '@tauri-apps/api/image'
import { readImage, writeImage, writeText } from '@tauri-apps/plugin-clipboard-manager'
import type { AiDrawPickedImage } from '../gateway/types'

type TauriClipboardImage = {
  size: () => Promise<{ width: number; height: number }>
  rgba: () => Promise<Uint8Array>
}

export const tauriClipboard = {
  writeText: (text: string) => writeText(String(text || '')),
  writeImage: async (dataUrl: string) => writeImage(await dataUrlToTauriImage(dataUrl)),
  readImage: async (): Promise<AiDrawPickedImage | null> => ({
    name: '剪贴板图片.png',
    dataUrl: await tauriClipboardImageToPngDataUrl(await readImage()),
  }),
}

async function dataUrlToTauriImage(dataUrl: string) {
  const image = await imageElementFromDataUrl(dataUrl)
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (!width || !height) throw new Error('图片尺寸无效')

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 不可用')
  ctx.drawImage(image, 0, 0, width, height)
  return TauriImage.new(ctx.getImageData(0, 0, width, height).data, width, height)
}

async function tauriClipboardImageToPngDataUrl(image: TauriClipboardImage) {
  const size = await image.size()
  const width = Number(size.width)
  const height = Number(size.height)
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error('剪贴板图片尺寸无效')

  const rgba = await image.rgba()
  if (rgba.length !== width * height * 4) throw new Error('剪贴板图片像素数据无效')

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 不可用')
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
  return canvas.toDataURL('image/png')
}

function imageElementFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('加载图片失败'))
    image.src = dataUrl
  })
}
