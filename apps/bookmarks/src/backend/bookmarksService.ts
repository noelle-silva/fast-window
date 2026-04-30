import { DEFAULT_GROUP_ID, inferIconUrl, normalizeUrl, now, uid } from './store'
import { openUrl } from './openExternalUrl'

function ensureGroup(data: any, groupId: unknown) {
  const id = String(groupId || DEFAULT_GROUP_ID).trim() || DEFAULT_GROUP_ID
  if (!data.groups.some((group: any) => group.id === id)) throw new Error('分组不存在')
  return id
}

function ensureUniqueGroupName(data: any, name: unknown, exceptId: string) {
  const lower = String(name || '').trim().toLowerCase()
  if (!lower) throw new Error('分组名不能为空')
  if (data.groups.some((group: any) => group.id !== exceptId && String(group.name || '').toLowerCase() === lower)) {
    throw new Error('分组名已存在')
  }
}

export function createBookmarksService(store: { load: () => Promise<any>; save: (data: any) => Promise<void> }) {
  async function list() {
    return store.load()
  }

  async function addBookmark(payload: any) {
    const data = await store.load()
    const url = normalizeUrl(payload && payload.url)
    if (!url) throw new Error('URL 只支持 http(s)://，可省略协议')
    const groupId = ensureGroup(data, payload && payload.groupId)
    const t = now()
    const iconUrl = String(payload && payload.iconUrl || '').trim() || inferIconUrl(url)
    data.items.unshift({
      id: uid(),
      title: String(payload && payload.title || '').trim() || url,
      url,
      iconUrl,
      groupId,
      createdAt: t,
      updatedAt: t,
      lastOpenedAt: null,
    })
    await store.save(data)
    return store.load()
  }

  async function updateBookmark(payload: any) {
    const data = await store.load()
    const id = String(payload && payload.id || '').trim()
    const item = data.items.find((entry: any) => entry.id === id)
    if (!item) throw new Error('条目不存在')
    const url = normalizeUrl(payload && payload.url)
    if (!url) throw new Error('URL 只支持 http(s)://，可省略协议')
    item.title = String(payload && payload.title || '').trim() || url
    item.url = url
    item.groupId = ensureGroup(data, payload && payload.groupId)
    item.iconUrl = String(payload && payload.iconUrl || '').trim() || inferIconUrl(url)
    item.updatedAt = now()
    await store.save(data)
    return store.load()
  }

  async function deleteBookmark(payload: any) {
    const data = await store.load()
    const id = String(payload && payload.id || '').trim()
    data.items = data.items.filter((entry: any) => entry.id !== id)
    await store.save(data)
    return store.load()
  }

  async function openBookmark(payload: any) {
    const data = await store.load()
    const id = String(payload && payload.id || '').trim()
    const item = data.items.find((entry: any) => entry.id === id)
    if (!item) throw new Error('条目不存在')
    const url = normalizeUrl(item.url)
    if (!url) throw new Error('URL 不合法')
    openUrl(url)
    const t = now()
    item.url = url
    item.updatedAt = t
    item.lastOpenedAt = t
    await store.save(data)
    return store.load()
  }

  async function refreshIcon(payload: any) {
    const data = await store.load()
    const id = String(payload && payload.id || '').trim()
    const item = data.items.find((entry: any) => entry.id === id)
    if (!item) throw new Error('条目不存在')
    item.iconUrl = inferIconUrl(item.url)
    item.updatedAt = now()
    await store.save(data)
    return store.load()
  }

  async function addGroup(payload: any) {
    const data = await store.load()
    const name = String(payload && payload.name || '').trim()
    ensureUniqueGroupName(data, name, '')
    data.groups.push({ id: uid(), name, createdAt: now() })
    await store.save(data)
    return store.load()
  }

  async function renameGroup(payload: any) {
    const data = await store.load()
    const groupId = String(payload && payload.groupId || '').trim()
    if (groupId === DEFAULT_GROUP_ID) throw new Error('默认分组不可重命名')
    const group = data.groups.find((entry: any) => entry.id === groupId)
    if (!group) throw new Error('分组不存在')
    const name = String(payload && payload.name || '').trim()
    ensureUniqueGroupName(data, name, groupId)
    group.name = name
    await store.save(data)
    return store.load()
  }

  async function deleteGroup(payload: any) {
    const data = await store.load()
    const groupId = String(payload && payload.groupId || '').trim()
    if (groupId === DEFAULT_GROUP_ID) throw new Error('默认分组不可删除')
    data.groups = data.groups.filter((entry: any) => entry.id !== groupId)
    for (const item of data.items) {
      if (item.groupId === groupId) item.groupId = DEFAULT_GROUP_ID
    }
    await store.save(data)
    return store.load()
  }

  async function dispatch(method: string, params: unknown) {
    if (method === 'bookmarks.list') return list()
    if (method === 'bookmarks.inferIcon') return { iconUrl: inferIconUrl((params as any) && (params as any).url) }
    if (method === 'bookmarks.add') return addBookmark(params)
    if (method === 'bookmarks.update') return updateBookmark(params)
    if (method === 'bookmarks.delete') return deleteBookmark(params)
    if (method === 'bookmarks.open') return openBookmark(params)
    if (method === 'bookmarks.refreshIcon') return refreshIcon(params)
    if (method === 'bookmarks.addGroup') return addGroup(params)
    if (method === 'bookmarks.renameGroup') return renameGroup(params)
    if (method === 'bookmarks.deleteGroup') return deleteGroup(params)
    throw new Error(`未知请求：${String(method || '')}`)
  }

  return { dispatch, list }
}
