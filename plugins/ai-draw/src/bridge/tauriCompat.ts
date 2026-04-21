type TauriLike = {
  invoke: (spec: { command: string; payload?: any; timeoutMs?: number | null }) => Promise<any>
}

function isPlainObject(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function createToast() {
  let el: HTMLDivElement | null = null
  let timer: any = 0

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

  return (message: any) => {
    const d = ensure()
    if (!d) return
    const text = String(message ?? '').trim()
    if (!text) return
    d.textContent = text
    d.style.opacity = '1'
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (d && d.isConnected) d.style.opacity = '0'
    }, 1800)
  }
}

export type AiDrawFastWindowApi = {
  __meta?: { runtime?: string }
  tauri: TauriLike
  ui: {
    showToast: (message: any) => void
    startDragging: () => Promise<void>
  }
  clipboard: {
    writeText: (text: any) => Promise<void>
    writeImage: (dataUrl: any) => Promise<void>
  }
  storage: {
    get: (key: string) => Promise<any>
    set: (key: string, value: any) => Promise<void>
    remove: (key: string) => Promise<void>
  }
  files: {
    getOutputDir: () => Promise<any>
    pickOutputDir: () => Promise<any>
    openOutputDir: () => Promise<any>
    listDir: (req: any) => Promise<any>
    readText: (req: any) => Promise<any>
    writeText: (req: any) => Promise<any>
    delete: (req: any) => Promise<any>
    pickImages: (maxCount?: any) => Promise<any>
    images: {
      writeBase64: (req: any) => Promise<any>
      read: (req: any) => Promise<any>
      list: (req: any) => Promise<any>
      delete: (req: any) => Promise<any>
    }
  }
  net: {
    request: (req: any) => Promise<any>
  }
  task: {
    create: (req: any) => Promise<any>
    get: (taskId: string) => Promise<any>
    list: (limit?: number | null) => Promise<any>
    cancel: (taskId: string) => Promise<any>
  }
}

