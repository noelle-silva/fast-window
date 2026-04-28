import { createToast } from './createToast'
import { normalizeOutputPath, normalizePickedImages, normalizeStringList, normalizeTask, normalizeTaskList } from './normalizeGatewayData'
import { createShardedStorage, type TextFilePort } from './storageShards'
import type { AiDrawCreateTaskRequest, AiDrawGateway, AiDrawHttpRequest, AiDrawRuntimeKind } from './types'

type TauriLike = {
  invoke: (spec: { command: string; payload?: unknown; timeoutMs?: number | null }) => Promise<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function resolveRuntime(baseApi: unknown): AiDrawRuntimeKind {
  const meta = isRecord(baseApi) && isRecord(baseApi.__meta) ? baseApi.__meta : null
  return meta && meta.runtime === 'background' ? 'background' : 'ui'
}

function resolveTauri(baseApi: unknown): TauriLike {
  const tauri = isRecord(baseApi) && isRecord(baseApi.tauri) ? baseApi.tauri : null
  if (!tauri || typeof tauri.invoke !== 'function') {
    throw new Error('AiDrawGateway 不可用：tauri.invoke 不可用')
  }
  return tauri as TauriLike
}

function normalizeHeaders(headers: unknown) {
  if (!isRecord(headers)) return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    const k = String(key || '').trim()
    if (!k) continue
    out[k] = String(value ?? '')
  }
  return out
}

function normalizeHttpRequest(req: AiDrawHttpRequest) {
  const method = String(req.method || 'GET').trim() || 'GET'
  const url = String(req.url || '').trim()
  const timeoutMs = typeof req.timeoutMs === 'number' && Number.isFinite(req.timeoutMs) ? Math.max(0, Math.floor(req.timeoutMs)) : null
  return {
    method,
    url,
    headers: normalizeHeaders(req.headers),
    body: typeof req.body === 'string' ? req.body : undefined,
    bodyBase64: typeof req.bodyBase64 === 'string' ? req.bodyBase64 : undefined,
    timeoutMs: timeoutMs ?? undefined,
  }
}

function normalizeTaskRequest(req: AiDrawCreateTaskRequest) {
  const kind = String(req.kind || '').trim()
  if (!kind) throw new Error('task kind is required')
  const meta = isRecord(req.meta) ? req.meta : undefined
  return { kind, payload: req.payload, meta }
}

