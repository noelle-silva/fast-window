import { PLUGIN_ID } from '../shared/constants'
import { STORAGE_KEYS, STORAGE_META_PATH, STORAGE_SCHEMA_VERSION } from '../shared/storageKeys'
import { nowId } from '../shared/historyDomain'
import type { ClipboardWatchTask } from '../shared/types'

const COMMANDS = {
  filesListDir: 'plugin_files_list_dir',
  filesReadText: 'plugin_files_read_text',
  filesWriteText: 'plugin_files_write_text',
  filesDelete: 'plugin_files_delete',
  taskCreate: 'task_create',
  taskGet: 'task_get',
  taskList: 'task_list',
  taskCancel: 'task_cancel',
  imagesRead: 'plugin_images_read',
  imagesDelete: 'plugin_images_delete',
  startDragging: 'plugin:window|start_dragging',
  writeText: 'plugin:clipboard-manager|write_text',
  writeImageDataUrl: 'clipboard_write_image_data_url',
} as const

type TauriLike = {
  invoke(req: { command: string; payload?: unknown }): Promise<unknown>
}

export type V2HostAdapter = {
  host: {
    toast(message: string): Promise<void>
    back(): Promise<void>
    startDragging(): Promise<void>
  }
  rawStorage: {
    readJson(path: string): Promise<unknown | null>
    writeJson(path: string, value: unknown): Promise<void>
    delete(path: string): Promise<void>
  }
  tasks: {
    create(req: { kind: string; payload?: unknown }): Promise<ClipboardWatchTask | null>
    get(taskId: string): Promise<ClipboardWatchTask | null>
    list(limit?: number | null): Promise<ClipboardWatchTask[]>
    cancel(taskId: string): Promise<void>
  }
  clipboard: {
    writeText(text: string): Promise<void>
    writeImage(dataUrl: string): Promise<void>
  }
  images: {
    read(req: { scope: 'output' | 'data'; path: string }): Promise<string>
    delete(req: { scope: 'output' | 'data'; path: string }): Promise<void>
  }
  runtime: 'ui' | 'background'
}

function createToast(): (message: string) => void {
  let el: HTMLDivElement | null = null
  let timer = 0

  function ensure() {
    if (typeof document === 'undefined') return null
    if (el && el.isConnected) return el
    el = document.createElement('div')
    el.style.position = 'fixed'
    el.style.left = '50%'
    el.style.bottom = '24px'
    el.style.transform = 'translateX(-50%)'
    el.style.maxWidth = 'min(520px, calc(100vw - 24px))'
    el.style.padding = '10px 12px'
    el.style.borderRadius = '10px'
    el.style.background = 'rgba(0,0,0,0.82)'
    el.style.color = '#fff'
    el.style.fontSize = '12px'
    el.style.lineHeight = '1.4'
    el.style.boxShadow = '0 6px 18px rgba(0,0,0,0.28)'
    el.style.zIndex = '999999'
    el.style.opacity = '0'
    el.style.transition = 'opacity 160ms ease'
    el.style.pointerEvents = 'none'
    document.body.appendChild(el)
    return el
  }

  return (message) => {
    const d = ensure()
    if (!d) return
    const text = String(message || '').trim()
    if (!text) return
    d.textContent = text
    d.style.opacity = '1'
    clearTimeout(timer)
    timer = window.setTimeout(() => {
      if (d && d.isConnected) d.style.opacity = '0'
    }, 1800)
  }
}

function safeStorageKey(raw: string): string {
  const k = String(raw || '').trim()
  if (!k) throw new Error('storage key 不能为空')
  if (k.length > 80) throw new Error('storage key 过长')
  if (!/^[a-zA-Z0-9._-]+$/.test(k)) throw new Error(`storage key 不合法：${k}`)
  if (k === '__proto__' || k === 'constructor' || k === 'prototype') throw new Error(`storage key 不安全：${k}`)
  return k
}

function keyToPath(key: string): string {
  return `${safeStorageKey(key)}.json`
}

function asTask(value: unknown): ClipboardWatchTask | null {
  return value && typeof value === 'object' ? (value as ClipboardWatchTask) : null
}

