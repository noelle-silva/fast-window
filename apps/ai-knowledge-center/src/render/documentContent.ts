import { createDefaultAssistantRenderEngine } from './assistantEngineDefault'
import type { KnowledgeRenderCapabilities } from './types'

function dataUrlToBlob(dataUrl: string) {
  const [head, body] = String(dataUrl || '').split(',')
  const mimeMatch = /^data:([^;]+);base64$/i.exec(head || '')
  if (!mimeMatch || !body) throw new Error('图片数据无效')
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mimeMatch[1] })
}

const capabilities: KnowledgeRenderCapabilities = {
  clipboard: {
    writeText: text => navigator.clipboard.writeText(String(text || '')),
    writeImage: async dataUrl => {
      const clipboard = navigator.clipboard as any
      const itemCtor = (window as any).ClipboardItem
      if (!clipboard?.write || typeof itemCtor !== 'function') throw new Error('当前环境不支持复制图片')
      const blob = dataUrlToBlob(String(dataUrl || ''))
      await clipboard.write([new itemCtor({ [blob.type]: blob })])
    },
  },
}

const renderer = createDefaultAssistantRenderEngine(capabilities)

export function normalizeDocumentContentForRender(content: unknown) {
  const text = String(content ?? '').replace(/\r\n/g, '\n')
  const escapedBreaks = (text.match(/\\n/g) || []).length + (text.match(/\\r\\n/g) || []).length
  if (!escapedBreaks) return text

  const realBreaks = (text.match(/\n/g) || []).length
  if (realBreaks > 0 && escapedBreaks <= realBreaks) return text

  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
}

export function renderDocumentContentInto(el: HTMLElement, content: unknown) {
  renderer.renderAssistantInto(el, normalizeDocumentContentForRender(content), { renderSafetyPolicy: 'original' })
}
