import type { ClipboardImageDraft } from '../shared/types'

export type PickedImage = { dataUrl: string; mime: string; sourceName?: string }

export function imageFileFromClipboardData(data: DataTransfer | null | undefined): File | null {
  const fromItems = Array.from(data?.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .find((file): file is File => !!file && file.type.startsWith('image/'))
  if (fromItems) return fromItems
  return Array.from(data?.files || []).find((file) => file.type.startsWith('image/')) || null
}

export function imageDraftFromFile(file: File): Promise<ClipboardImageDraft> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      const img = new Image()
      img.onload = () => resolve({
        dataUrl,
        mime: file.type || 'image/png',
        width: img.naturalWidth,
        height: img.naturalHeight,
        sourceName: file.name,
      })
      img.onerror = () => reject(new Error('图片尺寸读取失败'))
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  })
}

export async function pickedImageToDraft(picked: PickedImage): Promise<ClipboardImageDraft> {
  const dimensions = await readImageDimensions(picked.dataUrl)
  return {
    dataUrl: picked.dataUrl,
    mime: picked.mime || 'image/png',
    width: dimensions.width,
    height: dimensions.height,
    sourceName: picked.sourceName || '图片',
  }
}

function readImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('图片尺寸读取失败'))
    img.src = src
  })
}
