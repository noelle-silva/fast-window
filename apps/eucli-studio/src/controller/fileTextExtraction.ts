import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import mammoth from 'mammoth/mammoth.browser'
import { extractPptMarkdown } from '../core/ppt'
import { clamp } from '../core/utils'
import { DEFAULT_ATTACH_MAX_FILE_MB, MAX_ATTACH_MAX_FILE_MB } from '../domain/constants'
import type { DraftFileKind } from '../domain/draftFileUtils'
import type { AiChatShowToast } from '../gateway/capabilities'

export function createFileTextExtraction(deps: {
  getState: () => any
  showToast?: AiChatShowToast
}) {
  const { getState, showToast } = deps

  async function extractPdfText(file: File): Promise<string> {
    const buf = await file.arrayBuffer()
    const doc = await (pdfjsLib as any)
      .getDocument({ data: new Uint8Array(buf), disableWorker: true })
      .promise
    const pages = clamp(Number(doc?.numPages || 0), 1, 200)
    const maxPages = Math.min(pages, 50)
    let out = ''
    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i)
      const tc = await page.getTextContent()
      const items = Array.isArray(tc?.items) ? tc.items : []
      const parts = items
        .map((x: any) => (x && typeof x.str === 'string' ? String(x.str) : ''))
        .filter((x: string) => !!x)
      if (parts.length) out += parts.join(' ') + '\n'
    }
    try { doc?.cleanup?.() } catch (_) {}
    return String(out || '').trim()
  }

  async function extractDocxText(file: File): Promise<string> {
    const buf = await file.arrayBuffer()
    const r = await (mammoth as any).extractRawText({ arrayBuffer: buf })
    return String(r?.value || '').trim()
  }

  async function extractTextFromFile(file: File, kind: DraftFileKind): Promise<string> {
    if (!(file instanceof File)) throw new Error('file 无效')
    const size = Number(file?.size || 0)
    if (!isFinite(size) || size <= 0) throw new Error('文件为空')
    const mb0 = (() => {
      try {
        const at = getState().data?.settings?.attachments
        const map = at && typeof at === 'object' ? (at as any).maxFileSizeMbByKind : null
        return map && typeof map === 'object' ? map[kind] : undefined
      } catch (_) { return undefined }
    })()
    const maxMb = (() => {
      const n = Number(mb0)
      if (!isFinite(n)) return DEFAULT_ATTACH_MAX_FILE_MB
      return clamp(Math.round(n), 0, MAX_ATTACH_MAX_FILE_MB)
    })()
    const maxBytes = maxMb <= 0 ? 0 : maxMb * 1024 * 1024
    if (maxBytes > 0 && size > maxBytes) {
      const curMb = Math.round((size / 1024 / 1024) * 10) / 10
      showToast?.(`提示：${globalThis.String(file?.name || '文件')} 大小 ${curMb}MB 超过设置阈值 ${maxMb}MB，仍会尝试解析`)
    }
    if (kind === 'txt' || kind === 'md') {
      const t = await file.text()
      return String(t || '').trim()
    }
    if (kind === 'pdf') return await extractPdfText(file)
    if (kind === 'docx') {
      const t = await extractDocxText(file)
      return String(t || '').trim()
    }
    if (kind === 'ppt') {
      const t = await extractPptMarkdown(file)
      return String(t || '').trim()
    }
    throw new Error('不支持的文件类型')
  }

  return { extractTextFromFile }
}
