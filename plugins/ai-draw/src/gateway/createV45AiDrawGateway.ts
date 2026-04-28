import { normalizeImageDataUrlOrBase64 } from '../core/images'
import { AI_DRAW_DIRECT_EVENT, AI_DRAW_DIRECT_METHOD, type AiDrawDirectEvent } from '../shared/protocol'
import type { AiDrawGenerationEvent } from '../shared/domain'
import { createToast } from './createToast'
import { createDirectAiDrawClient } from './directClient'
import type { AiDrawGateway, AiDrawPickedImage } from './types'

function getHost(baseApi: unknown) {
  return (baseApi as any)?.host && typeof (baseApi as any).host === 'object' ? (baseApi as any).host : {}
}

async function pickImagesByInput(maxCount: number): Promise<AiDrawPickedImage[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = maxCount > 1
    input.style.display = 'none'
    document.body.appendChild(input)
    input.onchange = () => {
      const files = Array.from(input.files || []).slice(0, Math.max(1, maxCount || 1))
      document.body.removeChild(input)
      Promise.all(files.map((file) => new Promise<AiDrawPickedImage | null>((res) => {
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = normalizeImageDataUrlOrBase64(reader.result)
          res(dataUrl.startsWith('data:image/') ? { name: file.name || '图片', dataUrl } : null)
        }
        reader.onerror = () => res(null)
        reader.readAsDataURL(file)
      }))).then((items) => resolve(items.filter(Boolean) as AiDrawPickedImage[]))
    }
    input.oncancel = () => {
      document.body.removeChild(input)
      resolve([])
    }
    input.click()
  })
}

function mapGenerationEvent(event: AiDrawDirectEvent): AiDrawGenerationEvent | null {
  const payload = event.payload && typeof event.payload === 'object' ? event.payload as any : {}
  const task = payload.task
  if (!task || typeof task !== 'object') return null
  switch (event.name) {
    case AI_DRAW_DIRECT_EVENT.generationCreated:
      return { type: 'created', task }
    case AI_DRAW_DIRECT_EVENT.generationProgress:
      return { type: 'progress', task, message: payload.message, progress: payload.progress }
    case AI_DRAW_DIRECT_EVENT.generationCompleted:
      return { type: 'completed', task }
    case AI_DRAW_DIRECT_EVENT.generationFailed:
      return { type: 'failed', task }
    case AI_DRAW_DIRECT_EVENT.generationCanceled:
      return { type: 'canceled', task }
    default:
      return null
  }
}

