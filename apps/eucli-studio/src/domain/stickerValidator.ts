import { safeDirName } from './storageKeys'

export interface StickerNameResult {
  ok: boolean
  name: string
  error: string
}

export function validateStickerCategoryName(input: any): StickerNameResult {
  const raw = String(input || '').trim()
  if (!raw) return { ok: false, name: '', error: '分类名不能为空' }
  if (raw.length > 60) return { ok: false, name: '', error: '分类名太长（最多 60 字符）' }
  if (raw.includes('/') || raw.includes('\\')) return { ok: false, name: '', error: '分类名不能包含 / 或 \\' }

  // 分类名会作为文件夹名使用；这里不做自动改名，避免 token 与落盘目录不一致。
  const safe = safeDirName(raw, '分类')
  if (safe !== raw) return { ok: false, name: '', error: '分类名包含不支持的字符' }

  return { ok: true, name: raw, error: '' }
}

export function validateStickerName(input: any): StickerNameResult {
  const raw = String(input || '').trim()
  if (!raw) return { ok: false, name: '', error: '表情名不能为空' }
  if (raw.length > 80) return { ok: false, name: '', error: '表情名太长（最多 80 字符）' }
  if (raw.includes('/') || raw.includes('\\')) return { ok: false, name: '', error: '表情名不能包含 / 或 \\' }
  if (raw.includes(']') || raw.includes('\n') || raw.includes('\r')) return { ok: false, name: '', error: '表情名包含不支持的字符' }
  return { ok: true, name: raw, error: '' }
}

export function imageExtFromDataUrl(dataUrl: any): string {
  const u = String(dataUrl || '').trim()
  const m = /^data:image\/([a-zA-Z0-9.+-]+);base64,/.exec(u)
  if (!m) return ''
  const mime = String(m[1] || '').toLowerCase()
  if (mime === 'png') return 'png'
  if (mime === 'gif') return 'gif'
  if (mime === 'webp') return 'webp'
  if (mime === 'jpeg' || mime === 'jpg') return 'jpg'
  return ''
}
