import { readText, writeText, readImage, writeImage as writeClipboardImage } from '@tauri-apps/plugin-clipboard-manager'
import { invoke } from '@tauri-apps/api/core'
import { Image as TauriImage } from '@tauri-apps/api/image'
import { PLUGIN_API_VERSION, PluginCapability } from './pluginContract'

let readImageErrorLogged = false

type ClipboardImageLike = {
  rgba: () => Promise<Uint8Array>
  size: () => Promise<{ width: number; height: number }>
}

export type PluginTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'

export type PluginTaskInfo = {
  id: string
  pluginId: string
  kind: string
  status: PluginTaskStatus
  createdAtMs: number
  updatedAtMs: number
  startedAtMs: number | null
  finishedAtMs: number | null
  cancelRequested: boolean
  error: string | null
  result: unknown | null
}

export type PluginPickedImage = {
  name: string
  dataUrl: string
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
    openExternal: async (uri: string) => {
      const u = String(uri || '').trim()
      if (!u) return
      await invoke('open_external_uri', { uri: u })
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

    requestBase64: async (req: {
      method: string
      url: string
      headers?: Record<string, string>
      body?: string | null
      bodyBase64?: string | null
      timeoutMs?: number | null
    }) => {
      return invoke<{
        status: number
        bodyBase64: string
        headers: Record<string, string>
      }>('http_request_base64', { req })
    },
  },

  task: {
    create: async (
      pluginId: string,
      req: {
        kind: string
        payload?: unknown
      },
    ) => {
      const kind = String(req?.kind || '').trim()
      if (!kind) throw new Error('task kind is required')
      return invoke<PluginTaskInfo>('task_create', {
        pluginId,
        req: {
          kind,
          payload: req?.payload ?? null,
        },
      })
    },
    get: async (pluginId: string, taskId: string) => {
      const tid = String(taskId || '').trim()
      if (!tid) return null
      return invoke<PluginTaskInfo | null>('task_get', { pluginId, taskId: tid })
    },
    list: async (pluginId: string, limit?: number) => {
      const lim = typeof limit === 'number' && Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : undefined
      return invoke<PluginTaskInfo[]>('task_list', { pluginId, limit: lim })
    },
    cancel: async (pluginId: string, taskId: string) => {
      const tid = String(taskId || '').trim()
      if (!tid) throw new Error('taskId is required')
      return invoke<PluginTaskInfo>('task_cancel', { pluginId, taskId: tid })
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
  net: {
    request: (req: {
      mode?: 'direct' | 'task'
      method: string
      url: string
      headers?: Record<string, string>
      body?: string | null
      bodyBase64?: string | null
      timeoutMs?: number | null
    }) => Promise<
      | {
          status: number
          body: string
          headers: Record<string, string>
        }
      | PluginTaskInfo
    >

    requestBase64: (req: {
      method: string
      url: string
      headers?: Record<string, string>
      body?: string | null
      bodyBase64?: string | null
      timeoutMs?: number | null
    }) => Promise<{
      status: number
      bodyBase64: string
      headers: Record<string, string>
    }>
  }
  task: {
    create: (req: { kind: string; payload?: unknown }) => Promise<PluginTaskInfo>
    get: (taskId: string) => Promise<PluginTaskInfo | null>
    list: (limit?: number) => Promise<PluginTaskInfo[]>
    cancel: (taskId: string) => Promise<PluginTaskInfo>
  }
  files: {
    getOutputDir: () => Promise<string>
    pickOutputDir: () => Promise<string | null>
    pickDir: () => Promise<string | null>
    openOutputDir: () => Promise<void>
    openDir: (dir: string) => Promise<void>
    saveImageBase64: (dataUrlOrBase64: string) => Promise<string>
    saveRefImageBase64: (dataUrlOrBase64: string) => Promise<string>
    listOutputImages: () => Promise<string[]>
    readOutputImage: (path: string) => Promise<string>
    deleteOutputImage: (path: string) => Promise<void>
    listRefImages: () => Promise<string[]>
    readRefImage: (path: string) => Promise<string>
    deleteRefImage: (path: string) => Promise<void>
    pickImages: (maxCount?: number | null) => Promise<PluginPickedImage[]>
  }
}

export type PluginContext = {
  apiVersion: number
  id: string
  requires: PluginCapability[]
  api: FastWindowApi
}

export function createPluginContext(pluginId: string, requires: PluginCapability[]): PluginContext {
  const api: FastWindowApi = {
    clipboard: {
      readText: async () => {
        return fastWindowApi.clipboard.readText()
      },
      writeText: async (text: string) => {
        return fastWindowApi.clipboard.writeText(text)
      },
      readImage: async () => {
        return fastWindowApi.clipboard.readImage()
      },
      writeImage: async (dataUrl: string) => {
        return fastWindowApi.clipboard.writeImage(dataUrl)
      },
    },
    storage: {
      get: async (key: string) => {
        return fastWindowApi.storage.get(pluginId, key)
      },
      set: async (key: string, value: unknown) => {
        return fastWindowApi.storage.set(pluginId, key, value)
      },
      remove: async (key: string) => {
        return fastWindowApi.storage.remove(pluginId, key)
      },
      getAll: async () => {
        return fastWindowApi.storage.getAll(pluginId)
      },
      setAll: async (data: Record<string, unknown>) => {
        return fastWindowApi.storage.setAll(pluginId, data)
      },
    },
    ui: {
      showToast: (message: string) => {
        return fastWindowApi.ui.showToast(message)
      },
      openUrl: async (url: string) => {
        return fastWindowApi.ui.openUrl(url)
      },
      openExternal: async (uri: string) => {
        return fastWindowApi.ui.openExternal(uri)
      },
    },
    net: {
      request: async (req: any) => {
        const mode = String(req?.mode || 'direct')
        if (mode === 'task') {
          return fastWindowApi.task.create(pluginId, {
            kind: 'http.request',
            payload: {
              method: String(req?.method || ''),
              url: String(req?.url || ''),
              headers: req?.headers ?? null,
              body: req?.body ?? null,
              bodyBase64: req?.bodyBase64 ?? null,
              timeoutMs: req?.timeoutMs ?? null,
            },
          })
        }
        return fastWindowApi.net.request(req)
      },
      requestBase64: async (req: any) => {
        const mode = String(req?.mode || 'direct')
        if (mode === 'task') {
          throw new Error('net.requestBase64 does not support mode="task"')
        }
        return fastWindowApi.net.requestBase64(req)
      },
    },
    task: {
      create: async (req: { kind: string; payload?: unknown }) => {
        return fastWindowApi.task.create(pluginId, req)
      },
      get: async (taskId: string) => {
        return fastWindowApi.task.get(pluginId, taskId)
      },
      list: async (limit?: number) => {
        return fastWindowApi.task.list(pluginId, limit)
      },
      cancel: async (taskId: string) => {
        return fastWindowApi.task.cancel(pluginId, taskId)
      },
    },
    files: {
      getOutputDir: async () => {
        return invoke<string>('plugin_get_output_dir', { pluginId })
      },
      pickOutputDir: async () => {
        return invoke<string | null>('plugin_pick_output_dir', { pluginId })
      },
      pickDir: async () => {
        return invoke<string | null>('plugin_pick_dir', { pluginId })
      },
      openOutputDir: async () => {
        await invoke('plugin_open_output_dir', { pluginId })
      },
      openDir: async (dir: string) => {
        await invoke('plugin_open_dir', { pluginId, dir: String(dir ?? '') })
      },
      saveImageBase64: async (dataUrlOrBase64: string) => {
        return invoke<string>('plugin_save_image_base64', { pluginId, data: dataUrlOrBase64 })
      },
      saveRefImageBase64: async (dataUrlOrBase64: string) => {
        return invoke<string>('plugin_save_ref_image_base64', { pluginId, data: dataUrlOrBase64 })
      },
      listOutputImages: async () => {
        return invoke<string[]>('plugin_list_output_images', { pluginId })
      },
      readOutputImage: async (path: string) => {
        return invoke<string>('plugin_read_output_image', { pluginId, path })
      },
      deleteOutputImage: async (path: string) => {
        await invoke('plugin_delete_output_image', { pluginId, path })
      },
      listRefImages: async () => {
        return invoke<string[]>('plugin_list_ref_images', { pluginId })
      },
      readRefImage: async (path: string) => {
        return invoke<string>('plugin_read_ref_image', { pluginId, path })
      },
      deleteRefImage: async (path: string) => {
        await invoke('plugin_delete_ref_image', { pluginId, path })
      },
      pickImages: async (maxCount?: number | null) => {
        return invoke<PluginPickedImage[]>('plugin_pick_images', { pluginId, maxCount: maxCount ?? null })
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
