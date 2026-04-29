import type { Plugin, RegistryIndex, RegistryPluginItem, Semver } from './constants'

export function parseSemverStrict(raw: string): Semver | null {
  const s = String(raw || '').trim()
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(s)
  if (!m) return null
  const major = Number(m[1])
  const minor = Number(m[2])
  const patch = Number(m[3])
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) return null
  if (major < 0 || minor < 0 || patch < 0) return null
  return { major, minor, patch }
}

export function cmpSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return 0
}

export function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id)
}

export function normalizeCapabilityList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const it of value) {
    const s = String(it || '').trim()
    if (s) out.push(s)
  }
  out.sort()
  const uniq: string[] = []
  for (const s of out) {
    if (uniq.length === 0 || uniq[uniq.length - 1] !== s) uniq.push(s)
  }
  return uniq
}

export function normalizeRegistry(raw: unknown): RegistryIndex {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('index.json 格式不合法')
  const obj = raw as any
  if (obj.registry_version !== 1) throw new Error('不支持的 registry_version（仅支持 1）')
  if (!Array.isArray(obj.plugins)) throw new Error('index.json.plugins 必须是数组')

  const out: RegistryPluginItem[] = []
  for (const item of obj.plugins) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const id = String((item as any).id || '').trim()
    const name = String((item as any).name || '').trim()
    const description = String((item as any).description || '')
    const version = String((item as any).version || '').trim()
    const download_url = String((item as any).download_url || '').trim()
    const sha256 = String((item as any).sha256 || '').trim()
    const requires = normalizeCapabilityList((item as any).requires)

    if (!id || !isSafeId(id)) continue
    if (!name) continue
    if (!version || !parseSemverStrict(version)) continue
    if (!download_url) continue
    if (!sha256) continue

    out.push({ id, name, description, version, download_url, sha256, requires })
  }

  out.sort((a, b) => a.name.localeCompare(b.name))
  return { registry_version: 1, plugins: out }
}

export async function fetchRegistryIndex(url: string, timeoutMs: number): Promise<RegistryIndex> {
  const u = String(url || '').trim()
  if (!u) throw new Error('indexUrl 不能为空')
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), Math.max(1_000, timeoutMs))
  try {
    const resp = await fetch(u, { cache: 'no-store', signal: ctrl.signal })
    if (!resp.ok) throw new Error(`拉取 index.json 失败：HTTP ${resp.status}`)
    const raw = await resp.json()
    return normalizeRegistry(raw)
  } finally {
    window.clearTimeout(timer)
  }
}

export function normalizeBrowseLayout(value: unknown): import('./constants').PluginBrowseLayout {
  if (value === 'grid') return 'grid'
  if (value === 'icon') return 'icon'
  return 'list'
}

export function isDataImageUrl(value: string): boolean {
  return value.startsWith('data:image/')
}

export async function pickImageFile(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp'
    input.onchange = () => {
      const file = input.files?.[0] ?? null
      resolve(file)
      input.remove()
    }
    input.oncancel = () => {
      resolve(null)
      input.remove()
    }
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    document.body.appendChild(input)
    input.click()
  })
}

export async function makeThumbnailPngDataUrl(file: File, maxPx: number): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(file)
  })

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('加载图片失败'))
    el.src = dataUrl
  })

  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  if (!w || !h) throw new Error('图片尺寸无效')

  const scale = Math.min(1, maxPx / Math.max(w, h))
  const outW = Math.max(1, Math.round(w * scale))
  const outH = Math.max(1, Math.round(h * scale))

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 不可用')
  ctx.drawImage(img, 0, 0, outW, outH)

  return canvas.toDataURL('image/png')
}

export function normalizeOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) ids.push(item)
  }
  return ids
}

export function normalizeDisabledPlugins(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) ids.push(item)
  }
  return ids
}

export function applyPluginOrder(list: Plugin[], orderIds: string[]): Plugin[] {
  if (!orderIds.length) return list

  const byId = new Map(list.map(p => [p.id, p]))
  const result: Plugin[] = []
  for (const id of orderIds) {
    const hit = byId.get(id)
    if (hit) {
      result.push(hit)
      byId.delete(id)
    }
  }
  for (const p of list) {
    if (byId.has(p.id)) result.push(p)
  }
  return result
}

export function movePluginById(list: Plugin[], draggedId: string, targetId: string, dropAfter: boolean): Plugin[] {
  if (!draggedId || !targetId || draggedId === targetId) return list
  const fromIndex = list.findIndex(p => p.id === draggedId)
  const toIndex = list.findIndex(p => p.id === targetId)
  if (fromIndex < 0 || toIndex < 0) return list

  const next = list.slice()
  const [item] = next.splice(fromIndex, 1)
  let insertIndex = toIndex + (dropAfter ? 1 : 0)
  if (fromIndex < insertIndex) insertIndex -= 1
  if (insertIndex < 0) insertIndex = 0
  if (insertIndex > next.length) insertIndex = next.length
  next.splice(insertIndex, 0, item)
  return next
}
