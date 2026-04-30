import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const DEFAULT_GROUP_ID = 'default'

export function now() {
  return Date.now()
}

export function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export function normalizeUrl(raw: unknown) {
  const input = String(raw || '').trim()
  if (!input) return null

  let candidate = input.replaceAll('\\', '/')
  if (candidate.startsWith('//')) candidate = `https:${candidate}`
  else if (!/^[a-z]+:\/\//i.test(candidate)) candidate = `https://${candidate}`

  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

export function inferIconUrl(url: unknown) {
  const normalized = normalizeUrl(url)
  if (!normalized) return ''

  try {
    const u = new URL(normalized)
    return `${u.protocol}//${u.host}/favicon.ico`
  } catch {
    return ''
  }
}

export function normalizeData(saved: any) {
  const t = now()
  const base = {
    schemaVersion: 1,
    groups: [{ id: DEFAULT_GROUP_ID, name: '默认', createdAt: t }],
    items: [],
  }
  if (!saved || typeof saved !== 'object') return base

  const rawGroups = Array.isArray(saved.groups) ? saved.groups : []
  const groups = rawGroups
    .map(item => ({
      id: String(item && item.id || '').trim(),
      name: String(item && item.name || '').trim(),
      createdAt: Number.isFinite(Number(item && item.createdAt)) ? Math.floor(Number(item.createdAt)) : t,
    }))
    .filter(item => item.id && item.name)

  if (!groups.some(item => item.id === DEFAULT_GROUP_ID)) groups.unshift({ id: DEFAULT_GROUP_ID, name: '默认', createdAt: t })
  const groupIds = new Set(groups.map(item => item.id))

  const rawItems = Array.isArray(saved.items) ? saved.items : []
  const items = rawItems
    .map(item => {
      const url = normalizeUrl(item && item.url)
      const iconUrl = String(item && (item.iconUrl || item.iconDataUrl) || '').trim()
      return {
        id: String(item && item.id || '').trim(),
        title: String(item && item.title || '').trim(),
        url: url || '',
        iconUrl,
        groupId: groupIds.has(String(item && item.groupId || '')) ? String(item.groupId) : DEFAULT_GROUP_ID,
        createdAt: Number.isFinite(Number(item && item.createdAt)) ? Math.floor(Number(item.createdAt)) : t,
        updatedAt: Number.isFinite(Number(item && item.updatedAt)) ? Math.floor(Number(item.updatedAt)) : t,
        lastOpenedAt: Number.isFinite(Number(item && item.lastOpenedAt)) ? Math.floor(Number(item.lastOpenedAt)) : null,
      }
    })
    .filter(item => item.id && item.url)
    .sort((a, b) => (b.lastOpenedAt ?? b.updatedAt ?? b.createdAt) - (a.lastOpenedAt ?? a.updatedAt ?? a.createdAt))

  return { schemaVersion: 1, groups, items }
}

export function createBookmarkStore(dataPath: string) {
  async function readRawData() {
    try {
      const text = await readFile(dataPath, 'utf8')
      return text.trim() ? JSON.parse(text) : null
    } catch (error: any) {
      if (error && error.code === 'ENOENT') return null
      throw error
    }
  }

  async function save(data: any) {
    await mkdir(dirname(dataPath), { recursive: true })
    const normalized = normalizeData(data)
    await writeFile(dataPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  }

  async function load() {
    await mkdir(dirname(dataPath), { recursive: true })
    const raw = await readRawData()
    const data = normalizeData(raw)
    if (!raw) await save(data)
    return data
  }

  return { load, save }
}