export function createV2AiDrawGateway(baseApi: unknown, pluginId: string): AiDrawGateway {
  const base = isRecord(baseApi) ? baseApi : {}
  const tauri = resolveTauri(baseApi)
  const PLUGIN_ID = String(pluginId || '').trim()
  if (!PLUGIN_ID) throw new Error('AiDrawGateway 不可用：pluginId 为空')

  const runtime = resolveRuntime(baseApi)
  const toast = createToast()
  const UI_PICKER_TIMEOUT_MS = 30 * 60 * 1000
  const IMAGE_IO_TIMEOUT_MS = 15 * 60 * 1000

  const textFiles: TextFilePort = {
    listDir: async (_scope, dir) => {
      const raw = await tauri.invoke({ command: 'plugin_files_list_dir', payload: { pluginId: PLUGIN_ID, req: { scope: 'data', dir } } })
      return Array.isArray(raw) ? raw.map((entry) => (isRecord(entry) ? { name: String(entry.name || ''), isFile: entry.isFile === true } : {})) : []
    },
    readText: async (_scope, path) => {
      return String(await tauri.invoke({ command: 'plugin_files_read_text', payload: { pluginId: PLUGIN_ID, req: { scope: 'data', path } } }))
    },
    writeText: async (_scope, path, text, overwrite) => {
      await tauri.invoke({
        command: 'plugin_files_write_text',
        payload: { pluginId: PLUGIN_ID, req: { scope: 'data', path, text: String(text ?? ''), overwrite: overwrite !== false } },
      })
    },
    delete: async (_scope, path) => {
      await tauri.invoke({ command: 'plugin_files_delete', payload: { pluginId: PLUGIN_ID, req: { scope: 'data', path } } })
    },
  }

  const storage = createShardedStorage(textFiles)

  return {
    runtime,
    host: {
      back: async () => {
        const host = isRecord(base.host) ? base.host : null
        if (host && typeof host.back === 'function') {
          await host.back()
          return
        }
        toast('宿主不支持返回')
      },
      toast: (message: string) => toast(message),
      startDragging: async () => {
        try {
          await tauri.invoke({ command: 'plugin:window|start_dragging', payload: {} })
        } catch (e: unknown) {
          toast(String(e instanceof Error ? e.message : e || '无法拖拽'))
        }
      },
    },
    clipboard: {
      writeText: async (text: string) => {
        await tauri.invoke({ command: 'plugin:clipboard-manager|write_text', payload: { text: String(text || '') } })
      },
      writeImage: async (dataUrl: string) => {
        const u = String(dataUrl || '').trim()
        if (!u || !u.startsWith('data:')) throw new Error('writeImage 只支持 data URL')
        await tauri.invoke({ command: 'clipboard_write_image_data_url', payload: { dataUrl: u } })
      },
    },
    settingsStore: {
      read: () => storage.read('settings'),
      write: (settings) => storage.write('settings', settings),
    },
    taskHistoryStore: {
      read: () => storage.read('taskHistory'),
      write: (items) => storage.write('taskHistory', items),
    },
    promptLibraryStore: {
      read: () => storage.read('promptLibrary'),
      write: (library) => storage.write('promptLibrary', library),
    },
    referenceLibraryIndexStore: {
      read: () => storage.read('refLibraryIndex'),
      write: (index) => storage.write('refLibraryIndex', index),
    },
    backgroundSaveQueue: {
      readRequests: async () => (await storage.read('bgSaveRequests')) || {},
      writeRequests: (map) => storage.write('bgSaveRequests', map),
      readResponses: async () => (await storage.read('bgSaveResponses')) || {},
      writeResponses: (map) => storage.write('bgSaveResponses', map),
      readSavedResults: async () => (await storage.read('bgSavedResults')) || {},
      writeSavedResults: (map) => storage.write('bgSavedResults', map),
    },
    outputImages: {
      getOutputDir: async () => normalizeOutputPath(await tauri.invoke({ command: 'plugin_get_output_dir', payload: { pluginId: PLUGIN_ID } })),
      pickOutputDir: async () => {
        const picked = await tauri.invoke({ command: 'plugin_pick_output_dir', payload: { pluginId: PLUGIN_ID }, timeoutMs: UI_PICKER_TIMEOUT_MS })
        const path = normalizeOutputPath(picked)
        return path || null
      },
      openOutputDir: async () => {
        try {
          await tauri.invoke({ command: 'plugin_open_output_dir', payload: { pluginId: PLUGIN_ID } })
        } catch (e: unknown) {
          toast(String(e instanceof Error ? e.message : e || '打开目录失败'))
          throw e
        }
      },
      list: async () => normalizeStringList(await tauri.invoke({ command: 'plugin_images_list', payload: { pluginId: PLUGIN_ID, req: { scope: 'output' } } })),
      read: async (path: string) => String(await tauri.invoke({ command: 'plugin_images_read', payload: { pluginId: PLUGIN_ID, req: { scope: 'output', path } }, timeoutMs: IMAGE_IO_TIMEOUT_MS })),
      saveBase64: async (dataUrlOrBase64: string) => normalizeOutputPath(await tauri.invoke({ command: 'plugin_images_write_base64', payload: { pluginId: PLUGIN_ID, req: { scope: 'output', dataUrlOrBase64 } }, timeoutMs: IMAGE_IO_TIMEOUT_MS })),
      delete: async (path: string) => {
        await tauri.invoke({ command: 'plugin_images_delete', payload: { pluginId: PLUGIN_ID, req: { scope: 'output', path } }, timeoutMs: IMAGE_IO_TIMEOUT_MS })
      },
    },
    referenceImages: {
      pick: async (maxCount: number) => {
        const mc = maxCount == null ? 0 : Math.max(0, Math.floor(Number(maxCount) || 0))
        const raw = await tauri.invoke({ command: 'plugin_pick_images', payload: { pluginId: PLUGIN_ID, maxCount: mc }, timeoutMs: UI_PICKER_TIMEOUT_MS })
        return normalizePickedImages(raw, mc)
      },
      list: async () => normalizeStringList(await tauri.invoke({ command: 'plugin_images_list', payload: { pluginId: PLUGIN_ID, req: { scope: 'data' } } })),
      read: async (path: string) => String(await tauri.invoke({ command: 'plugin_images_read', payload: { pluginId: PLUGIN_ID, req: { scope: 'data', path } }, timeoutMs: IMAGE_IO_TIMEOUT_MS })),
      saveBase64: async (dataUrlOrBase64: string) => normalizeOutputPath(await tauri.invoke({ command: 'plugin_images_write_base64', payload: { pluginId: PLUGIN_ID, req: { scope: 'data', dataUrlOrBase64 } }, timeoutMs: IMAGE_IO_TIMEOUT_MS })),
      delete: async (path: string) => {
        await tauri.invoke({ command: 'plugin_images_delete', payload: { pluginId: PLUGIN_ID, req: { scope: 'data', path } }, timeoutMs: IMAGE_IO_TIMEOUT_MS })
      },
    },
    generationTasks: {
      requestHttpTask: async (req: AiDrawHttpRequest) => {
        const task = normalizeTask(
          await tauri.invoke({
            command: 'task_create',
            payload: { pluginId: PLUGIN_ID, req: { kind: 'http.request', payload: normalizeHttpRequest(req) } },
          }),
        )
        if (!task) throw new Error('创建后台任务失败：返回任务无效')
        return task
      },
      create: async (req: AiDrawCreateTaskRequest) => {
        const task = normalizeTask(await tauri.invoke({ command: 'task_create', payload: { pluginId: PLUGIN_ID, req: normalizeTaskRequest(req) } }))
        if (!task) throw new Error('创建后台任务失败：返回任务无效')
        return task
      },
      get: async (taskId: string) => {
        const tid = String(taskId || '').trim()
        if (!tid) return null
        return normalizeTask(await tauri.invoke({ command: 'task_get', payload: { pluginId: PLUGIN_ID, taskId: tid } }))
      },
      list: async (limit?: number | null) => {
        const lim = typeof limit === 'number' && Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : null
        return normalizeTaskList(await tauri.invoke({ command: 'task_list', payload: { pluginId: PLUGIN_ID, limit: lim } }))
      },
      cancel: async (taskId: string) => {
        const tid = String(taskId || '').trim()
        if (!tid) throw new Error('taskId is required')
        await tauri.invoke({ command: 'task_cancel', payload: { pluginId: PLUGIN_ID, taskId: tid } })
      },
    },
  }
}
