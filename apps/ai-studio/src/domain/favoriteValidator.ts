export interface FavoriteFolderNameResult {
  ok: boolean
  name: string
  error: string
}

export function validateFavoriteFolderName(input: any): FavoriteFolderNameResult {
  const raw = String(input || '').replace(/\s+/g, ' ').trim()
  if (!raw) return { ok: false, name: '', error: '文件夹名不能为空' }
  if (raw.length > 60) return { ok: false, name: '', error: '文件夹名太长（最多 60 字符）' }
  if (raw.includes('/') || raw.includes('\\')) return { ok: false, name: '', error: '文件夹名不能包含 / 或 \\' }
  if (raw.includes('\n') || raw.includes('\r')) return { ok: false, name: '', error: '文件夹名包含不支持的字符' }
  return { ok: true, name: raw, error: '' }
}
