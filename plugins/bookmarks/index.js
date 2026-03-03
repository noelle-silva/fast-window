// bookmarks (iframe sandbox) (entry: index.js)
;(function () {
  const api = window.fastWindow
  const STORAGE_KEY = 'data'
  const DEFAULT_GROUP_ID = 'default'
  const ALL_GROUP_ID = '__all__'

  const state = {
    loading: true,
    groupId: ALL_GROUP_ID,
    search: '',
    data: {
      schemaVersion: 1,
      groups: [],
      items: [],
    },
    modal: null, // 'add' | 'groups' | null
    addTitle: '',
    addUrl: '',
    addGroupId: DEFAULT_GROUP_ID,
    addIconUrl: '',
    addIconDataUrl: '',
    sniffingAddIcon: false,
    iconCacheById: {},
    iconLoadingById: {},
    ctxMenu: { open: false, id: '', x: 0, y: 0 },
    newGroupName: '',
    groupNameEdits: {},
    confirmKey: '',
    confirmUntil: 0,
  }

  const styles = `
    :root {
      --bg: #FAFAFA;
      --surface: #FFFFFF;
      --text: #212121;
      --muted: #757575;
      --outline: #E0E0E0;
      --primary: #1976D2;
      --danger: #D32F2F;
      --shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);
      --radius: 12px;
    }
    * { box-sizing: border-box; }
    body { background: var(--bg); color: var(--text); }
    .wrap { height: 100vh; display: flex; flex-direction: column; }
    .topbar {
      height: 44px;
      background: var(--surface);
      border-bottom: 1px solid var(--outline);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      box-shadow: var(--shadow);
      flex-shrink: 0;
    }
    .title { font-weight: 800; font-size: 13px; margin-right: auto; }
    .btn {
      border: 1px solid var(--outline);
      background: var(--surface);
      color: var(--text);
      height: 30px;
      padding: 0 10px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 12px;
      line-height: 28px;
    }
    .btn.primary { border-color: transparent; background: var(--primary); color: white; }
    .btn.danger { border-color: transparent; background: var(--danger); color: white; }

    .filters {
      display: flex;
      gap: 10px;
      padding: 10px;
      flex-shrink: 0;
    }
    .field { display: flex; flex-direction: column; gap: 6px; min-width: 120px; }
    .field.grow { flex: 1; min-width: 0; }
    .label { font-size: 11px; color: var(--muted); }
    select, input {
      height: 34px;
      border: 1px solid var(--outline);
      border-radius: 10px;
      padding: 0 10px;
      font-size: 13px;
      outline: none;
      background: white;
      color: var(--text);
    }

    .content { flex: 1; overflow: auto; padding: 10px; }
    .list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
      gap: 12px;
      align-content: start;
    }
    .tile {
      background: var(--surface);
      border: 1px solid var(--outline);
      border-radius: var(--radius);
      padding: 12px 10px;
      box-shadow: var(--shadow);
      cursor: pointer;
      user-select: none;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .tile:focus { outline: none; }
    .tileName {
      font-weight: 800;
      font-size: 12px;
      line-height: 1.2;
      width: 100%;
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spacer { margin-left: auto; }
    .empty { color: var(--muted); text-align: center; padding: 28px 0; font-size: 13px; }

    .tile .siteIcon {
      width: 52px;
      height: 52px;
      border-radius: 999px;
      border: 1px solid var(--outline);
      background: white;
      box-shadow: 0 1px 2px rgba(0,0,0,0.08);
    }
    .tile .fallback { font-size: 22px; }

    .overlay[hidden] { display: none; }
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .modal {
      width: min(560px, 100%);
      background: var(--surface);
      border: 1px solid var(--outline);
      border-radius: 14px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.25);
      overflow: hidden;
    }
    .modalHead {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px;
      border-bottom: 1px solid var(--outline);
    }
    .modalTitle { font-size: 13px; font-weight: 800; margin-right: auto; }
    .modalBody { padding: 10px; display: flex; flex-direction: column; gap: 10px; }
    .row { display: flex; gap: 10px; align-items: center; }
    .row.grow { align-items: stretch; }
    .row .grow { flex: 1; min-width: 0; }
    .help { font-size: 12px; color: var(--muted); }
    .groupRow {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 8px;
      border: 1px solid var(--outline);
      border-radius: 12px;
      background: white;
    }
    .groupRow input { flex: 1; }

    .iconLine { display: flex; align-items: center; gap: 10px; }
    .siteIcon {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      border: 1px solid var(--outline);
      background: white;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      flex-shrink: 0;
    }
    .siteIcon img { width: 100%; height: 100%; display: block; }
    .siteIcon.ok .fallback { display: none; }
    .siteIcon.err img { display: none; }
    .fallback { font-size: 13px; color: var(--muted); line-height: 1; }

    .ctxBackdrop[hidden] { display: none; }
    .ctxBackdrop {
      position: fixed;
      inset: 0;
      background: transparent;
      z-index: 50;
    }
    .ctxMenu[hidden] { display: none; }
    .ctxMenu {
      position: fixed;
      z-index: 60;
      min-width: 160px;
      background: var(--surface);
      border: 1px solid var(--outline);
      border-radius: 12px;
      box-shadow: 0 12px 30px rgba(0,0,0,0.22);
      padding: 6px;
    }
    .ctxItem {
      width: 100%;
      height: 34px;
      padding: 0 10px;
      border: 0;
      background: transparent;
      border-radius: 10px;
      cursor: pointer;
      text-align: left;
      color: var(--text);
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ctxItem:hover { background: rgba(0,0,0,0.06); }
    .ctxItem.danger { color: var(--danger); }
    .ctxSep { height: 1px; background: var(--outline); margin: 6px 4px; }
  `

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;')
  }

  function uid() {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`
  }

  function closeCtxMenu() {
    state.ctxMenu.open = false
    state.ctxMenu.id = ''
  }

  function renderCtxMenu() {
    const menu = document.querySelector('[data-role="ctxMenu"]')
    const backdrop = document.querySelector('[data-role="ctxBackdrop"]')
    if (!(menu instanceof HTMLElement) || !(backdrop instanceof HTMLElement)) return

    const show = state.ctxMenu.open && !state.modal && String(state.ctxMenu.id || '').trim()
    menu.hidden = !show
    backdrop.hidden = !show
    if (!show) return

    const x0 = Number(state.ctxMenu.x || 0)
    const y0 = Number(state.ctxMenu.y || 0)
    menu.style.left = `${x0}px`
    menu.style.top = `${y0}px`

    requestAnimationFrame(() => {
      if (menu.hidden) return
      const pad = 8
      const rect = menu.getBoundingClientRect()
      let x = x0
      let y = y0
      if (x + rect.width > window.innerWidth - pad) x = window.innerWidth - pad - rect.width
      if (y + rect.height > window.innerHeight - pad) y = window.innerHeight - pad - rect.height
      x = Math.max(pad, x)
      y = Math.max(pad, y)
      menu.style.left = `${x}px`
      menu.style.top = `${y}px`
    })
  }

  function isHttpUrl(u) {
    return /^https?:\/\//i.test(String(u || ''))
  }

  function normalizeUrl(raw) {
    const input = String(raw || '').trim()
    if (!input) return null

    // Windows 复制出来的链接经常混入反斜杠：会被当成路径，导致 explorer 打开资源管理器。
    const s = input.replaceAll('\\', '/')

    let candidate = s
    if (/^[a-z]+:\/\//i.test(candidate)) {
      // 只允许 http(s)
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

  function toOrigin(url) {
    try {
      const u = new URL(url)
      return `${u.protocol}//${u.host}`
    } catch {
      return null
    }
  }

  function scoreIconLink(rel, sizes, href) {
    const r = String(rel || '').toLowerCase()
    const h = String(href || '')
    if (!h) return -1

    let base = 0
    if (r.includes('apple-touch-icon')) base += 40
    if (r.includes('icon')) base += 30
    if (r.includes('mask-icon')) base += 10

    const s = String(sizes || '').toLowerCase()
    if (s.includes('any')) base += 5
    const m = s.match(/(\d+)\s*x\s*(\d+)/)
    if (m) {
      const w = Number(m[1] || 0)
      const h2 = Number(m[2] || 0)
      if (w > 0 && h2 > 0) base += Math.min(100, Math.floor((w * h2) / 256))
    }
    return base
  }

  function getHeader(headers, name) {
    if (!headers || typeof headers !== 'object') return ''
    const target = String(name || '').toLowerCase()
    for (const [k, v] of Object.entries(headers)) {
      if (String(k || '').toLowerCase() === target) return String(v || '')
    }
    return ''
  }

  function guessImageMimeByUrl(url) {
    const u = String(url || '').toLowerCase()
    if (u.includes('.svg')) return 'image/svg+xml'
    if (u.includes('.webp')) return 'image/webp'
    if (u.includes('.jpg') || u.includes('.jpeg')) return 'image/jpeg'
    if (u.includes('.png')) return 'image/png'
    if (u.includes('.ico')) return 'image/x-icon'
    return 'image/png'
  }

  function mimeFromContentTypeOrUrl(contentType, url) {
    const ct = String(contentType || '').toLowerCase()
    if (ct.includes('image/')) {
      const pure = ct.split(';')[0].trim()
      return pure || guessImageMimeByUrl(url)
    }
    return guessImageMimeByUrl(url)
  }

  async function rasterizeToPngDataUrl(srcDataUrl, size) {
    const s = typeof size === 'number' && Number.isFinite(size) ? Math.max(16, Math.min(256, Math.floor(size))) : 64
    const src = String(srcDataUrl || '').trim()
    if (!src.startsWith('data:')) return null

    const img = await new Promise((resolve, reject) => {
      const el = new window.Image()
      el.decoding = 'async'
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('ICON_LOAD_FAILED'))
      el.src = src
    }).catch(() => null)

    if (!(img instanceof HTMLImageElement)) return null
    const iw = img.naturalWidth || img.width
    const ih = img.naturalHeight || img.height
    if (!iw || !ih) return null

    const canvas = document.createElement('canvas')
    canvas.width = s
    canvas.height = s
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.clearRect(0, 0, s, s)
    const scale = Math.min(s / iw, s / ih)
    const dw = Math.max(1, Math.floor(iw * scale))
    const dh = Math.max(1, Math.floor(ih * scale))
    const dx = Math.floor((s - dw) / 2)
    const dy = Math.floor((s - dh) / 2)
    ctx.drawImage(img, dx, dy, dw, dh)
    return canvas.toDataURL('image/png')
  }

  async function saveIconPngToFile(pngDataUrl, prevPath) {
    if (!api.files?.images?.writeBase64) return null
    const src = String(pngDataUrl || '').trim()
    if (!src.startsWith('data:image/')) return null
    const path = await api.files.images.writeBase64({ scope: 'data', dataUrlOrBase64: src })
    const oldPath = String(prevPath || '').trim()
    if (oldPath) {
      api.files?.images?.delete?.({ scope: 'data', path: oldPath }).catch(() => {})
      api.files?.images?.delete?.({ scope: 'output', path: oldPath }).catch(() => {})
    }
    return path
  }

  async function downloadIconDataUrl(iconUrl) {
    const raw = String(iconUrl || '').trim()
    if (!raw) return null
    const lower = raw.toLowerCase()
    if (lower.startsWith('data:image/')) return raw
    if (!/^https?:\/\//i.test(raw)) return null

    if (!api.net?.request) return null

    const resp = await api.net.request({
      method: 'GET',
      url: raw,
      responseType: 'base64',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) fast-window/0.1',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
      },
      timeoutMs: 12000,
    })

    const status = Number(resp?.status || 0)
    if (!(status >= 200 && status < 400)) return null

    const b64 = String(resp?.bodyBase64 || '')
    if (!b64) return null

    // 图标别太离谱：避免把几 MB 的东西塞进 storage。
    const approxBytes = Math.floor((b64.length * 3) / 4)
    if (approxBytes > 512 * 1024) return null

    const mime = mimeFromContentTypeOrUrl(getHeader(resp?.headers, 'content-type'), raw)
    return `data:${mime};base64,${b64}`
  }

  async function sniffIconUrl(pageUrl) {
    const url = normalizeUrl(pageUrl)
    if (!url) return null

    const origin = toOrigin(url)
    const fallback = origin ? `${origin}/favicon.ico` : null

    if (!api.net?.request) return fallback

    try {
      const resp = await api.net.request({
        method: 'GET',
        url,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) fast-window/0.1',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
        },
        timeoutMs: 12000,
      })

      const html = String(resp?.body || '')
      if (!html) return fallback

      const doc = new DOMParser().parseFromString(html, 'text/html')
      const baseHref = doc.querySelector('base[href]')?.getAttribute('href') || ''
      const base = baseHref ? String(new URL(baseHref, url)) : url

      const links = Array.from(doc.querySelectorAll('link[rel][href]'))
      const candidates = []
      for (const el of links) {
        const rel = el.getAttribute('rel') || ''
        const href = el.getAttribute('href') || ''
        if (!href) continue
        const r = rel.toLowerCase()
        if (!r.includes('icon')) continue

        const sizes = el.getAttribute('sizes') || ''
        candidates.push({ rel, href, sizes, score: scoreIconLink(rel, sizes, href) })
      }

      candidates.sort((a, b) => b.score - a.score)
      const top = candidates[0]
      if (top && top.href) {
        const resolved = new URL(top.href, base).toString()
        if (/^https?:\/\//i.test(resolved) || resolved.toLowerCase().startsWith('data:image/')) return resolved
      }

      return fallback
    } catch (_) {
      return fallback
    }
  }

  function ensureData(saved) {
    const now = Date.now()
    const base = {
      schemaVersion: 1,
      groups: [{ id: DEFAULT_GROUP_ID, name: '默认', createdAt: now }],
      items: [],
    }
    if (!saved || typeof saved !== 'object') return base
    const g = Array.isArray(saved.groups) ? saved.groups : []
    const items = Array.isArray(saved.items) ? saved.items : []
    const groups = g
      .map((x) => ({
        id: String(x?.id || ''),
        name: String(x?.name || ''),
        createdAt: typeof x?.createdAt === 'number' ? x.createdAt : now,
      }))
      .filter((x) => x.id && x.name)
    if (!groups.some((x) => x.id === DEFAULT_GROUP_ID)) {
      groups.unshift({ id: DEFAULT_GROUP_ID, name: '默认', createdAt: now })
    }
    const groupIds = new Set(groups.map((x) => x.id))
    return {
      schemaVersion: 1,
      groups,
      items: items
        .map((x) => ({
          id: String(x?.id || ''),
          title: String(x?.title || ''),
          url: String(x?.url || ''),
          iconUrl: typeof x?.iconUrl === 'string' ? String(x.iconUrl || '') : '',
          iconDataUrl: typeof x?.iconDataUrl === 'string' ? String(x.iconDataUrl || '') : '',
          iconPath: typeof x?.iconPath === 'string' ? String(x.iconPath || '') : '',
          groupId: groupIds.has(String(x?.groupId || '')) ? String(x?.groupId || '') : DEFAULT_GROUP_ID,
          createdAt: typeof x?.createdAt === 'number' ? x.createdAt : now,
          updatedAt: typeof x?.updatedAt === 'number' ? x.updatedAt : now,
          lastOpenedAt: typeof x?.lastOpenedAt === 'number' ? x.lastOpenedAt : null,
        }))
        .filter((x) => x.id && x.url),
    }
  }

  function groupNameOf(groupId) {
    const g = state.data.groups.find((x) => x.id === groupId)
    return g ? g.name : '默认'
  }

  function formatTime(ts) {
    if (!ts || typeof ts !== 'number') return ''
    try {
      return new Date(ts).toLocaleString()
    } catch {
      return ''
    }
  }

  function confirmOnce(key, message) {
    const now = Date.now()
    if (state.confirmKey === key && state.confirmUntil > now) {
      state.confirmKey = ''
      state.confirmUntil = 0
      return true
    }
    state.confirmKey = key
    state.confirmUntil = now + 2500
    api.ui?.showToast?.(message || '再点一次确认')
    return false
  }

  async function load() {
    try {
      const saved = await api.storage.get(STORAGE_KEY)
      state.data = ensureData(saved)
    } catch (_) {
      state.data = ensureData(null)
    }

    if (!state.data.groups.some((x) => x.id === state.addGroupId)) {
      state.addGroupId = DEFAULT_GROUP_ID
    }
    state.loading = false
  }

  async function save() {
    try {
      await api.storage.set(STORAGE_KEY, state.data)
    } catch (_) {}
  }

  function openModal(kind) {
    state.modal = kind
    if (kind === 'add') {
      state.addTitle = ''
      state.addUrl = ''
      state.addGroupId = state.groupId === ALL_GROUP_ID ? DEFAULT_GROUP_ID : state.groupId
      state.addIconUrl = ''
      state.addIconDataUrl = ''
      state.sniffingAddIcon = false
    }
    if (kind === 'groups') {
      state.newGroupName = ''
      state.groupNameEdits = {}
    }
    render()
  }

  function closeModal() {
    state.modal = null
    render()
  }

  function getVisibleItems() {
    const q = String(state.search || '').trim().toLowerCase()
    const gid = state.groupId
    return state.data.items
      .filter((x) => {
        if (gid !== ALL_GROUP_ID && x.groupId !== gid) return false
        if (!q) return true
        return String(x.title || '').toLowerCase().includes(q) || String(x.url || '').toLowerCase().includes(q)
      })
      .sort((a, b) => {
        const ta = a.lastOpenedAt ?? a.updatedAt ?? a.createdAt
        const tb = b.lastOpenedAt ?? b.updatedAt ?? b.createdAt
        return tb - ta
      })
  }

  async function addBookmark() {
    const title = String(state.addTitle || '').trim()
    const url = normalizeUrl(state.addUrl)
    const groupId = String(state.addGroupId || DEFAULT_GROUP_ID)
    const iconUrl = String(state.addIconUrl || '').trim()
    const iconDataUrl = String(state.addIconDataUrl || '').trim()

    if (!url) {
      api.ui?.showToast?.('URL 只支持 http(s)://，可省略协议')
      return
    }
    if (!state.data.groups.some((x) => x.id === groupId)) {
      api.ui?.showToast?.('分组不存在')
      return
    }

    const now = Date.now()
    const itemId = uid()
    let iconPath = ''
    if (iconDataUrl) {
      const png = (await rasterizeToPngDataUrl(iconDataUrl, 64)) || iconDataUrl
      const savedPath = await saveIconPngToFile(png, '')
      if (savedPath) iconPath = savedPath
    }
    state.data.items.unshift({
      id: itemId,
      title: title || url,
      url,
      iconUrl,
      iconDataUrl: '',
      iconPath,
      groupId,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
    })
    await save()
    api.ui?.showToast?.('已添加')
    closeModal()

    if (!iconUrl && !iconPath) {
      Promise.resolve()
        .then(() => refreshIconForItem(itemId))
        .catch(() => {})
    }
  }

  async function deleteBookmark(id) {
    const existing = state.data.items.find((x) => x.id === id)
    const before = state.data.items.length
    state.data.items = state.data.items.filter((x) => x.id !== id)
    if (state.data.items.length === before) return
    if (existing && String(existing.iconPath || '').trim()) {
      const p = String(existing.iconPath || '').trim()
      if (p) {
        api.files?.images?.delete?.({ scope: 'data', path: p }).catch(() => {})
        api.files?.images?.delete?.({ scope: 'output', path: p }).catch(() => {})
      }
    }
    delete state.iconCacheById[id]
    delete state.iconLoadingById[id]
    await save()
    api.ui?.showToast?.('已删除')
    render()
  }

  async function openBookmark(id) {
    const item = state.data.items.find((x) => x.id === id)
    if (!item) return
    const url = normalizeUrl(item.url)
    if (!url || !isHttpUrl(url)) {
      api.ui?.showToast?.('URL 不合法')
      return
    }
    try {
      await api.ui.openUrl(url)
      const now = Date.now()
      item.url = url
      item.updatedAt = now
      item.lastOpenedAt = now
      await save()
      render()
    } catch (_) {
      api.ui?.showToast?.('打开失败')
    }
  }

  async function refreshIconForItem(id) {
    const item = state.data.items.find((x) => x.id === id)
    if (!item) return
    api.ui?.showToast?.('正在嗅探图标...')
    const iconUrl = await sniffIconUrl(item.url)
    if (!iconUrl) {
      api.ui?.showToast?.('未找到图标')
      return
    }
    item.iconUrl = iconUrl
    const dataUrl = await downloadIconDataUrl(iconUrl)
    if (!dataUrl) {
      item.updatedAt = Date.now()
      await save()
      api.ui?.showToast?.('已设置图标地址（未下载）')
      render()
      return
    }

    const png = (await rasterizeToPngDataUrl(dataUrl, 64)) || null
    if (!png) {
      api.ui?.showToast?.('图标下载成功，但无法转换为 PNG')
      return
    }
    const path = await saveIconPngToFile(png, item.iconPath || '')
    if (path) {
      item.iconPath = path
      item.iconDataUrl = ''
      delete state.iconCacheById[id]
    }
    item.updatedAt = Date.now()
    await save()
    api.ui?.showToast?.(path ? '图标已下载到本地' : '图标保存失败')
    render()
  }

  async function sniffAddIcon() {
    if (state.sniffingAddIcon) return
    state.sniffingAddIcon = true
    api.ui?.showToast?.('正在嗅探并下载图标...')
    try {
      const iconUrl = await sniffIconUrl(state.addUrl)
      if (!iconUrl) {
        api.ui?.showToast?.('未找到图标')
        return
      }
      const dataUrl = await downloadIconDataUrl(iconUrl)
      state.addIconUrl = iconUrl
      if (dataUrl) {
        const png = await rasterizeToPngDataUrl(dataUrl, 64)
        state.addIconDataUrl = png || ''
      } else {
        state.addIconDataUrl = ''
      }
      render()
    } finally {
      state.sniffingAddIcon = false
    }
  }

  async function addGroup() {
    const name = String(state.newGroupName || '').trim()
    if (!name) return
    const lower = name.toLowerCase()
    if (state.data.groups.some((x) => String(x.name || '').toLowerCase() === lower)) {
      api.ui?.showToast?.('分组名已存在')
      return
    }
    state.data.groups.push({ id: uid(), name, createdAt: Date.now() })
    state.newGroupName = ''
    await save()
    render()
  }

  async function renameGroup(groupId) {
    const raw = state.groupNameEdits[groupId]
    const name = String(raw ?? '').trim()
    if (!name) return
    const g = state.data.groups.find((x) => x.id === groupId)
    if (!g) return
    const lower = name.toLowerCase()
    if (state.data.groups.some((x) => x.id !== groupId && String(x.name || '').toLowerCase() === lower)) {
      api.ui?.showToast?.('分组名已存在')
      return
    }
    g.name = name
    await save()
    api.ui?.showToast?.('已保存')
    render()
  }

  async function deleteGroup(groupId) {
    if (groupId === DEFAULT_GROUP_ID) return
    if (!state.data.groups.some((x) => x.id === groupId)) return
    if (!confirmOnce(`delGroup:${groupId}`, '再点一次删除分组（收藏会移到「默认」）')) return

    state.data.groups = state.data.groups.filter((x) => x.id !== groupId)
    for (const it of state.data.items) {
      if (it.groupId === groupId) it.groupId = DEFAULT_GROUP_ID
    }
    if (state.groupId === groupId) state.groupId = ALL_GROUP_ID
    await save()
    api.ui?.showToast?.('已删除')
    render()
  }

  function mount() {
    const root = document.getElementById('app') || document.body
    root.innerHTML = `
      <style>${styles}</style>
      <div class="wrap">
        <div class="topbar">
          <button class="btn" data-act="back" aria-label="返回主页" title="返回主页">←</button>
          <div class="title">网站收藏</div>
          <button class="btn" data-act="groups" aria-label="分组管理" title="分组管理">分组</button>
          <button class="btn primary" data-act="add" aria-label="新增收藏" title="新增收藏">新增</button>
        </div>

        <div class="filters">
          <label class="field">
            <span class="label">分组</span>
            <select data-act="group" aria-label="分组筛选"></select>
          </label>
          <label class="field grow">
            <span class="label">搜索</span>
            <input data-act="search" aria-label="搜索" placeholder="按标题 / URL 搜索" />
          </label>
        </div>

        <div class="content">
          <div class="list" data-area="list"></div>
          <div class="empty" data-area="empty" style="display:none"></div>
        </div>

        <div class="overlay" data-role="overlayAdd" hidden>
          <div class="modal" role="dialog" aria-modal="true" aria-label="新增收藏">
            <div class="modalHead">
              <div class="modalTitle">新增收藏</div>
              <button class="btn" data-act="closeAdd">关闭</button>
            </div>
            <div class="modalBody">
              <label class="field">
                <span class="label">标题（可选）</span>
                <input data-act="addTitle" placeholder="例如：GitHub" />
              </label>
              <label class="field">
                <span class="label">URL</span>
                <input data-act="addUrl" placeholder="https://example.com（可省略协议）" />
              </label>
              <div class="row">
                <div class="iconLine">
                  <div class="siteIcon" data-role="addIconWrap">
                    <span class="fallback">🌐</span>
                    <img data-role="addIconImg" alt="网站图标" />
                  </div>
                  <div class="help">图标会嗅探并下载到本地（离线可用）</div>
                </div>
                <div class="spacer"></div>
                <button class="btn" data-act="sniffAddIcon">嗅探并下载</button>
                <button class="btn" data-act="clearAddIcon">清除</button>
              </div>
              <label class="field">
                <span class="label">分组</span>
                <select data-act="addGroup" aria-label="选择分组"></select>
              </label>
              <div class="row">
                <div class="help">仅支持 http(s)://</div>
                <div class="spacer"></div>
                <button class="btn" data-act="closeAdd">取消</button>
                <button class="btn primary" data-act="confirmAdd">添加</button>
              </div>
            </div>
          </div>
        </div>

        <div class="overlay" data-role="overlayGroups" hidden>
          <div class="modal" role="dialog" aria-modal="true" aria-label="分组管理">
            <div class="modalHead">
              <div class="modalTitle">分组管理</div>
              <button class="btn" data-act="closeGroups">关闭</button>
            </div>
            <div class="modalBody">
              <div class="help">删除分组会把收藏移动到「默认」</div>
              <div data-area="groupsList"></div>
              <div class="row grow">
                <input class="grow" data-act="newGroupName" placeholder="新分组名" />
                <button class="btn primary" data-act="addGroup">添加</button>
              </div>
            </div>
          </div>
        </div>

        <div class="ctxBackdrop" data-role="ctxBackdrop" hidden></div>
        <div class="ctxMenu" data-role="ctxMenu" hidden role="menu" aria-label="收藏操作">
          <button class="ctxItem" data-act="ctxOpen" role="menuitem">↗ 打开</button>
          <button class="ctxItem" data-act="ctxSniff" role="menuitem">⟳ 刷新图标</button>
          <div class="ctxSep" role="separator"></div>
          <button class="ctxItem danger" data-act="ctxDelete" role="menuitem">🗑 删除</button>
        </div>
      </div>
    `

    const topbar = root.querySelector('.topbar')
    if (topbar) {
      topbar.addEventListener('pointerdown', (e) => {
        if (!(e instanceof PointerEvent)) return
        if (e.button !== 0) return
        const t = e.target
        if (!(t instanceof HTMLElement)) return
        if (t.closest('button, a, input, textarea, select, [role="button"]')) return
        api.ui?.startDragging?.()
      })
    }

    root.addEventListener('click', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const act = t.getAttribute('data-act')

      if (act === 'ctxOpen') {
        const id = String(state.ctxMenu.id || '').trim()
        closeCtxMenu()
        renderCtxMenu()
        if (!id) return
        return openBookmark(id)
      }
      if (act === 'ctxSniff') {
        const id = String(state.ctxMenu.id || '').trim()
        closeCtxMenu()
        renderCtxMenu()
        if (!id) return
        return refreshIconForItem(id)
      }
      if (act === 'ctxDelete') {
        const id = String(state.ctxMenu.id || '').trim()
        closeCtxMenu()
        renderCtxMenu()
        if (!id) return
        if (!confirmOnce(`del:${id}`, '再点一次删除这条收藏')) return
        return deleteBookmark(id)
      }
      if (t.getAttribute('data-role') === 'ctxBackdrop') {
        closeCtxMenu()
        renderCtxMenu()
        return
      }
      if (state.ctxMenu.open && !t.closest('[data-role="ctxMenu"]')) {
        closeCtxMenu()
        renderCtxMenu()
      }

      if (act === 'back') return api.ui?.back ? api.ui.back() : api.ui?.showToast?.('无法返回')
      if (act === 'add') return openModal('add')
      if (act === 'groups') return openModal('groups')
      if (act === 'closeAdd' || act === 'closeGroups') return closeModal()
      if (act === 'confirmAdd') return addBookmark()
      if (act === 'sniffAddIcon') return sniffAddIcon()
      if (act === 'clearAddIcon') {
        state.addIconUrl = ''
        state.addIconDataUrl = ''
        render()
        return
      }
      if (act === 'addGroup') return addGroup()
      if (act === 'saveGroup') return renameGroup(String(t.getAttribute('data-id') || ''))
      if (act === 'delGroup') return deleteGroup(String(t.getAttribute('data-id') || ''))
      if (act === 'del') {
        const id = String(t.getAttribute('data-id') || '')
        if (!id) return
        if (!confirmOnce(`del:${id}`, '再点一次删除这条收藏')) return
        return deleteBookmark(id)
      }
      if (act === 'sniffIcon') {
        const id = String(t.getAttribute('data-id') || '')
        if (!id) return
        return refreshIconForItem(id)
      }
      if (act === 'openBtn') {
        const id = String(t.getAttribute('data-id') || '')
        if (!id) return
        return openBookmark(id)
      }

      const openEl = t.closest('[data-act=\"open\"]')
      if (openEl instanceof HTMLElement) {
        const id = String(openEl.getAttribute('data-id') || '')
        if (!id) return
        return openBookmark(id)
      }
    })

    root.addEventListener('contextmenu', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (state.modal) return
      const tile = t.closest('[data-role="tile"]')
      if (!(tile instanceof HTMLElement)) return
      const id = String(tile.getAttribute('data-id') || '').trim()
      if (!id) return
      e.preventDefault()
      state.ctxMenu.open = true
      state.ctxMenu.id = id
      state.ctxMenu.x = e.clientX
      state.ctxMenu.y = e.clientY
      renderCtxMenu()
    })

    root.addEventListener('input', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const act = t.getAttribute('data-act')

      if (act === 'search' && t instanceof HTMLInputElement) {
        state.search = t.value
        render()
        return
      }
      if (act === 'addTitle' && t instanceof HTMLInputElement) {
        state.addTitle = t.value
        return
      }
      if (act === 'addUrl' && t instanceof HTMLInputElement) {
        state.addUrl = t.value
        return
      }
      if (act === 'newGroupName' && t instanceof HTMLInputElement) {
        state.newGroupName = t.value
        return
      }

      if (act === 'groupName' && t instanceof HTMLInputElement) {
        const gid = String(t.getAttribute('data-id') || '')
        if (!gid) return
        state.groupNameEdits[gid] = t.value
      }
    })

    root.addEventListener('change', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const act = t.getAttribute('data-act')
      if (act === 'group' && t instanceof HTMLSelectElement) {
        state.groupId = t.value || ALL_GROUP_ID
        render()
        return
      }
      if (act === 'addGroup' && t instanceof HTMLSelectElement) {
        state.addGroupId = t.value || DEFAULT_GROUP_ID
        return
      }
    })

    root.addEventListener(
      'load',
      (e) => {
        const t = e.target
        if (!(t instanceof HTMLImageElement)) return
        const wrap = t.closest('.siteIcon')
        if (!(wrap instanceof HTMLElement)) return
        wrap.classList.add('ok')
        wrap.classList.remove('err')
      },
      true,
    )
    root.addEventListener(
      'error',
      (e) => {
        const t = e.target
        if (!(t instanceof HTMLImageElement)) return
        const wrap = t.closest('.siteIcon')
        if (!(wrap instanceof HTMLElement)) return
        wrap.classList.add('err')
        wrap.classList.remove('ok')
      },
      true,
    )

    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (state.ctxMenu.open) {
          closeCtxMenu()
          renderCtxMenu()
          return
        }
        if (state.modal) closeModal()
        return
      }

      if (e.key === 'Enter' && !state.modal && !state.ctxMenu.open) {
        const ae = document.activeElement
        if (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement || ae instanceof HTMLSelectElement) return
        if (ae instanceof HTMLElement) {
          const tile = ae.closest?.('[data-role="tile"]')
          if (tile instanceof HTMLElement) {
            const id = String(tile.getAttribute('data-id') || '').trim()
            if (!id) return
            return openBookmark(id)
          }
        }
      }
    })

    root.addEventListener(
      'scroll',
      () => {
        if (!state.ctxMenu.open) return
        closeCtxMenu()
        renderCtxMenu()
      },
      true,
    )
  }

  function render() {
    const overlayAdd = document.querySelector('[data-role="overlayAdd"]')
    const overlayGroups = document.querySelector('[data-role="overlayGroups"]')
    if (overlayAdd instanceof HTMLElement) overlayAdd.hidden = state.modal !== 'add'
    if (overlayGroups instanceof HTMLElement) overlayGroups.hidden = state.modal !== 'groups'

    const searchEl = document.querySelector('input[data-act="search"]')
    if (searchEl instanceof HTMLInputElement) searchEl.value = state.search

    const groupSel = document.querySelector('select[data-act="group"]')
    const addGroupSel = document.querySelector('select[data-act="addGroup"]')
    if (groupSel instanceof HTMLSelectElement) {
      const opts = [
        { id: ALL_GROUP_ID, name: '全部' },
        ...state.data.groups.map((x) => ({ id: x.id, name: x.name })),
      ]
      groupSel.innerHTML = opts.map((x) => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)}</option>`).join('')
      groupSel.value = state.groupId || ALL_GROUP_ID
    }
    if (addGroupSel instanceof HTMLSelectElement) {
      const opts = state.data.groups.map((x) => ({ id: x.id, name: x.name }))
      addGroupSel.innerHTML = opts.map((x) => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)}</option>`).join('')
      addGroupSel.value = state.addGroupId || DEFAULT_GROUP_ID
    }

    const listEl = document.querySelector('[data-area="list"]')
    const emptyEl = document.querySelector('[data-area="empty"]')
    if (!(listEl instanceof HTMLElement) || !(emptyEl instanceof HTMLElement)) return

    if (state.loading) {
      listEl.innerHTML = ''
      emptyEl.style.display = 'block'
      emptyEl.textContent = '加载中...'
      return
    }

    const items = getVisibleItems()
    if (!items.length) {
      listEl.innerHTML = ''
      emptyEl.style.display = 'block'
      emptyEl.textContent = state.search ? '未找到匹配的收藏' : '暂无收藏'
    } else {
      emptyEl.style.display = 'none'
      listEl.innerHTML = items
        .map((x) => {
          const icon = String(state.iconCacheById[x.id] || '').trim()
          if (!icon) {
            ensureItemIconLoaded(x)
          }
          const iconImg = icon
            ? `<img alt="网站图标" loading="lazy" referrerpolicy="no-referrer" src="${escapeHtml(icon)}" />`
            : `<img alt="网站图标" loading="lazy" referrerpolicy="no-referrer" />`
          return `
            <div class="tile" tabindex="0" data-role="tile" data-act="open" data-id="${escapeHtml(x.id)}" title="${escapeHtml(x.url)}">
              <div class="siteIcon" aria-hidden="true">
                <span class="fallback">🌐</span>
                ${iconImg}
              </div>
              <div class="tileName">${escapeHtml(x.title || x.url)}</div>
            </div>
          `
        })
        .join('')
    }

    renderCtxMenu()

    const groupsList = document.querySelector('[data-area="groupsList"]')
    if (groupsList instanceof HTMLElement) {
      groupsList.innerHTML = state.data.groups
        .slice()
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((g) => {
          const val = state.groupNameEdits[g.id]
          const name = typeof val === 'string' ? val : g.name
          const canDel = g.id !== DEFAULT_GROUP_ID
          return `
            <div class="groupRow">
              <input data-act="groupName" data-id="${escapeHtml(g.id)}" value="${escapeHtml(name)}" aria-label="分组名" />
              <button class="btn" data-act="saveGroup" data-id="${escapeHtml(g.id)}">保存</button>
              ${
                canDel
                  ? `<button class="btn danger" data-act="delGroup" data-id="${escapeHtml(g.id)}">删除</button>`
                  : `<button class="btn" disabled title="默认分组不可删除">锁定</button>`
              }
            </div>
          `
        })
        .join('')
    }

    const addTitle = document.querySelector('input[data-act="addTitle"]')
    const addUrl = document.querySelector('input[data-act="addUrl"]')
    const newGroupName = document.querySelector('input[data-act="newGroupName"]')
    if (addTitle instanceof HTMLInputElement) addTitle.value = state.addTitle
    if (addUrl instanceof HTMLInputElement) addUrl.value = state.addUrl
    if (newGroupName instanceof HTMLInputElement) newGroupName.value = state.newGroupName

    const addIconImg = document.querySelector('img[data-role="addIconImg"]')
    if (addIconImg instanceof HTMLImageElement) {
      addIconImg.setAttribute('referrerpolicy', 'no-referrer')
      const icon = String(state.addIconDataUrl || '').trim() || String(state.addIconUrl || '').trim()
      const wrap = addIconImg.closest('.siteIcon')
      if (icon) {
        addIconImg.src = icon
        if (wrap instanceof HTMLElement) {
          wrap.classList.remove('err')
        }
      } else {
        addIconImg.removeAttribute('src')
        if (wrap instanceof HTMLElement) {
          wrap.classList.remove('ok')
          wrap.classList.remove('err')
        }
      }
    }
  }

  function ensureItemIconLoaded(item) {
    const id = String(item?.id || '')
    if (!id) return
    if (state.iconCacheById[id]) return
    if (state.iconLoadingById[id]) return

    const p = String(item.iconPath || '').trim()
    if (!p) {
      // 兼容迁移：旧数据可能把 iconDataUrl 存在 storage 里，趁机落盘。
      const legacy = String(item.iconDataUrl || '').trim()
      if (!legacy) return
      state.iconLoadingById[id] = true
      Promise.resolve()
        .then(async () => {
          const png = await rasterizeToPngDataUrl(legacy, 64)
          const okLegacy =
            legacy.includes('data:image/png') || legacy.includes('data:image/jpeg') || legacy.includes('data:image/webp')
          const payload = png || (okLegacy ? legacy : '')
          if (!payload) return
          const savedPath = await saveIconPngToFile(payload, '')
          if (savedPath) {
            item.iconPath = savedPath
            item.iconDataUrl = ''
            await save()
            state.iconCacheById[id] = await api.files.images.read({ scope: 'data', path: savedPath })
            render()
          }
        })
        .catch(() => {})
        .finally(() => {
          delete state.iconLoadingById[id]
        })
      return
    }

    if (!api.files?.images?.read) return
    state.iconLoadingById[id] = true
    api.files.images
      .read({ scope: 'data', path: p })
      .catch(() => api.files.images.read({ scope: 'output', path: p }))
      .then((dataUrl) => {
        state.iconCacheById[id] = String(dataUrl || '')
      })
      .catch(() => {
        // 文件丢了就清掉，避免每次都读失败。
        item.iconPath = ''
        save().catch(() => {})
      })
      .finally(() => {
        delete state.iconLoadingById[id]
        render()
      })
  }

  async function init() {
    await load()
    mount()
    render()
  }

  init()
})()
