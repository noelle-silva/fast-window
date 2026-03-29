type AnyRecord = Record<string, any>

const STORE_PATH = 'plugins/ai-chat.json'

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

    net: {
      request: async (req: any) => {
        return tauri.invoke({ command: 'http_request', payload: { req } })
      },
      requestStream: async (req: any) => {
        if (typeof tauri.stream !== 'function') throw new Error('tauri.stream 不可用（请更新宿主网关）')
        return tauri.stream({
          command: 'http_request_stream',
          payload: { req },
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
