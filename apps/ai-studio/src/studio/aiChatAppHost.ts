import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createAiChatControllerV2 } from '../controller/createControllerV2'
import type { AiChatController } from '../controller/types'
import { createDirectCapabilitiesAdapter } from '../direct/createDirectCapabilitiesAdapter'
import { createAiChatCapabilitiesFromHostApi } from '../gateway/capabilities'
import { AI_CHAT_DIRECT_PROTOCOL_VERSION } from '../protocol/aiChatProtocol'
import { createAiChatDirectGateway } from './aiChatDirectGateway'

type BackendEndpoint = {
  url: string
  token: string
}

export type AiChatAppRuntime = {
  controller: AiChatController
  bootstrap: unknown
  dispose: () => void
}

export type AiChatAppHostOptions = {
  showToast: (message: unknown) => void
  onBack: () => Promise<void> | void
}

export async function createAiChatAppRuntime(options: AiChatAppHostOptions): Promise<AiChatAppRuntime> {
  const baseApi = createAiStudioHostApi(options)
  const { api, directClient } = await createDirectCapabilitiesAdapter(baseApi)
  const capabilities = createAiChatCapabilitiesFromHostApi(api, 'ai-studio')
  const aiGateway = createAiChatDirectGateway(directClient)
  const { controller, init } = createAiChatControllerV2({ capabilities, aiGateway })
  const bootstrap = await directClient.invoke('studio.bootstrap').catch(() => null)

  await init()

  return {
    controller,
    bootstrap,
    dispose() {
      directClient.close()
    },
  }
}

function createAiStudioHostApi(options: AiChatAppHostOptions) {
  return {
    __meta: { runtime: 'ui', pluginId: 'ai-studio' },
    background: {
      endpoint: createBackendEndpoint,
    },
    files: {
      pickImages: pickImageFiles,
    },
    ui: {
      showToast: options.showToast,
      startDragging: () => getCurrentWindow().startDragging(),
    },
    clipboard: {
      writeText,
      readText,
      writeImage,
    },
    host: {
      back: options.onBack,
      background: {
        endpoint: createBackendEndpoint,
      },
    },
  }
}

async function createBackendEndpoint() {
  const endpoint = await invoke<BackendEndpoint>('backend_endpoint')
  return {
    mode: 'direct',
    transport: 'local-websocket',
    protocolVersion: AI_CHAT_DIRECT_PROTOCOL_VERSION,
    url: endpoint.url,
    token: endpoint.token,
  }
}

async function pickImageFiles(maxCount?: number): Promise<Array<{ name: string; dataUrl: string }>> {
  const limit = Math.max(1, Math.min(20, Math.floor(Number(maxCount || 1))))
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.multiple = limit > 1
  input.tabIndex = -1
  input.style.position = 'fixed'
  input.style.left = '-10000px'
  input.style.top = '-10000px'

  document.body.appendChild(input)
  try {
    const files = await new Promise<File[]>((resolve) => {
      input.addEventListener(
        'change',
        () => {
          const selected = Array.from(input.files || [])
            .filter((file) => file instanceof File && String(file.type || '').startsWith('image/'))
            .slice(0, limit)
          resolve(selected)
        },
        { once: true },
      )
      input.click()
    })

    const items: Array<{ name: string; dataUrl: string }> = []
    for (const file of files) {
      const dataUrl = await readFileAsDataUrl(file)
      if (dataUrl) items.push({ name: file.name || '图片', dataUrl })
    }
    return items
  } finally {
    input.remove()
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

async function writeText(text: unknown): Promise<void> {
  const value = String(text ?? '')
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-10000px'
  document.body.appendChild(textarea)
  try {
    textarea.select()
    document.execCommand('copy')
  } finally {
    textarea.remove()
  }
}

async function readText(): Promise<string> {
  if (!navigator.clipboard?.readText) return ''
  return navigator.clipboard.readText()
}

async function writeImage(dataUrl: unknown): Promise<void> {
  const value = String(dataUrl || '').trim()
  if (!value.startsWith('data:image/')) throw new Error('图片剪贴板只支持 data URL')
  const clipboard = navigator.clipboard as Clipboard & { write?: (items: ClipboardItem[]) => Promise<void> }
  if (typeof clipboard?.write !== 'function' || typeof ClipboardItem === 'undefined') {
    throw new Error('当前系统不支持写入图片剪贴板')
  }

  const response = await fetch(value)
  const blob = await response.blob()
  await clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })])
}
