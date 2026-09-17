export async function clipboardImageDataUrlFromClipboard(): Promise<string> {
  const clipboard = navigator.clipboard
  if (!clipboard || typeof clipboard.read !== 'function') throw new Error('当前环境不支持读取剪贴板图片')
  const items = await clipboard.read()
  return clipboardImageDataUrlFromItems(items)
}

export async function clipboardImageDataUrlFromPasteEvent(event: ClipboardEvent): Promise<string | null> {
  const items = event.clipboardData?.items
  if (!items?.length) return null
  const file = firstImageFile(Array.from(items).map(item => item.getAsFile()).filter(Boolean) as File[])
  return file ? fileToDataUrl(file) : null
}

async function clipboardImageDataUrlFromItems(items: ClipboardItems): Promise<string> {
  for (const item of Array.from(items)) {
    const type = item.types.find(current => current.startsWith('image/'))
    if (!type) continue
    const blob = await item.getType(type)
    return fileToDataUrl(blob)
  }
  throw new Error('剪贴板里没有图片')
}

function firstImageFile(files: File[]): File | null {
  return files.find(file => file.type.startsWith('image/')) || null
}

function fileToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('读取剪贴板图片失败'))
    }
    reader.onerror = () => reject(new Error('读取剪贴板图片失败'))
    reader.readAsDataURL(blob)
  })
}