export async function createV45AiDrawGateway(baseApi: unknown): Promise<AiDrawGateway> {
  const direct = await createDirectAiDrawClient(baseApi)
  const hostApi = getHost(baseApi)
  const toast = typeof hostApi.toast === 'function' ? (message: string) => hostApi.toast(String(message || '')) : createToast()
  const generationListeners = new Set<(event: AiDrawGenerationEvent) => void>()
  const unsubscribeDirect = direct.subscribe((event) => {
    const mapped = mapGenerationEvent(event)
    if (!mapped) return
    for (const listener of generationListeners) listener(mapped)
  })

  return {
    runtime: 'ui',
    host: {
      back: async () => {
        if (typeof hostApi.back === 'function') await hostApi.back()
      },
      toast,
      startDragging: async () => {
        if (typeof hostApi.startDragging === 'function') await hostApi.startDragging()
      },
    },
    clipboard: {
      writeText: async (text: string) => {
        if (!navigator.clipboard?.writeText) throw new Error('当前环境不支持复制文本')
        await navigator.clipboard.writeText(String(text || ''))
      },
      writeImage: async (dataUrl: string) => {
        const ClipboardItemCtor = (window as any).ClipboardItem
        if (!navigator.clipboard?.write || !ClipboardItemCtor) throw new Error('当前环境不支持复制图片')
        const res = await fetch(dataUrl)
        const blob = await res.blob()
        await navigator.clipboard.write([new ClipboardItemCtor({ [blob.type || 'image/png']: blob })])
      },
    },
    settingsStore: {
      read: () => direct.invoke(AI_DRAW_DIRECT_METHOD.settingsRead, {}),
      write: (settings) => direct.invoke(AI_DRAW_DIRECT_METHOD.settingsWrite, { settings }),
    },
    taskHistoryStore: {
      read: () => direct.invoke(AI_DRAW_DIRECT_METHOD.taskHistoryRead, {}),
      write: (items) => direct.invoke(AI_DRAW_DIRECT_METHOD.taskHistoryWrite, { items }),
    },
    promptLibraryStore: {
      read: () => direct.invoke(AI_DRAW_DIRECT_METHOD.promptLibraryRead, {}),
      write: (library) => direct.invoke(AI_DRAW_DIRECT_METHOD.promptLibraryWrite, { library }),
    },
    referenceLibraryIndexStore: {
      read: () => direct.invoke(AI_DRAW_DIRECT_METHOD.referenceLibraryRead, {}),
      write: (index) => direct.invoke(AI_DRAW_DIRECT_METHOD.referenceLibraryWrite, { index }),
    },
    outputImages: {
      getOutputDir: async () => (await direct.invoke<{ outputDir: string }>(AI_DRAW_DIRECT_METHOD.outputImagesGetOutputDir, {})).outputDir,
      pickOutputDir: async () => {
        toast('当前宿主不支持选择输出目录')
        return null
      },
      openOutputDir: async () => {
        toast('当前宿主不支持打开输出目录')
      },
      list: async () => (await direct.invoke<{ paths: string[] }>(AI_DRAW_DIRECT_METHOD.outputImagesList, {})).paths,
      read: async (path) => (await direct.invoke<{ dataUrl: string }>(AI_DRAW_DIRECT_METHOD.outputImagesRead, { path })).dataUrl,
      saveBase64: async (dataUrlOrBase64) => (await direct.invoke<{ savedPath: string }>(AI_DRAW_DIRECT_METHOD.outputImagesSaveBase64, { dataUrlOrBase64 })).savedPath,
      delete: (path) => direct.invoke(AI_DRAW_DIRECT_METHOD.outputImagesDelete, { path }),
    },
    referenceImages: {
      pick: pickImagesByInput,
      list: async () => (await direct.invoke<{ paths: string[] }>(AI_DRAW_DIRECT_METHOD.referenceImagesList, {})).paths,
      read: async (path) => (await direct.invoke<{ dataUrl: string }>(AI_DRAW_DIRECT_METHOD.referenceImagesRead, { path })).dataUrl,
      saveBase64: async (dataUrlOrBase64) => (await direct.invoke<{ savedPath: string }>(AI_DRAW_DIRECT_METHOD.referenceImagesSaveBase64, { dataUrlOrBase64 })).savedPath,
      delete: (path) => direct.invoke(AI_DRAW_DIRECT_METHOD.referenceImagesDelete, { path }),
    },
    generation: {
      createNormal: async (request) => (await direct.invoke<{ tasks: any[] }>(AI_DRAW_DIRECT_METHOD.generationCreateNormal, { request }, { timeoutMs: 15000 })).tasks,
      createLocalEdit: async (request) => (await direct.invoke<{ task: any }>(AI_DRAW_DIRECT_METHOD.generationCreateLocalEdit, { request }, { timeoutMs: 15000 })).task,
      get: async (taskId) => (await direct.invoke<{ task: any }>(AI_DRAW_DIRECT_METHOD.generationGet, { taskId })).task,
      list: async (limit) => (await direct.invoke<{ tasks: any[] }>(AI_DRAW_DIRECT_METHOD.generationList, { limit })).tasks,
      cancel: (taskId) => direct.invoke(AI_DRAW_DIRECT_METHOD.generationCancel, { taskId }),
      subscribe(listener) {
        generationListeners.add(listener)
        return () => generationListeners.delete(listener)
      },
    },
    close: () => {
      unsubscribeDirect()
      generationListeners.clear()
      direct.close()
    },
  }
}
