import { readText, writeText, readImage, writeImage as writeClipboardImage } from '@tauri-apps/plugin-clipboard-manager'
import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { Image as TauriImage } from '@tauri-apps/api/image'

let dataDir: string | null = null
let readImageErrorLogged = false

type ClipboardImageLike = {
  rgba: () => Promise<Uint8Array>
  size: () => Promise<{ width: number; height: number }>
}

async function getDataDir(): Promise<string> {
  if (!dataDir) {
    dataDir = await invoke<string>('get_data_dir')
  }
  return dataDir
}

// 插件 API，暴露给插件使用
export const fastWindowApi = {
  // 剪贴板操作
  clipboard: {
    readText: () => readText(),
    writeText: (text: string) => writeText(text),
    readImage: async () => {
      try {
        const image = await readImage()
        if (image) {
          const clipboardImage = image as unknown as ClipboardImageLike
          // 转换为 base64 data URL
          const rgba = await clipboardImage.rgba()
          const { width, height } = await clipboardImage.size()

          // 创建 canvas 转换为 PNG
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (ctx) {
            const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height)
            ctx.putImageData(imageData, 0, 0)
            return canvas.toDataURL('image/png')
          }
        }
        return null
      } catch (e) {
        if (!readImageErrorLogged) {
          readImageErrorLogged = true
          console.debug('[fastWindowApi.clipboard.readImage] failed:', e)
        }
        return null
      }
    },
    writeImage: async (dataUrl: string) => {
      if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
        throw new Error('writeImage only supports data URL currently')
      }

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new window.Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('Failed to load image data URL'))
        el.src = dataUrl
      })

      const width = img.naturalWidth || img.width
      const height = img.naturalHeight || img.height
      if (!width || !height) {
        throw new Error('Invalid image size')
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        throw new Error('Canvas 2D context unavailable')
      }

      ctx.drawImage(img, 0, 0, width, height)
      const imageData = ctx.getImageData(0, 0, width, height)
      const rgba = new Uint8Array(imageData.data)

      const tauriImage = await TauriImage.new(rgba, width, height)
      await writeClipboardImage(tauriImage)
    },
  },

  // 文件存储（每个插件一个 JSON 文件）
  storage: {
    get: async (pluginId: string, key: string) => {
      try {
        const dir = await getDataDir()
        const filePath = `${dir}/${pluginId}.json`

        if (!await exists(filePath)) {
          return null
        }

        const content = await readTextFile(filePath)
        const data = JSON.parse(content)
        return data[key] ?? null
      } catch (e) {
        console.error('Storage get error:', e)
        return null
      }
    },

    set: async (pluginId: string, key: string, value: unknown) => {
      try {
        const dir = await getDataDir()
        const filePath = `${dir}/${pluginId}.json`

        let data: Record<string, unknown> = {}

        if (await exists(filePath)) {
          const content = await readTextFile(filePath)
          data = JSON.parse(content)
        }

        data[key] = value
        await writeTextFile(filePath, JSON.stringify(data, null, 2))
      } catch (e) {
        console.error('Storage set error:', e)
      }
    },

    remove: async (pluginId: string, key: string) => {
      try {
        const dir = await getDataDir()
        const filePath = `${dir}/${pluginId}.json`

        if (!await exists(filePath)) {
          return
        }

        const content = await readTextFile(filePath)
        const data = JSON.parse(content)
        delete data[key]
        await writeTextFile(filePath, JSON.stringify(data, null, 2))
      } catch (e) {
        console.error('Storage remove error:', e)
      }
    },

    getAll: async (pluginId: string) => {
      try {
        const dir = await getDataDir()
        const filePath = `${dir}/${pluginId}.json`

        if (!await exists(filePath)) {
          return {}
        }

        const content = await readTextFile(filePath)
        return JSON.parse(content)
      } catch (e) {
        console.error('Storage getAll error:', e)
        return {}
      }
    },

    setAll: async (pluginId: string, data: Record<string, unknown>) => {
      try {
        const dir = await getDataDir()
        const filePath = `${dir}/${pluginId}.json`
        await writeTextFile(filePath, JSON.stringify(data, null, 2))
      } catch (e) {
        console.error('Storage setAll error:', e)
      }
    },
  },

  // UI 相关
  ui: {
    showToast: (message: string) => {
      window.dispatchEvent(new CustomEvent('fast-window:toast', { detail: { message } }))
    },
  },
}

// 初始化全局 API
export function initPluginApi() {
  (window as any).fastWindow = fastWindowApi
}
