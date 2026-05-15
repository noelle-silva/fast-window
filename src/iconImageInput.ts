import { readImage } from '@tauri-apps/plugin-clipboard-manager'

export type IconImageSource = 'file' | 'clipboard'

type ClipboardImage = {
  size: () => Promise<{ width: number; height: number }>
  rgba: () => Promise<Uint8Array>
}

const MAX_ICON_IMAGE_BYTES = 50 * 1024 * 1024
const ICON_THUMBNAIL_MAX_PX = 128
const ACCEPTED_ICON_IMAGE_TYPES = 'image/png,image/jpeg,image/webp'

export async function readIconImageDataUrl(source: IconImageSource): Promise<string | null> {
  if (source === 'file') {
    const file = await pickIconImageFile()
    if (!file) return null
    validateIconImageFile(file)
    return imageFileToThumbnailPngDataUrl(file, ICON_THUMBNAIL_MAX_PX)
  }

  const image = await readClipboardImage()
  return tauriImageToThumbnailPngDataUrl(image, ICON_THUMBNAIL_MAX_PX)
}

async function pickIconImageFile(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = ACCEPTED_ICON_IMAGE_TYPES
    input.onchange = () => {
      const file = input.files?.[0] ?? null
      resolve(file)
      input.remove()
    }
    input.oncancel = () => {
      resolve(null)
      input.remove()
    }
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    document.body.appendChild(input)
    input.click()
  })
}

function validateIconImageFile(file: File): void {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件')
  if (file.size > MAX_ICON_IMAGE_BYTES) throw new Error('图片过大（> 50MB）')
}

async function readClipboardImage(): Promise<ClipboardImage> {
  try {
    return await readImage()
  } catch (error) {
    const message = errorMessage(error)
    throw new Error(message || '剪贴板里没有可用图片')
  }
}

async function imageFileToThumbnailPngDataUrl(file: File, maxPx: number): Promise<string> {
  const dataUrl = await fileToDataUrl(file)
  const image = await imageElementFromDataUrl(dataUrl)
  return imageElementToThumbnailPngDataUrl(image, maxPx)
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(file)
  })
}

function imageElementFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('加载图片失败'))
    image.src = dataUrl
  })
}

function imageElementToThumbnailPngDataUrl(image: HTMLImageElement, maxPx: number): string {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (!width || !height) throw new Error('图片尺寸无效')

  const canvas = document.createElement('canvas')
  const output = thumbnailSize(width, height, maxPx)
  canvas.width = output.width
  canvas.height = output.height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 不可用')
  ctx.drawImage(image, 0, 0, output.width, output.height)
  return canvas.toDataURL('image/png')
}

async function tauriImageToThumbnailPngDataUrl(image: ClipboardImage, maxPx: number): Promise<string> {
  const size = await image.size()
  const width = Number(size.width)
  const height = Number(size.height)
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('剪贴板图片尺寸无效')
  }

  const expectedRgbaBytes = width * height * 4
  if (expectedRgbaBytes > MAX_ICON_IMAGE_BYTES) throw new Error('剪贴板图片过大（解码后 > 50MB）')

  const rgba = await image.rgba()
  if (rgba.length !== expectedRgbaBytes) throw new Error('剪贴板图片像素数据无效')
  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = width
  sourceCanvas.height = height

  const sourceCtx = sourceCanvas.getContext('2d')
  if (!sourceCtx) throw new Error('Canvas 不可用')
  sourceCtx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)

  const output = thumbnailSize(width, height, maxPx)
  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = output.width
  outputCanvas.height = output.height

  const outputCtx = outputCanvas.getContext('2d')
  if (!outputCtx) throw new Error('Canvas 不可用')
  outputCtx.drawImage(sourceCanvas, 0, 0, output.width, output.height)
  return outputCanvas.toDataURL('image/png')
}

function thumbnailSize(width: number, height: number, maxPx: number): { width: number; height: number } {
  const scale = Math.min(1, maxPx / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return ''
}
