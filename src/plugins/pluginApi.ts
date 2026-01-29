import { readText, writeText, readImage } from '@tauri-apps/plugin-clipboard-manager'
import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'

let dataDir: string | null = null

type ClipboardImageLike = {
  rgba: () => Promise<Uint8Array>
  width: () => Promise<number>
  height: () => Promise<number>
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
          const width = await clipboardImage.width()
          const height = await clipboardImage.height()

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
        return null
      }
    },
    writeImage: async (_dataUrl: string) => {
      // 暂不支持写入图片，只写文本提示
      console.log('Image write not fully supported yet')
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
      console.log('[Toast]', message)
    },
  },
}

// 初始化全局 API
export function initPluginApi() {
  (window as any).fastWindow = fastWindowApi
}
