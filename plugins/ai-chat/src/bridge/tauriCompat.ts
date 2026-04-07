import { createAiChatStorage } from './storageFiles'

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
  const st = createAiChatStorage(tauri, pluginId)

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
      writeImage: async (dataUrl: any) => {
        const u = String(dataUrl ?? '').trim()
        if (!u || !u.startsWith('data:')) throw new Error('writeImage only supports data URL currently')
        await tauri.invoke({ command: 'clipboard_write_image_data_url', payload: { dataUrl: u } })
      },
      readText: async () => {
        const r = await tauri.invoke({ command: 'plugin:clipboard-manager|read_text', payload: {} })
        return r == null ? '' : String(r)
      },
    },

    storage: {
      ...(st.storage as any),
    },

    // 高频/并发用：把 bg.*、流式中间态、取消标记等放到独立 store 文件，避免与主数据互相覆盖。
    runtimeStorage: {
      ...(st.runtimeStorage as any),
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
