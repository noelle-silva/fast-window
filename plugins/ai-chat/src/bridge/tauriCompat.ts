type AnyRecord = Record<string, any>

const STORE_PATH = 'plugins/ai-chat.json'
const RUNTIME_STORE_PATH = 'plugins/ai-chat.runtime.json'

function isPlainObject(v: any): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function createToast() {
  let el: HTMLDivElement | null = null
  let timer = 0 as any

  function ensure() {
    if (typeof document === 'undefined') return null
    if (el && el.isConnected) return el
    el = document.createElement('div')
    el.id = '__fastWindowAiChatToast'
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
      if (!d.isConnected) return
      d.style.opacity = '0'
    }, 1800)
  }
}

export function createAiChatFastWindowApi(baseApi: any, pluginId: string) {
  const base = baseApi || {}
  const tauri = base?.tauri || null
  if (!tauri || typeof tauri.invoke !== 'function') {
    throw new Error('tauri.invoke 不可用（请更新宿主网关）')
  }

  const toast = createToast()

  let storeRid: any = null
  let storeInitPromise: Promise<any> | null = null
  let rtStoreRid: any = null
  let rtStoreInitPromise: Promise<any> | null = null

  let rtSaveTimer: any = 0
  let rtSaveInFlight: Promise<void> | null = null
  let rtSaveDirty = false

  async function ensureStore() {
    if (storeRid) return storeRid
    if (storeInitPromise) return storeInitPromise
    storeInitPromise = Promise.resolve()
      .then(async () => {
        const rid = await tauri.invoke({ command: 'plugin:store|load', payload: { path: STORE_PATH } })
        if (!rid) throw new Error('store rid 无效')
        storeRid = rid
        return rid
      })
      .finally(() => {
        storeInitPromise = null
      })
    return storeInitPromise
  }

  async function ensureRuntimeStore() {
    if (rtStoreRid) return rtStoreRid
    if (rtStoreInitPromise) return rtStoreInitPromise
    rtStoreInitPromise = Promise.resolve()
      .then(async () => {
        const rid = await tauri.invoke({ command: 'plugin:store|load', payload: { path: RUNTIME_STORE_PATH } })
        if (!rid) throw new Error('runtime store rid 无效')
        rtStoreRid = rid
        return rid
      })
      .finally(() => {
        rtStoreInitPromise = null
      })
    return rtStoreInitPromise
  }

  async function storeGetRaw(rid: any, key: string) {
    const r = await tauri.invoke({ command: 'plugin:store|get', payload: { rid, key: String(key || '') } })
    // store 返回：[value, exists]
    if (Array.isArray(r) && r[1]) return r[0]
    return null
  }

  async function storeSetRaw(rid: any, key: string, value: any) {
    await tauri.invoke({ command: 'plugin:store|set', payload: { rid, key: String(key || ''), value } })
  }

  async function storeSave(rid: any) {
    await tauri.invoke({ command: 'plugin:store|save', payload: { rid } })
  }

  function requestRuntimeSaveSoon() {
    if (rtSaveTimer) return
    rtSaveTimer = setTimeout(() => {
      rtSaveTimer = 0
      if (!rtSaveDirty) return
      rtSaveDirty = false
      rtSaveInFlight = Promise.resolve()
        .then(async () => {
          const rid = await ensureRuntimeStore()
          await storeSave(rid)
        })
        .catch(() => {})
        .finally(() => {
          rtSaveInFlight = null
          if (rtSaveDirty) requestRuntimeSaveSoon()
        })
    }, 150)
  }

  async function runtimeSetRaw(key: string, value: any) {
    const rid = await ensureRuntimeStore()
    await storeSetRaw(rid, key, value)
    rtSaveDirty = true
    requestRuntimeSaveSoon()
  }

  async function runtimeRemoveRaw(key: string) {
    const rid = await ensureRuntimeStore()
    await tauri.invoke({ command: 'plugin:store|delete', payload: { rid, key: String(key || '') } })
    rtSaveDirty = true
    requestRuntimeSaveSoon()
  }

  async function runtimeFlush() {
    if (rtSaveTimer) {
      clearTimeout(rtSaveTimer)
      rtSaveTimer = 0
    }
    if (rtSaveInFlight) {
      try {
        await rtSaveInFlight
      } catch (_) {}
    }
    if (!rtSaveDirty) return
    rtSaveDirty = false
    try {
      const rid = await ensureRuntimeStore()
      await storeSave(rid)
    } catch (_) {}
  }

  const api = {
    ...base,
    tauri,

    ui: {
      ...(base.ui || {}),
      showToast: (message: any) => toast(message),
      startDragging: async () => {
        try {
          await tauri.invoke({ command: 'plugin:window|start_dragging', payload: {} })
        } catch (e) {
          toast(String((e as any)?.message || e || '无法拖拽'))
        }
      },
    },

    clipboard: {
      ...(base.clipboard || {}),
      writeText: async (text: any) => {
        const s = String(text ?? '')
        await tauri.invoke({ command: 'plugin:clipboard-manager|write_text', payload: { text: s } })
      },
      readText: async () => {
        const r = await tauri.invoke({ command: 'plugin:clipboard-manager|read_text', payload: {} })
        return r == null ? '' : String(r)
      },
    },

    storage: {
      get: async (key: any) => {
        const rid = await ensureStore()
        return storeGetRaw(rid, String(key ?? ''))
      },
      set: async (key: any, value: any) => {
        const rid = await ensureStore()
        await storeSetRaw(rid, String(key ?? ''), value)
        await storeSave(rid)
      },
      remove: async (key: any) => {
        const rid = await ensureStore()
        await tauri.invoke({ command: 'plugin:store|delete', payload: { rid, key: String(key ?? '') } })
        await storeSave(rid)
      },
      getAll: async () => {
        const rid = await ensureStore()
        const entries = await tauri.invoke({ command: 'plugin:store|entries', payload: { rid } })
        const out: AnyRecord = {}
        if (Array.isArray(entries)) {
          for (const pair of entries) {
            if (!Array.isArray(pair) || pair.length < 2) continue
            out[String(pair[0] ?? '')] = pair[1]
          }
        }
        return out
      },
    },

    // 高频/并发用：把 bg.*、流式中间态、取消标记等放到独立 store 文件，避免与主数据互相覆盖。
    runtimeStorage: {
      get: async (key: any) => {
        const rid = await ensureRuntimeStore()
        return storeGetRaw(rid, String(key ?? ''))
      },
      set: async (key: any, value: any) => {
        await runtimeSetRaw(String(key ?? ''), value)
      },
      remove: async (key: any) => {
        await runtimeRemoveRaw(String(key ?? ''))
      },
      flush: async () => {
        await runtimeFlush()
      },
    },

    net: {
      request: async (req: any) => {
        const t0 = (req as any)?.timeoutMs
        const timeoutMs =
          typeof t0 === 'number' && Number.isFinite(t0) ? Math.max(1, Math.floor(t0)) : 120000
        return tauri.invoke({ command: 'http_request', payload: { req }, timeoutMs })
      },
      requestStream: async (req: any) => {
        if (typeof tauri.stream !== 'function') throw new Error('tauri.stream 不可用（请更新宿主网关）')
        const t0 = (req as any)?.timeoutMs
        const timeoutMs =
          typeof t0 === 'number' && Number.isFinite(t0) ? Math.max(1, Math.floor(t0)) : 15 * 60 * 1000
        return tauri.stream({
          command: 'http_request_stream',
          payload: { req },
          timeoutMs,
          detached: true,
          cancel: { command: 'http_request_stream_cancel', idKey: 'streamId' },
        })
      },
    },

    files: {
      ...(base.files || {}),
      pickImages: async (maxCount?: any) => {
        return tauri.invoke({
          command: 'plugin_pick_images',
          payload: { pluginId: String(pluginId || ''), maxCount: maxCount == null ? null : Number(maxCount) },
        })
      },
      images: {
        ...((base.files && base.files.images) || {}),
        writeBase64: async (req: any) => {
          return tauri.invoke({ command: 'plugin_images_write_base64', payload: { pluginId: String(pluginId || ''), req } })
        },
        read: async (req: any) => {
          return tauri.invoke({ command: 'plugin_images_read', payload: { pluginId: String(pluginId || ''), req } })
        },
        delete: async (req: any) => {
          return tauri.invoke({ command: 'plugin_images_delete', payload: { pluginId: String(pluginId || ''), req } })
        },
      },
    },
  }

  return api
}
