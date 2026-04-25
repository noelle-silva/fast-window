// bookmarks v3 autonomous backend (iframe sandbox) (entry: backend.js)
;(function () {
  const DEFAULT_GROUP_ID = 'default'
  const DATA_PATH = 'data.json'
  const MAILBOX_DIR = '_mailbox'
  const REQUEST_DIR = `${MAILBOX_DIR}/requests`
  const RESPONSE_DIR = `${MAILBOX_DIR}/responses`
  const POLL_MS = 120

  function requireBackendApi(baseApi) {
    const api = baseApi || {}
    if (!api || Number(api.__meta?.apiVersion || 0) < 3) {
      throw new Error('网站收藏后端需要 v3 插件宿主 API')
    }
    const fs = api.workspace?.fs
    if (!fs?.readText || !fs?.writeText || !fs?.listDir || !fs?.mkdir || !fs?.remove) {
      throw new Error('workspace.fs 不可用')
    }
    return api
  }

  const api = requireBackendApi(window.fastWindow)

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  function uid() {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`
  }

  function now() {
    return Date.now()
  }

  function isMissingError(error) {
    const msg = String(error?.message || error || '')
    return msg.includes('文件不存在') || msg.includes('not found') || msg.includes('No such file')
  }

  async function readText(path) {
    return api.workspace.fs.readText({ scope: 'data', path })
  }

  async function writeText(path, text) {
    await api.workspace.fs.writeText({ scope: 'data', path, text: String(text ?? ''), overwrite: true })
  }

  async function readJson(path, fallback) {
    try {
      const text = await readText(path)
      const s = String(text || '').trim()
      if (!s) return fallback
      return JSON.parse(s)
    } catch (e) {
      if (isMissingError(e)) return fallback
      throw e
    }
  }

  async function writeJson(path, value) {
    await writeText(path, JSON.stringify(value ?? null, null, 2) + '\n')
  }

  async function removePath(path) {
    await api.workspace.fs.remove({ scope: 'data', path }).catch(() => {})
  }

  async function ensureMailbox() {
    await api.workspace.fs.mkdir({ scope: 'data', path: MAILBOX_DIR }).catch(() => {})
    await api.workspace.fs.mkdir({ scope: 'data', path: REQUEST_DIR }).catch(() => {})
    await api.workspace.fs.mkdir({ scope: 'data', path: RESPONSE_DIR }).catch(() => {})
  }

  function normalizeUrl(raw) {
    const input = String(raw || '').trim()
    if (!input) return null
    const s = input.replaceAll('\\', '/')
    let candidate = s
    if (/^[a-z]+:\/\//i.test(candidate)) {
      // protocol is handled below
    } else if (candidate.startsWith('//')) {
      candidate = `https:${candidate}`
    } else {
      candidate = `https://${candidate}`
    }
    try {
      const u = new URL(candidate)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
      return u.toString()
    } catch {
      return null
    }
  }

  function inferIconUrl(url) {
    const normalized = normalizeUrl(url)
    if (!normalized) return ''
    try {
      const u = new URL(normalized)
      return `${u.protocol}//${u.host}/favicon.ico`
    } catch {
      return ''
    }
  }

  function normalizeData(saved) {
    const t = now()
    const base = {
      schemaVersion: 1,
      groups: [{ id: DEFAULT_GROUP_ID, name: '默认', createdAt: t }],
      items: [],
    }
    if (!saved || typeof saved !== 'object') return base

    const rawGroups = Array.isArray(saved.groups) ? saved.groups : []
    const groups = rawGroups
      .map((x) => ({
        id: String(x?.id || '').trim(),
        name: String(x?.name || '').trim(),
        createdAt: Number.isFinite(Number(x?.createdAt)) ? Math.floor(Number(x.createdAt)) : t,
      }))
      .filter((x) => x.id && x.name)

    if (!groups.some((x) => x.id === DEFAULT_GROUP_ID)) groups.unshift({ id: DEFAULT_GROUP_ID, name: '默认', createdAt: t })
    const groupIds = new Set(groups.map((x) => x.id))

    const rawItems = Array.isArray(saved.items) ? saved.items : []
    const items = rawItems
      .map((x) => {
        const url = normalizeUrl(x?.url)
        const iconUrl = String(x?.iconUrl || x?.iconDataUrl || '').trim()
        return {
          id: String(x?.id || '').trim(),
          title: String(x?.title || '').trim(),
          url: url || '',
          iconUrl,
          groupId: groupIds.has(String(x?.groupId || '')) ? String(x.groupId) : DEFAULT_GROUP_ID,
          createdAt: Number.isFinite(Number(x?.createdAt)) ? Math.floor(Number(x.createdAt)) : t,
          updatedAt: Number.isFinite(Number(x?.updatedAt)) ? Math.floor(Number(x.updatedAt)) : t,
          lastOpenedAt: Number.isFinite(Number(x?.lastOpenedAt)) ? Math.floor(Number(x.lastOpenedAt)) : null,
        }
      })
      .filter((x) => x.id && x.url)
      .sort((a, b) => (b.lastOpenedAt ?? b.updatedAt ?? b.createdAt) - (a.lastOpenedAt ?? a.updatedAt ?? a.createdAt))

    return { schemaVersion: 1, groups, items }
  }

  async function loadData() {
    const raw = await readJson(DATA_PATH, null)
    const data = normalizeData(raw)
    if (!raw) await saveData(data)
    return data
  }

  async function saveData(data) {
    await writeJson(DATA_PATH, normalizeData(data))
  }

  function ensureGroup(data, groupId) {
    const gid = String(groupId || DEFAULT_GROUP_ID).trim() || DEFAULT_GROUP_ID
    if (!data.groups.some((x) => x.id === gid)) throw new Error('分组不存在')
    return gid
  }

  function ensureUniqueGroupName(data, name, exceptId) {
    const lower = String(name || '').trim().toLowerCase()
    if (!lower) throw new Error('分组名不能为空')
    if (data.groups.some((x) => x.id !== exceptId && String(x.name || '').toLowerCase() === lower)) {
      throw new Error('分组名已存在')
    }
  }

  async function addBookmark(payload) {
    const data = await loadData()
    const url = normalizeUrl(payload?.url)
    if (!url) throw new Error('URL 只支持 http(s)://，可省略协议')
    const groupId = ensureGroup(data, payload?.groupId)
    const t = now()
    const iconUrl = String(payload?.iconUrl || '').trim() || inferIconUrl(url)
    data.items.unshift({
      id: uid(),
      title: String(payload?.title || '').trim() || url,
      url,
      iconUrl,
      groupId,
      createdAt: t,
      updatedAt: t,
      lastOpenedAt: null,
    })
    await saveData(data)
    return loadData()
  }

  async function updateBookmark(payload) {
    const data = await loadData()
    const id = String(payload?.id || '').trim()
    const item = data.items.find((x) => x.id === id)
    if (!item) throw new Error('条目不存在')
    const url = normalizeUrl(payload?.url)
    if (!url) throw new Error('URL 只支持 http(s)://，可省略协议')
    item.title = String(payload?.title || '').trim() || url
    item.url = url
    item.groupId = ensureGroup(data, payload?.groupId)
    item.iconUrl = String(payload?.iconUrl || '').trim() || inferIconUrl(url)
    item.updatedAt = now()
    await saveData(data)
    return loadData()
  }

  async function deleteBookmark(payload) {
    const data = await loadData()
    const id = String(payload?.id || '').trim()
    data.items = data.items.filter((x) => x.id !== id)
    await saveData(data)
    return loadData()
  }

  async function openBookmark(payload) {
    const data = await loadData()
    const id = String(payload?.id || '').trim()
    const item = data.items.find((x) => x.id === id)
    if (!item) throw new Error('条目不存在')
    const url = normalizeUrl(item.url)
    if (!url) throw new Error('URL 不合法')
    const t = now()
    item.url = url
    item.updatedAt = t
    item.lastOpenedAt = t
    await saveData(data)
    return { url, data: await loadData() }
  }

  async function refreshIcon(payload) {
    const data = await loadData()
    const id = String(payload?.id || '').trim()
    const item = data.items.find((x) => x.id === id)
    if (!item) throw new Error('条目不存在')
    item.iconUrl = inferIconUrl(item.url)
    item.updatedAt = now()
    await saveData(data)
    return loadData()
  }

  async function addGroup(payload) {
    const data = await loadData()
    const name = String(payload?.name || '').trim()
    ensureUniqueGroupName(data, name, '')
    data.groups.push({ id: uid(), name, createdAt: now() })
    await saveData(data)
    return loadData()
  }

  async function renameGroup(payload) {
    const data = await loadData()
    const groupId = String(payload?.groupId || '').trim()
    if (groupId === DEFAULT_GROUP_ID) throw new Error('默认分组不可重命名')
    const group = data.groups.find((x) => x.id === groupId)
    if (!group) throw new Error('分组不存在')
    const name = String(payload?.name || '').trim()
    ensureUniqueGroupName(data, name, groupId)
    group.name = name
    await saveData(data)
    return loadData()
  }

  async function deleteGroup(payload) {
    const data = await loadData()
    const groupId = String(payload?.groupId || '').trim()
    if (groupId === DEFAULT_GROUP_ID) throw new Error('默认分组不可删除')
    data.groups = data.groups.filter((x) => x.id !== groupId)
    for (const item of data.items) {
      if (item.groupId === groupId) item.groupId = DEFAULT_GROUP_ID
    }
    await saveData(data)
    return loadData()
  }

  async function dispatch(action, payload) {
    if (action === 'list') return loadData()
    if (action === 'inferIcon') return { iconUrl: inferIconUrl(payload?.url) }
    if (action === 'addBookmark') return addBookmark(payload)
    if (action === 'updateBookmark') return updateBookmark(payload)
    if (action === 'deleteBookmark') return deleteBookmark(payload)
    if (action === 'openBookmark') return openBookmark(payload)
    if (action === 'refreshIcon') return refreshIcon(payload)
    if (action === 'addGroup') return addGroup(payload)
    if (action === 'renameGroup') return renameGroup(payload)
    if (action === 'deleteGroup') return deleteGroup(payload)
    throw new Error(`未知请求：${String(action || '')}`)
  }

  async function writeResponse(request, body) {
    const id = String(request?.id || '').trim()
    if (!id) return
    await writeJson(`${RESPONSE_DIR}/${id}.json`, body)
  }

  async function handleRequestEntry(entry) {
    const name = String(entry?.name || '').trim()
    if (!name || !name.endsWith('.json')) return
    const path = `${REQUEST_DIR}/${name}`
    const request = await readJson(path, null)
    if (!request || typeof request !== 'object') {
      await removePath(path)
      return
    }

    try {
      const result = await dispatch(String(request.action || ''), request.payload)
      await writeResponse(request, { ok: true, result })
    } catch (e) {
      await writeResponse(request, { ok: false, error: String(e?.message || e || '请求失败') })
    } finally {
      await removePath(path)
    }
  }

  async function loop() {
    await ensureMailbox()
    await loadData()
    while (true) {
      try {
        const entries = await api.workspace.fs.listDir({ scope: 'data', dir: REQUEST_DIR }).catch((e) => {
          if (isMissingError(e)) return []
          throw e
        })
        for (const entry of Array.isArray(entries) ? entries : []) {
          if (entry && entry.isFile) await handleRequestEntry(entry)
        }
      } catch (e) {
        console.error('[bookmarks-backend] loop error:', e)
      }
      await sleep(POLL_MS)
    }
  }

  loop().catch((e) => console.error('[bookmarks-backend] fatal:', e))
})()