export function createAiDrawFastWindowApi(baseApi: any, pluginId: string): AiDrawFastWindowApi {
  const base = baseApi || {}
  const tauri: TauriLike | null = base?.tauri || null
  if (!tauri || typeof tauri.invoke !== 'function') {
    throw new Error('tauri.invoke 不可用（请更新宿主网关）')
  }

  const PLUGIN_ID = String(pluginId || '').trim()
  if (!PLUGIN_ID) throw new Error('pluginId 为空')

  const toast = createToast()
  const UI_PICKER_TIMEOUT_MS = 30 * 60 * 1000
  const IMAGE_IO_TIMEOUT_MS = 15 * 60 * 1000

  function nowId() {
    const d = new Date()
    const pad = (n: number, w: number) => String(n).padStart(w, '0')
    return (
      pad(d.getFullYear(), 4) +
      pad(d.getMonth() + 1, 2) +
      pad(d.getDate(), 2) +
      '-' +
      pad(d.getHours(), 2) +
      pad(d.getMinutes(), 2) +
      pad(d.getSeconds(), 2)
    )
  }

  const SHARD_META_PATH = `_meta.json`
  const SHARD_KEY_TO_FILE: Record<string, string> = {
    settings: `settings.json`,
    bgSavedResults: `bgSavedResults.json`,
    bgSaveRequests: `bgSaveRequests.json`,
    bgSaveResponses: `bgSaveResponses.json`,
    promptLibrary: `promptLibrary.json`,
    refImages: `refImages.json`,
    refImageHistory: `refImageHistory.json`,
  }

  const OLD_SHARDS_DIR = 'files/storage'

  async function filesListDir(scope: string, dir: string | null) {
    return tauri.invoke({ command: 'plugin_files_list_dir', payload: { pluginId: PLUGIN_ID, req: { scope, dir } } })
  }

  async function filesReadText(scope: string, path: string) {
    return tauri.invoke({ command: 'plugin_files_read_text', payload: { pluginId: PLUGIN_ID, req: { scope, path } } })
  }

  async function filesWriteText(scope: string, path: string, text: any, overwrite: boolean) {
    return tauri.invoke({
      command: 'plugin_files_write_text',
      payload: { pluginId: PLUGIN_ID, req: { scope, path, text: String(text ?? ''), overwrite: overwrite !== false } },
    })
  }

  async function filesDelete(scope: string, path: string) {
    return tauri.invoke({ command: 'plugin_files_delete', payload: { pluginId: PLUGIN_ID, req: { scope, path } } })
  }

  async function readJsonFromFiles(scope: string, path: string) {
    let text = ''
    try {
      text = await filesReadText(scope, path)
    } catch {
      return null
    }
    const s = String(text || '').trim()
    if (!s) return null
    try {
      return JSON.parse(s)
    } catch {
      throw new Error(`JSON 解析失败：${path}`)
    }
  }

  async function writeJsonToFiles(scope: string, path: string, value: any) {
    const text = JSON.stringify(value ?? null, null, 2) + '\n'
    await filesWriteText(scope, path, text, true)
  }

  let shardReady = false
  let shardReadyPromise: Promise<void> | null = null

  function shardPathForKey(key: string) {
    const k = String(key || '').trim()
    if (!k) return ''
    return SHARD_KEY_TO_FILE[k] || ''
  }

  async function ensureShardReady() {
    if (shardReady) return
    if (shardReadyPromise) return shardReadyPromise

    shardReadyPromise = Promise.resolve()
      .then(async () => {
        await filesListDir('data', null)
        const meta = await readJsonFromFiles('data', SHARD_META_PATH).catch(() => null)
        if (meta && typeof meta === 'object' && Number((meta as any).schemaVersion || 0) >= 1) {
          shardReady = true
          return
        }

        let existed = false
        try {
          const entries = await filesListDir('data', null).catch(() => [])
          const names = new Set(
            Array.isArray(entries) ? entries.filter((e: any) => e && e.isFile).map((e: any) => String(e.name || '')) : [],
          )
          existed = Object.values(SHARD_KEY_TO_FILE).some((p) => names.has(p))
        } catch {
          existed = false
        }
        if (existed) {
          shardReady = true
          await writeJsonToFiles('data', SHARD_META_PATH, { schemaVersion: 1, migratedAt: Date.now(), reason: 'shards-existed' })
          return
        }

        const snapshot2: Record<string, any> = {}
        for (const k of Object.keys(SHARD_KEY_TO_FILE)) {
          const file = SHARD_KEY_TO_FILE[k]
          const v = await readJsonFromFiles('data', `${OLD_SHARDS_DIR}/${file}`).catch(() => null)
          if (v != null) snapshot2[k] = v
        }

        if (Object.keys(snapshot2).length) {
          await writeJsonToFiles('data', `_backup-migrate-${nowId()}.json`, snapshot2).catch(() => {})

          for (const k of Object.keys(SHARD_KEY_TO_FILE)) {
            if (snapshot2[k] == null) continue
            await writeJsonToFiles('data', SHARD_KEY_TO_FILE[k], snapshot2[k])
          }

          for (const k of Object.keys(SHARD_KEY_TO_FILE)) {
            const file = SHARD_KEY_TO_FILE[k]
            await filesDelete('data', `${OLD_SHARDS_DIR}/${file}`).catch(() => {})
          }

          await writeJsonToFiles('data', SHARD_META_PATH, {
            schemaVersion: 1,
            migratedAt: Date.now(),
            source: { from: 'files/storage' },
          })
          shardReady = true
          return
        }

        const source: any = { from: `${PLUGIN_ID}.json` }
        const snapshot: Record<string, any> = {}

        try {
          const full = await readJsonFromFiles('data', `${PLUGIN_ID}.json`).catch(() => null)
          const obj = full && typeof full === 'object' ? full : null
          if (!obj) throw new Error('ai-draw.json is empty')
          for (const k of Object.keys(SHARD_KEY_TO_FILE)) {
            const v = (obj as any)[k]
            if (v != null) snapshot[k] = v
          }
        } catch {
          source.fileReadable = false
        }

        if (Object.keys(snapshot).length) {
          await writeJsonToFiles('data', `_backup-migrate-${nowId()}.json`, snapshot).catch(() => {})
        }

        for (const k of Object.keys(SHARD_KEY_TO_FILE)) {
          if (snapshot[k] == null) continue
          await writeJsonToFiles('data', SHARD_KEY_TO_FILE[k], snapshot[k])
        }

        await writeJsonToFiles('data', SHARD_META_PATH, { schemaVersion: 1, migratedAt: Date.now(), source })
        shardReady = true
      })
      .finally(() => {
        shardReadyPromise = null
      })

    return shardReadyPromise
  }

  function normalizeHttpReq(req: any) {
    const r = req && typeof req === 'object' ? req : {}
    const mode = String(r.mode || '').trim()
    const method = String(r.method || 'GET').trim() || 'GET'
    const url = String(r.url || '').trim()
    const headers = isPlainObject(r.headers) ? r.headers : null
    const body = typeof r.body === 'string' ? r.body : null
    const bodyBase64 = typeof r.bodyBase64 === 'string' ? r.bodyBase64 : null
    const timeoutMs =
      typeof r.timeoutMs === 'number' && Number.isFinite(r.timeoutMs) ? Math.max(0, Math.floor(r.timeoutMs)) : null
    return { mode, method, url, headers, body, bodyBase64, timeoutMs }
  }

  return {
    ...base,
    tauri,
    ui: {
      ...(base.ui || {}),
      showToast: (message: any) => toast(message),
      startDragging: async () => {
        try {
          await tauri.invoke({ command: 'plugin:window|start_dragging', payload: {} })
        } catch (e: any) {
          toast(String(e?.message || e || '无法拖拽'))
        }
      },
    },
    clipboard: {
      ...(base.clipboard || {}),
      writeText: async (text: any) => {
        await tauri.invoke({ command: 'plugin:clipboard-manager|write_text', payload: { text: String(text || '') } })
      },
      writeImage: async (dataUrl: any) => {
        const u = String(dataUrl || '').trim()
        if (!u || !u.startsWith('data:')) throw new Error('writeImage only supports data URL currently')
        await tauri.invoke({ command: 'clipboard_write_image_data_url', payload: { dataUrl: u } })
      },
    },
    storage: {
      get: async (key: string) => {
        const sk = String(key || '').trim()
        if (!sk) return null
        await ensureShardReady()
        const p = shardPathForKey(sk)
        if (!p) throw new Error(`未知 storage key：${sk}`)
        return readJsonFromFiles('data', p)
      },
      set: async (key: string, value: any) => {
        const sk = String(key || '').trim()
        if (!sk) return
        await ensureShardReady()
        const p = shardPathForKey(sk)
        if (!p) throw new Error(`未知 storage key：${sk}`)
        await writeJsonToFiles('data', p, value)
      },
      remove: async (key: string) => {
        const sk = String(key || '').trim()
        if (!sk) return
        await ensureShardReady()
        const p = shardPathForKey(sk)
        if (!p) throw new Error(`未知 storage key：${sk}`)
        await filesDelete('data', p).catch((e: any) => {
          const msg = String(e?.message || e || '')
          if (msg.includes('文件不存在')) return
          throw e
        })
      },
    },
    files: {
      ...(base.files || {}),
      getOutputDir: async () => {
        return tauri.invoke({ command: 'plugin_get_output_dir', payload: { pluginId: PLUGIN_ID } })
      },
      pickOutputDir: async () => {
        return tauri.invoke({
          command: 'plugin_pick_output_dir',
          payload: { pluginId: PLUGIN_ID },
          timeoutMs: UI_PICKER_TIMEOUT_MS,
        })
      },
      openOutputDir: async () => {
        return tauri.invoke({ command: 'plugin_open_output_dir', payload: { pluginId: PLUGIN_ID } })
      },
      listDir: async (req: any) => {
        return tauri.invoke({ command: 'plugin_files_list_dir', payload: { pluginId: PLUGIN_ID, req } })
      },
      readText: async (req: any) => {
        return tauri.invoke({ command: 'plugin_files_read_text', payload: { pluginId: PLUGIN_ID, req } })
      },
      writeText: async (req: any) => {
        return tauri.invoke({ command: 'plugin_files_write_text', payload: { pluginId: PLUGIN_ID, req } })
      },
      delete: async (req: any) => {
        return tauri.invoke({ command: 'plugin_files_delete', payload: { pluginId: PLUGIN_ID, req } })
      },
      pickImages: async (maxCount?: any) => {
        const mc = maxCount == null ? null : Number(maxCount)
        return tauri.invoke({
          command: 'plugin_pick_images',
          payload: { pluginId: PLUGIN_ID, maxCount: mc },
          timeoutMs: UI_PICKER_TIMEOUT_MS,
        })
      },
      images: {
        ...((base.files && base.files.images) || {}),
        writeBase64: async (req: any) => {
          return tauri.invoke({
            command: 'plugin_images_write_base64',
            payload: { pluginId: PLUGIN_ID, req },
            timeoutMs: IMAGE_IO_TIMEOUT_MS,
          })
        },
        read: async (req: any) => {
          return tauri.invoke({
            command: 'plugin_images_read',
            payload: { pluginId: PLUGIN_ID, req },
            timeoutMs: IMAGE_IO_TIMEOUT_MS,
          })
        },
        list: async (req: any) => {
          return tauri.invoke({ command: 'plugin_images_list', payload: { pluginId: PLUGIN_ID, req } })
        },
        delete: async (req: any) => {
          return tauri.invoke({
            command: 'plugin_images_delete',
            payload: { pluginId: PLUGIN_ID, req },
            timeoutMs: IMAGE_IO_TIMEOUT_MS,
          })
        },
      },
    },
    net: {
      ...(base.net || {}),
      request: async (req: any) => {
        const r = normalizeHttpReq(req)
        if (r.mode === 'task') {
          return tauri.invoke({
            command: 'task_create',
            payload: {
              pluginId: PLUGIN_ID,
              req: {
                kind: 'http.request',
                payload: {
                  method: r.method,
                  url: r.url,
                  headers: r.headers || undefined,
                  body: r.body || undefined,
                  bodyBase64: r.bodyBase64 || undefined,
                  timeoutMs: r.timeoutMs || undefined,
                },
              },
            },
          })
        }

        return tauri.invoke({
          command: 'http_request',
          payload: {
            req: {
              method: r.method,
              url: r.url,
              headers: r.headers || undefined,
              body: r.body || undefined,
              bodyBase64: r.bodyBase64 || undefined,
              timeoutMs: r.timeoutMs || undefined,
            },
          },
        })
      },
    },
    task: {
      ...(base.task || {}),
      create: async (req: any) => {
        const kind = String(req && req.kind ? req.kind : '').trim()
        if (!kind) throw new Error('task kind is required')
        const meta = isPlainObject(req?.meta) ? req.meta : null
        return tauri.invoke({
          command: 'task_create',
          payload: { pluginId: PLUGIN_ID, req: { kind, payload: req && 'payload' in req ? req.payload : null, meta: meta || undefined } },
        })
      },
      get: async (taskId: string) => {
        const tid = String(taskId || '').trim()
        if (!tid) return null
        return tauri.invoke({ command: 'task_get', payload: { pluginId: PLUGIN_ID, taskId: tid } })
      },
      list: async (limit?: number | null) => {
        const lim = typeof limit === 'number' && Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : null
        return tauri.invoke({ command: 'task_list', payload: { pluginId: PLUGIN_ID, limit: lim } })
      },
      cancel: async (taskId: string) => {
        const tid = String(taskId || '').trim()
        if (!tid) throw new Error('taskId is required')
        return tauri.invoke({ command: 'task_cancel', payload: { pluginId: PLUGIN_ID, taskId: tid } })
      },
    },
  }
}
