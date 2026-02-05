import { readText, writeText, readImage, writeImage as writeClipboardImage } from '@tauri-apps/plugin-clipboard-manager'
import { invoke } from '@tauri-apps/api/core'
import { Image as TauriImage } from '@tauri-apps/api/image'
import { isCapabilityAllowed, PLUGIN_API_VERSION, PluginCapability } from './pluginContract'

let readImageErrorLogged = false

type ClipboardImageLike = {
  rgba: () => Promise<Uint8Array>
  size: () => Promise<{ width: number; height: number }>
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
        return await invoke<unknown | null>('storage_get', { pluginId, key })
      } catch (e) {
        console.error('Storage get error:', e)
        return null
      }
    },

    set: async (pluginId: string, key: string, value: unknown) => {
      try {
        await invoke('storage_set', { pluginId, key, value })
      } catch (e) {
        console.error('Storage set error:', e)
      }
    },

    remove: async (pluginId: string, key: string) => {
      try {
        await invoke('storage_remove', { pluginId, key })
      } catch (e) {
        console.error('Storage remove error:', e)
      }
    },

    getAll: async (pluginId: string) => {
      try {
        return await invoke<Record<string, unknown>>('storage_get_all', { pluginId })
      } catch (e) {
        console.error('Storage getAll error:', e)
        return {}
      }
    },

    setAll: async (pluginId: string, data: Record<string, unknown>) => {
      try {
        await invoke('storage_set_all', { pluginId, data })
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
    openUrl: async (url: string) => {
      const u = String(url || '').trim()
      if (!u) return
      await invoke('open_external_url', { url: u })
    },
  },

  // 网络请求（通过 tauri 后端，避免浏览器 CORS）
  net: {
    request: async (req: {
      method: string
      url: string
      headers?: Record<string, string>
      body?: string | null
      // 以 base64 发送二进制（例如图片）。可接受纯 base64 或 data URL。
      bodyBase64?: string | null
      timeoutMs?: number | null
    }) => {
      return invoke<{
        status: number
        body: string
        headers: Record<string, string>
      }>('http_request', { req })
    },
  },
}

export type FastWindowApi = {
  clipboard: typeof fastWindowApi.clipboard
  storage: {
    get: (key: string) => Promise<unknown | null>
    set: (key: string, value: unknown) => Promise<void>
    remove: (key: string) => Promise<void>
    getAll: () => Promise<Record<string, unknown>>
    setAll: (data: Record<string, unknown>) => Promise<void>
  }
  ui: typeof fastWindowApi.ui & {
    back?: () => Promise<void> | void
  }
  net: typeof fastWindowApi.net
  files: {
    getOutputDir: () => Promise<string>
    pickOutputDir: () => Promise<string | null>
    openOutputDir: () => Promise<void>
    saveImageBase64: (dataUrlOrBase64: string) => Promise<string>
  }
}

export type PluginContext = {
  apiVersion: number
  id: string
  requires?: PluginCapability[]
  api: FastWindowApi
}

function assertAllowed(requires: PluginCapability[] | undefined, needed: any) {
  // 按用户要求：不做强校验（不拦截执行），只做一次性提示；边界主要靠 iframe 隔离来保证
  if (!requires || requires.length === 0) return
  if (isCapabilityAllowed(requires, needed)) return

  const key = `${String(needed)}`
  ;(assertAllowed as any)._warned ??= new Set<string>()
  const warned: Set<string> = (assertAllowed as any)._warned
  if (!warned.has(key)) {
    warned.add(key)
    console.warn(`[plugin] capability not declared but allowed (no strong enforcement): ${key}`)
  }
}

export function createPluginContext(pluginId: string, requires?: PluginCapability[]): PluginContext {
  const api: FastWindowApi = {
    clipboard: {
      readText: async () => {
        assertAllowed(requires, 'clipboard.readText')
        return fastWindowApi.clipboard.readText()
      },
      writeText: async (text: string) => {
        assertAllowed(requires, 'clipboard.writeText')
        return fastWindowApi.clipboard.writeText(text)
      },
      readImage: async () => {
        assertAllowed(requires, 'clipboard.readImage')
        return fastWindowApi.clipboard.readImage()
      },
      writeImage: async (dataUrl: string) => {
        assertAllowed(requires, 'clipboard.writeImage')
        return fastWindowApi.clipboard.writeImage(dataUrl)
      },
    },
    storage: {
      get: async (pluginIdOrKey: string, key?: string) => {
        assertAllowed(requires, 'storage.get')
        const pid = key ? pluginIdOrKey : pluginId
        const k = key ?? pluginIdOrKey
        return fastWindowApi.storage.get(pid, k)
      },
      set: async (pluginIdOrKey: string, keyOrValue: any, value?: unknown) => {
        assertAllowed(requires, 'storage.set')
        const pid = value === undefined ? pluginId : pluginIdOrKey
        const k = value === undefined ? pluginIdOrKey : keyOrValue
        const v = value === undefined ? keyOrValue : value
        return fastWindowApi.storage.set(pid, k, v)
      },
      remove: async (pluginIdOrKey: string, key?: string) => {
        assertAllowed(requires, 'storage.remove')
        const pid = key ? pluginIdOrKey : pluginId
        const k = key ?? pluginIdOrKey
        return fastWindowApi.storage.remove(pid, k)
      },
      getAll: async (pid?: string) => {
        assertAllowed(requires, 'storage.getAll')
        return fastWindowApi.storage.getAll(pid ?? pluginId)
      },
      setAll: async (pidOrData: any, data?: Record<string, unknown>) => {
        assertAllowed(requires, 'storage.setAll')
        const pid = data ? pidOrData : pluginId
        const d = data ?? pidOrData
        return fastWindowApi.storage.setAll(pid, d)
      },
    } as any,
    ui: {
      showToast: (message: string) => {
        assertAllowed(requires, 'ui.showToast')
        return fastWindowApi.ui.showToast(message)
      },
      openUrl: async (url: string) => {
        assertAllowed(requires, 'ui.openUrl')
        return fastWindowApi.ui.openUrl(url)
      },
    },
    net: {
      request: async (req: any) => {
        assertAllowed(requires, 'net.request')
        return fastWindowApi.net.request(req)
      },
    },
    files: {
      getOutputDir: async () => {
        assertAllowed(requires, 'files.getOutputDir')
        return invoke<string>('plugin_get_output_dir', { pluginId })
      },
      pickOutputDir: async () => {
        assertAllowed(requires, 'files.pickOutputDir')
        return invoke<string | null>('plugin_pick_output_dir', { pluginId })
      },
      openOutputDir: async () => {
        assertAllowed(requires, 'files.openOutputDir')
        await invoke('plugin_open_output_dir', { pluginId })
      },
      saveImageBase64: async (dataUrlOrBase64: string) => {
        assertAllowed(requires, 'files.saveImageBase64')
        return invoke<string>('plugin_save_image_base64', { pluginId, data: dataUrlOrBase64 })
      },
    },
  }

  return {
    apiVersion: PLUGIN_API_VERSION,
    id: pluginId,
    requires,
    api,
  }
}

// 初始化全局 API
export function initPluginApi() {
  (window as any).fastWindow = fastWindowApi
}