export function createV2HostAdapter(baseApi: any): V2HostAdapter {
  const base = baseApi || {}
  const tauri = base && base.tauri ? (base.tauri as TauriLike) : null
  if (!tauri || typeof tauri.invoke !== 'function') {
    throw new Error('tauri.invoke 不可用（请更新宿主网关）')
  }

  const toast = createToast()
  let storageReady = false
  let storageReadyPromise: Promise<void> | null = null

  async function filesListDir(dir: string | null) {
    return tauri.invoke({ command: COMMANDS.filesListDir, payload: { pluginId: PLUGIN_ID, req: { scope: 'data', dir } } })
  }

  async function filesReadText(path: string) {
    return tauri.invoke({ command: COMMANDS.filesReadText, payload: { pluginId: PLUGIN_ID, req: { scope: 'data', path } } })
  }

  async function filesWriteText(path: string, text: string) {
    return tauri.invoke({
      command: COMMANDS.filesWriteText,
      payload: { pluginId: PLUGIN_ID, req: { scope: 'data', path, text: String(text ?? ''), overwrite: true } },
    })
  }

  async function filesDelete(path: string) {
    return tauri.invoke({ command: COMMANDS.filesDelete, payload: { pluginId: PLUGIN_ID, req: { scope: 'data', path } } })
  }

  async function readJson(path: string): Promise<unknown | null> {
    let text = ''
    try {
      text = String(await filesReadText(path))
    } catch (e: any) {
      const msg = String(e?.message || e || '')
      if (msg.includes('文件不存在')) return null
      throw e
    }
    const s = String(text || '').trim()
    if (!s) return null
    try {
      return JSON.parse(s)
    } catch {
      throw new Error(`JSON 解析失败：${path}`)
    }
  }

  async function writeJson(path: string, value: unknown): Promise<void> {
    const text = JSON.stringify(value ?? null, null, 2) + '\n'
    await filesWriteText(path, text)
  }

  async function ensureStorageReady(): Promise<void> {
    if (storageReady) return
    if (storageReadyPromise) return storageReadyPromise

    storageReadyPromise = Promise.resolve()
      .then(async () => {
        await filesListDir(null)

        const meta = await readJson(STORAGE_META_PATH).catch(() => null)
        if (meta && typeof meta === 'object' && Number((meta as Record<string, unknown>).schemaVersion || 0) >= STORAGE_SCHEMA_VERSION) {
          storageReady = true
          return
        }

        const entries = await filesListDir(null).catch(() => [])
        const names = new Set(
          Array.isArray(entries) ? entries.filter((e: any) => e && e.isFile).map((e: any) => String(e.name || '')) : [],
        )
        if (STORAGE_KEYS.some((k) => names.has(keyToPath(k)))) {
          await writeJson(STORAGE_META_PATH, {
            schemaVersion: STORAGE_SCHEMA_VERSION,
            migratedAt: Date.now(),
            reason: 'shards-existed',
          })
          storageReady = true
          return
        }

        const source: Record<string, unknown> = { from: `${PLUGIN_ID}.json` }
        const storeObj = await readJson(`${PLUGIN_ID}.json`).catch(() => null)
        const obj = storeObj && typeof storeObj === 'object' ? (storeObj as Record<string, unknown>) : null
        if (obj) {
          const snapshot: Record<string, unknown> = {}
          for (const k of STORAGE_KEYS) {
            if (obj[k] != null) snapshot[k] = obj[k]
          }
          if (Object.keys(snapshot).length) {
            await writeJson(`_backup-migrate-${nowId()}.json`, snapshot).catch(() => {})
            for (const k of Object.keys(snapshot)) await writeJson(keyToPath(k), snapshot[k])
            await writeJson(STORAGE_META_PATH, { schemaVersion: STORAGE_SCHEMA_VERSION, migratedAt: Date.now(), source })
            storageReady = true
            return
          }
        } else {
          source.fileReadable = false
        }

        await writeJson(STORAGE_META_PATH, { schemaVersion: STORAGE_SCHEMA_VERSION, createdAt: Date.now(), freshInstall: true, source }).catch(
          () => {},
        )
        storageReady = true
      })
      .finally(() => {
        storageReadyPromise = null
      })

    return storageReadyPromise
  }

  return {
    runtime: String((base && base.__meta && base.__meta.runtime) || 'ui') === 'background' ? 'background' : 'ui',
    host: {
      toast: async (message) => {
        toast(message)
      },
      back: async () => {
        if (base.host && typeof base.host.back === 'function') return base.host.back()
        toast('无法返回')
      },
      startDragging: async () => {
        try {
          await tauri.invoke({ command: COMMANDS.startDragging, payload: {} })
        } catch (e: any) {
          toast(String(e?.message || e || '无法拖拽'))
        }
      },
    },
    rawStorage: {
      readJson: async (path) => {
        await ensureStorageReady()
        return readJson(path)
      },
      writeJson: async (path, value) => {
        await ensureStorageReady()
        await writeJson(path, value)
      },
      delete: async (path) => {
        await ensureStorageReady()
        await filesDelete(path).catch((e: any) => {
          const msg = String(e?.message || e || '')
          if (msg.includes('文件不存在')) return
          throw e
        })
      },
    },
    tasks: {
      create: async (req) => {
        const kind = String(req && req.kind ? req.kind : '').trim()
        if (!kind) throw new Error('task kind is required')
        const result = await tauri.invoke({
          command: COMMANDS.taskCreate,
          payload: { pluginId: PLUGIN_ID, req: { kind, payload: req && 'payload' in req ? req.payload : null } },
        })
        return asTask(result)
      },
      get: async (taskId) => {
        const tid = String(taskId || '').trim()
        if (!tid) return null
        return asTask(await tauri.invoke({ command: COMMANDS.taskGet, payload: { pluginId: PLUGIN_ID, taskId: tid } }))
      },
      list: async (limit) => {
        const lim = typeof limit === 'number' && Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : null
        const result = await tauri.invoke({ command: COMMANDS.taskList, payload: { pluginId: PLUGIN_ID, limit: lim } })
        return Array.isArray(result) ? (result as ClipboardWatchTask[]) : []
      },
      cancel: async (taskId) => {
        const tid = String(taskId || '').trim()
        if (!tid) throw new Error('taskId is required')
        await tauri.invoke({ command: COMMANDS.taskCancel, payload: { pluginId: PLUGIN_ID, taskId: tid } })
      },
    },
    clipboard: {
      writeText: async (text) => {
        await tauri.invoke({ command: COMMANDS.writeText, payload: { text: String(text || '') } })
      },
      writeImage: async (dataUrl) => {
        const u = String(dataUrl || '').trim()
        if (!u || !u.startsWith('data:')) throw new Error('writeImage only supports data URL currently')
        await tauri.invoke({ command: COMMANDS.writeImageDataUrl, payload: { dataUrl: u } })
      },
    },
    images: {
      read: async (req) => {
        return String(await tauri.invoke({ command: COMMANDS.imagesRead, payload: { pluginId: PLUGIN_ID, req } }))
      },
      delete: async (req) => {
        await tauri.invoke({ command: COMMANDS.imagesDelete, payload: { pluginId: PLUGIN_ID, req } })
      },
    },
  }
}
