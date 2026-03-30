export type AnyRecord = Record<string, any>

// v3: 根目录分类布局（<key>.json + runtime/<key>.json）
export const STORAGE_SCHEMA_VERSION = 3
export const STORAGE_META_PATH = '_meta.json'

export const FILE_SUFFIX = '.json'
export const FILES_SCOPE = 'data'

export const RUNTIME_DIR = 'runtime'

export function nowId() {
  const d = new Date()
  const pad = (n: number, w: number) => String(n).padStart(w, '0')
  return (
    pad(d.getFullYear(), 4) +
    pad(d.getMonth() + 1, 2) +
    pad(d.getDate(), 2) +
    '-' +
    pad(d.getHours(), 2) +
    pad(d.getMinutes(), 2) +
    pad(d.getSeconds(), 2)
  )
}

function safeKeyPath(raw: any) {
  const k = String(raw ?? '').trim()
  if (!k) throw new Error('storage key 不能为空')
  if (k.length > 600) throw new Error('storage key 过长')
  if (k.includes('\\')) throw new Error('storage key 不允许包含反斜杠')
  if (k.startsWith('/')) throw new Error('storage key 不能以 / 开头')
  if (k.includes('\0')) throw new Error('storage key 不合法')
  const parts = k.split('/')
  for (const p of parts) {
    const seg = String(p ?? '').trim()
    if (!seg) throw new Error('storage key 不允许空路径段')
    if (seg === '.' || seg === '..') throw new Error('storage key 不允许相对路径段')
  }
  return k
}

export function storageKeyToRelPath(key: any) {
  const k = safeKeyPath(key)
  return `${k}${FILE_SUFFIX}`
}

export function runtimeKeyToRelPath(key: any) {
  const k = safeKeyPath(key)
  return `${RUNTIME_DIR}/${k}${FILE_SUFFIX}`
}
