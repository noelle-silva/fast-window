import { looksLikeImageDataUrl } from '../../domain/textProcessing'
import {
  DEFAULT_WALLPAPER_VIEW,
  WALLPAPER_MAX_EDGE,
  createWallpaperId,
  createWallpaperRelPath,
  normalizeWallpaperSettings,
  normalizeWallpaperView,
} from '../../domain/wallpaper'
import type { AiChatShowToast } from '../../gateway/capabilities'
import { refreshScopes } from '../../domain/uiRefreshScope'

export function createWallpaperActions(deps: {
  state: any
  emit: () => void
  emitScope?: (scope: string) => void
  saveMeta: () => Promise<any>
  showToast?: AiChatShowToast
  pickImageFiles?: (maxCount?: number) => Promise<any[]>
  writeImageBase64?: (req: any) => Promise<any>
  deleteImage?: (req: any) => Promise<any>
}) {
  const { state, emit, emitScope, saveMeta, showToast, pickImageFiles, writeImageBase64, deleteImage } = deps

  function notifySettings() {
    if (emitScope) {
      emitScope(refreshScopes.settings())
      return
    }
    emit()
  }

  function currentSettings() {
    if (!state.data) return null
    if (!state.data.settings || typeof state.data.settings !== 'object') state.data.settings = {} as any
    const settings = normalizeWallpaperSettings((state.data.settings as any).wallpaper)
    ;(state.data.settings as any).wallpaper = settings
    return settings
  }

  function commit() {
    saveMeta().catch(() => {})
    notifySettings()
  }

  // 透明背景是 wallpaper.enabled 的纯派生物：
  // 动作层只维护壁纸事实，派生字段由 dataNormalizers / 读取端统一解析。
  return {
    addWallpaperFromPicker: async () => {
      if (!state.data) return
      if (typeof pickImageFiles !== 'function') return showToast?.('未授权：选择图片', { kind: 'error' })

      let picked: any[] = []
      try {
        picked = (await pickImageFiles(1)) || []
      } catch (e: any) {
        return showToast?.(String(e?.message || e || '选择图片失败'), { kind: 'error' })
      }
      const source = String(picked?.[0]?.dataUrl || '').trim()
      if (!source) return

      const compressed = await compressWallpaperImage(source)
      if (!compressed) return showToast?.('图片处理失败（仅支持图片文件）', { kind: 'error' })
      if (typeof writeImageBase64 !== 'function') return showToast?.('未授权：写入壁纸', { kind: 'error' })

      const id = createWallpaperId()
      const relPath = createWallpaperRelPath(id, compressed.ext)
      try {
        await writeImageBase64({ scope: 'data', relPath, overwrite: true, dataUrlOrBase64: compressed.dataUrl })
      } catch (e: any) {
        return showToast?.(String(e?.message || e || '写入壁纸失败'), { kind: 'error' })
      }

      const settings = currentSettings()
      if (!settings) return
      settings.presets.push({ id, relPath, view: { ...DEFAULT_WALLPAPER_VIEW } })
      settings.activeId = id
      settings.enabled = true
      commit()
      showToast?.('壁纸已添加', { kind: 'success' })
    },

    setWallpaperEnabled: (enabled: any) => {
      const settings = currentSettings()
      if (!settings) return
      const next = enabled === true
      if (next && settings.presets.length === 0) return showToast?.('请先添加壁纸', { kind: 'error' })
      settings.enabled = next
      commit()
    },

    setActiveWallpaper: (id: any) => {
      const settings = currentSettings()
      if (!settings) return
      const nextId = String(id || '').trim()
      if (!settings.presets.some((item) => item.id === nextId)) return
      settings.activeId = nextId
      settings.enabled = true
      commit()
    },

    removeWallpaper: async (id: any) => {
      const settings = currentSettings()
      if (!settings) return
      const nextId = String(id || '').trim()
      const preset = settings.presets.find((item) => item.id === nextId)
      if (!preset) return
      if (typeof deleteImage !== 'function') return showToast?.('未授权：删除壁纸', { kind: 'error' })

      try {
        await deleteImage({ scope: 'data', path: preset.relPath })
      } catch (e: any) {
        return showToast?.(String(e?.message || e || '删除壁纸失败'), { kind: 'error' })
      }

      const remaining = settings.presets.filter((item) => item.id !== nextId)
      settings.presets = remaining
      if (settings.activeId === nextId) settings.activeId = String(remaining[0]?.id || '')
      if (remaining.length === 0) settings.enabled = false
      commit()
    },

    setWallpaperView: (id: any, view: any) => {
      const settings = currentSettings()
      if (!settings) return
      const preset = settings.presets.find((item) => item.id === String(id || '').trim())
      if (!preset) return
      preset.view = normalizeWallpaperView(view)
      commit()
    },
  }
}

function canvasToDataUrl(canvas: HTMLCanvasElement, mime: string, quality: number) {
  try {
    return String(canvas.toDataURL(mime, quality) || '')
  } catch (_) {
    return ''
  }
}

// 壁纸统一压到最长边 2560，优先 webp，再退 jpeg；动图会被静态化（与宿主一致）。
function compressWallpaperImage(dataUrl: string): Promise<{ dataUrl: string; ext: string } | null> {
  return new Promise((resolve) => {
    const source = String(dataUrl || '').trim()
    if (!looksLikeImageDataUrl(source)) return resolve(null)

    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      try {
        const width = Number(img.naturalWidth || 0)
        const height = Number(img.naturalHeight || 0)
        if (!width || !height) return resolve(null)

        const scale = Math.min(1, WALLPAPER_MAX_EDGE / Math.max(width, height))
        const targetW = Math.max(1, Math.round(width * scale))
        const targetH = Math.max(1, Math.round(height * scale))

        const canvas = document.createElement('canvas')
        canvas.width = targetW
        canvas.height = targetH
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(null)
        ctx.clearRect(0, 0, targetW, targetH)
        ctx.drawImage(img, 0, 0, targetW, targetH)

        const webp = canvasToDataUrl(canvas, 'image/webp', 0.86)
        if (webp.startsWith('data:image/webp')) return resolve({ dataUrl: webp, ext: 'webp' })
        const jpeg = canvasToDataUrl(canvas, 'image/jpeg', 0.88)
        if (jpeg.startsWith('data:image/jpeg')) return resolve({ dataUrl: jpeg, ext: 'jpg' })
        resolve(null)
      } catch (_) {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = source
  })
}
