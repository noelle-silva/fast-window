// web-view (iframe sandbox) (entry: index.js)
;(function () {
  const api = window.fastWindow
  const STORAGE_KEY = 'items'

  const state = {
    loading: true,
    query: '',
    items: [],
    reorderMode: false,
    modal: null, // 'add' | 'edit' | null
    form: { id: '', title: '', url: '', iconUrl: '', iconDataUrl: '', iconCleared: false },
    sniffingFormIcon: false,
    iconCacheById: {},
    iconLoadingById: {},
    ctxMenu: { open: false, id: '', url: '', x: 0, y: 0 },
    confirmKey: '',
    confirmUntil: 0,
  }

  const reorder = {
    pointerId: null,
    draggingId: '',
    overId: '',
    startX: 0,
    startY: 0,
    moved: false,
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
    body { margin: 0; background: var(--bg); color: var(--text); }
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
    .title { font-weight: 900; font-size: 13px; margin-right: auto; }
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
      user-select: none;
    }
    .btn.primary { border-color: transparent; background: var(--primary); color: white; }
    .btn.danger { border-color: transparent; background: var(--danger); color: white; }
    .btn.active { border-color: transparent; background: rgba(25,118,210,0.12); color: var(--primary); }

    .filters { display: flex; gap: 10px; padding: 10px; flex-shrink: 0; }
    .field { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1; }
    .label { font-size: 11px; color: var(--muted); }
    input {
      height: 34px;
      border: 1px solid var(--outline);
      border-radius: 10px;
      padding: 0 10px;
      font-size: 13px;
      outline: none;
      background: white;
      color: var(--text);
      min-width: 0;
    }

    .content { flex: 1; min-height: 0; overflow: auto; padding: 10px; }
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
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .tile.dragging { opacity: 0.65; }
    .tile.dragOver { outline: 2px dashed var(--primary); outline-offset: 2px; }
    .dragHandle {
      position: absolute;
      top: 6px;
      left: 6px;
      width: 26px;
      height: 26px;
      border-radius: 8px;
      border: 1px solid var(--outline);
      background: rgba(255,255,255,0.92);
      color: var(--muted);
      cursor: grab;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      font-size: 14px;
      line-height: 1;
      touch-action: none;
    }
    .dragHandle:active { cursor: grabbing; }
    .dragHandle:hover { background: rgba(0,0,0,0.04); }
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
    .hint { font-size: 12px; color: var(--muted); padding: 6px 2px; text-align: center; }
    .help { font-size: 12px; color: var(--muted); }

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
    .modalHead { display: flex; align-items: center; gap: 8px; padding: 10px; border-bottom: 1px solid var(--outline); }
    .modalTitle { font-size: 13px; font-weight: 900; margin-right: auto; }
    .modalBody { padding: 10px; display: flex; flex-direction: column; gap: 10px; }
    .row { display: flex; gap: 10px; align-items: center; }
    .row .grow { flex: 1; min-width: 0; }
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
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  function closeCtxMenu() {
    state.ctxMenu.open = false
    state.ctxMenu.id = ''
    state.ctxMenu.url = ''
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

  function normalizeUrl(raw) {
    const s = String(raw || '').trim()
    if (!s) return ''
    if (/^https?:\/\//i.test(s)) return s
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return ''
    return `https://${s}`
  }

  function isHttpUrl(url) {
    const u = String(url || '').trim().toLowerCase()
    return u.startsWith('http://') || u.startsWith('https://')
  }

  function toOrigin(url) {
    try {
      return new URL(String(url || '')).origin
    } catch (_) {
      return ''
    }
  }

  function scoreIconLink(rel, sizes, href) {
    const r = String(rel || '').toLowerCase()
    const h = String(href || '').toLowerCase()
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

  function visibleItems() {
    const q = String(state.query || '').trim().toLowerCase()
    if (!q) return state.items.slice()
    return state.items.filter((x) => {
      return String(x.title || '').toLowerCase().includes(q) || String(x.url || '').toLowerCase().includes(q)
    })
  }

  function moveItemById(list, draggedId, targetId) {
    if (!draggedId || !targetId || draggedId === targetId) return list
    const fromIndex = list.findIndex((x) => x.id === draggedId)
    const toIndex = list.findIndex((x) => x.id === targetId)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return list
    const next = list.slice()
    const [it] = next.splice(fromIndex, 1)
    const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex
    next.splice(insertIndex, 0, it)
    return next
  }

  function getTileElById(id) {
    if (!id) return null
    const el = document.querySelector(`[data-role="tile"][data-id="${id}"]`)
    return el instanceof HTMLElement ? el : null
  }

  function clearReorderDomState() {
    if (reorder.draggingId) {
      const draggingEl = getTileElById(reorder.draggingId)
      if (draggingEl) draggingEl.classList.remove('dragging')
    }
    if (reorder.overId) {
      const overEl = getTileElById(reorder.overId)
      if (overEl) overEl.classList.remove('dragOver')
    }
  }

  function setReorderMode(next) {
    const v = Boolean(next)
    if (state.reorderMode === v) return
    state.reorderMode = v
    if (state.reorderMode) {
      api.ui?.showToast?.('已进入拖拽排序：拖动左上角把手')
    } else {
      api.ui?.showToast?.('已退出拖拽排序')
    }
    render()
  }

  async function load() {
    try {
      const saved = await api.storage.get(STORAGE_KEY)
      if (Array.isArray(saved)) {
        state.items = saved
          .map((x) => ({
            id: String(x?.id || ''),
            title: String(x?.title || ''),
            url: String(x?.url || ''),
            iconUrl: typeof x?.iconUrl === 'string' ? String(x.iconUrl || '') : '',
            iconDataUrl: typeof x?.iconDataUrl === 'string' ? String(x.iconDataUrl || '') : '',
            iconPath: typeof x?.iconPath === 'string' ? String(x.iconPath || '') : '',
            createdAt: typeof x?.createdAt === 'number' ? x.createdAt : Date.now(),
            updatedAt: typeof x?.updatedAt === 'number' ? x.updatedAt : Date.now(),
          }))
          .filter((x) => x.id && x.url)
      } else {
        state.items = []
      }
    } catch (_) {
      state.items = []
    }
    state.loading = false
  }

  async function save() {
    try {
      await api.storage.set(STORAGE_KEY, state.items)
    } catch (_) {}
  }

  function openModal(kind, item) {
    state.modal = kind
    if (kind === 'add') {
      state.form = { id: '', title: '', url: '', iconUrl: '', iconDataUrl: '', iconCleared: false }
      state.sniffingFormIcon = false
    } else if (kind === 'edit' && item) {
      state.form = {
        id: String(item.id || ''),
        title: String(item.title || ''),
        url: String(item.url || ''),
        iconUrl: String(item.iconUrl || ''),
        iconDataUrl: '',
        iconCleared: false,
      }
      state.sniffingFormIcon = false
    }
    render()
  }

  function closeModal() {
    state.modal = null
    render()
  }

  async function openInWindow(url) {
    const u = normalizeUrl(url)
    if (!u || !isHttpUrl(u)) {
      api.ui?.showToast?.('URL 只支持 http(s)://，可省略协议')
      return
    }
    try {
      await api.ui.openBrowserWindow(u)
    } catch (_) {
      api.ui?.showToast?.('打开失败')
    }
  }

  function ensureItemIconLoaded(item) {
    const id = String(item?.id || '')
    if (!id) return
    if (state.iconCacheById[id]) return
    if (state.iconLoadingById[id]) return

    const p = String(item.iconPath || '').trim()
    if (!p) {
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
        item.iconPath = ''
        save().catch(() => {})
      })
      .finally(() => {
        delete state.iconLoadingById[id]
        render()
      })
  }

  async function refreshIconForItem(id) {
    const item = state.items.find((x) => x.id === id)
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

  async function sniffFormIcon() {
    if (state.sniffingFormIcon) return
    state.sniffingFormIcon = true
    api.ui?.showToast?.('正在嗅探并下载图标...')
    try {
      const iconUrl = await sniffIconUrl(state.form.url)
      if (!iconUrl) {
        api.ui?.showToast?.('未找到图标')
        return
      }
      const dataUrl = await downloadIconDataUrl(iconUrl)
      state.form.iconUrl = iconUrl
      state.form.iconCleared = false
      if (dataUrl) {
        const png = await rasterizeToPngDataUrl(dataUrl, 64)
        state.form.iconDataUrl = png || ''
      } else {
        state.form.iconDataUrl = ''
      }
      render()
    } finally {
      state.sniffingFormIcon = false
    }
  }

  function clearFormIcon() {
    state.form.iconUrl = ''
    state.form.iconDataUrl = ''
    state.form.iconCleared = true
    render()
  }

  async function addItem() {
    const title = String(state.form.title || '').trim()
    const url = normalizeUrl(state.form.url)
    if (!url || !isHttpUrl(url)) {
      api.ui?.showToast?.('URL 只支持 http(s)://，可省略协议')
      return
    }
    const now = Date.now()
    const iconUrl = String(state.form.iconUrl || '').trim()
    const iconDataUrl = String(state.form.iconDataUrl || '').trim()
    const itemId = uid()
    let iconPath = ''
    if (iconDataUrl) {
      const png = (await rasterizeToPngDataUrl(iconDataUrl, 64)) || iconDataUrl
      const savedPath = await saveIconPngToFile(png, '')
      if (savedPath) iconPath = savedPath
    }
    state.items.unshift({
      id: itemId,
      title: title || url,
      url,
      iconUrl,
      iconDataUrl: '',
      iconPath,
      createdAt: now,
      updatedAt: now,
    })
    await save()
    api.ui?.showToast?.('已添加')
    closeModal()
    render()
    void openInWindow(url)

    if (!iconUrl && !iconPath) {
      Promise.resolve()
        .then(() => refreshIconForItem(itemId))
        .catch(() => {})
    }
  }

  async function editItem() {
    const id = String(state.form.id || '')
    const idx = state.items.findIndex((x) => x.id === id)
    if (idx < 0) return
    const title = String(state.form.title || '').trim()
    const url = normalizeUrl(state.form.url)
    if (!url || !isHttpUrl(url)) {
      api.ui?.showToast?.('URL 只支持 http(s)://，可省略协议')
      return
    }
    const existing = state.items[idx]
    const iconUrl = String(state.form.iconUrl || '').trim()
    const iconDataUrl = String(state.form.iconDataUrl || '').trim()
    let iconPath = String(existing.iconPath || '').trim()

    if (state.form.iconCleared) {
      if (iconPath) {
        api.files?.images?.delete?.({ scope: 'data', path: iconPath }).catch(() => {})
        api.files?.images?.delete?.({ scope: 'output', path: iconPath }).catch(() => {})
      }
      iconPath = ''
      delete state.iconCacheById[id]
      delete state.iconLoadingById[id]
    } else if (iconDataUrl) {
      const png = (await rasterizeToPngDataUrl(iconDataUrl, 64)) || iconDataUrl
      const savedPath = await saveIconPngToFile(png, iconPath)
      if (savedPath) {
        iconPath = savedPath
        delete state.iconCacheById[id]
      }
    }

    state.items[idx] = {
      ...existing,
      title: title || url,
      url,
      iconUrl: state.form.iconCleared ? '' : iconUrl,
      iconDataUrl: '',
      iconPath,
      updatedAt: Date.now(),
    }
    await save()
    api.ui?.showToast?.('已保存')
    closeModal()
    render()
  }

  async function deleteItem(id) {
    if (!confirmOnce(`del:${id}`, '再点一次删除')) return
    const existing = state.items.find((x) => x.id === id)
    const before = state.items.length
    state.items = state.items.filter((x) => x.id !== id)
    if (state.items.length === before) return
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

  function mount() {
    const root = document.getElementById('app') || document.body
    root.innerHTML = `
      <style>${styles}</style>
      <div class="wrap">
        <div class="topbar">
          <button class="btn" data-act="back" aria-label="返回主页" title="返回主页">←</button>
          <div class="title">Web View</div>
          <button class="btn" data-act="toggleReorder" aria-label="拖拽排序模式" title="拖拽排序模式">拖拽排序</button>
          <button class="btn primary" data-act="add" aria-label="新增网站" title="新增网站">新增</button>
        </div>

        <div class="filters">
          <label class="field">
            <span class="label">搜索</span>
            <input data-act="search" aria-label="搜索" placeholder="按标题 / URL 搜索" />
          </label>
        </div>

        <div class="content">
          <div class="list" data-area="list"></div>
          <div class="hint" data-area="empty" style="display:none"></div>
        </div>

        <div class="overlay" data-role="overlayAdd" hidden>
          <div class="modal" role="dialog" aria-modal="true" aria-label="新增网站">
            <div class="modalHead">
              <div class="modalTitle">新增网站</div>
              <button class="btn" data-act="closeModal">关闭</button>
            </div>
            <div class="modalBody">
              <label class="field">
                <span class="label">标题（可选）</span>
                <input data-act="formTitle" placeholder="例如：GitHub" />
              </label>
               <label class="field">
                 <span class="label">URL</span>
                 <input data-act="formUrl" placeholder="https://example.com（可省略协议）" />
               </label>
               <div class="row">
                 <div class="iconLine">
                   <div class="siteIcon">
                     <span class="fallback">🌐</span>
                     <img data-role="formIconImg" alt="网站图标" />
                   </div>
                   <div class="help">图标会嗅探并下载到本地（离线可用）</div>
                 </div>
                 <div class="spacer"></div>
                 <button class="btn" data-act="sniffFormIcon">嗅探并下载</button>
                 <button class="btn" data-act="clearFormIcon">清除</button>
               </div>
               <div class="row">
                 <div class="hint">点击添加后会用新窗口打开</div>
                 <div class="spacer"></div>
                 <button class="btn" data-act="closeModal">取消</button>
                 <button class="btn primary" data-act="confirmAdd">添加</button>
              </div>
            </div>
          </div>
        </div>

        <div class="overlay" data-role="overlayEdit" hidden>
          <div class="modal" role="dialog" aria-modal="true" aria-label="编辑网站">
            <div class="modalHead">
              <div class="modalTitle">编辑网站</div>
              <button class="btn" data-act="closeModal">关闭</button>
            </div>
            <div class="modalBody">
              <label class="field">
                <span class="label">标题（可选）</span>
                <input data-act="formTitle" placeholder="例如：GitHub" />
              </label>
               <label class="field">
                 <span class="label">URL</span>
                 <input data-act="formUrl" placeholder="https://example.com（可省略协议）" />
               </label>
               <div class="row">
                 <div class="iconLine">
                   <div class="siteIcon">
                     <span class="fallback">🌐</span>
                     <img data-role="formIconImg" alt="网站图标" />
                   </div>
                   <div class="help">图标会嗅探并下载到本地（离线可用）</div>
                 </div>
                 <div class="spacer"></div>
                 <button class="btn" data-act="sniffFormIcon">嗅探并下载</button>
                 <button class="btn" data-act="clearFormIcon">清除</button>
               </div>
               <div class="row">
                 <div class="hint">保存只更新列表，不会自动打开</div>
                 <div class="spacer"></div>
                 <button class="btn" data-act="closeModal">取消</button>
                 <button class="btn primary" data-act="confirmEdit">保存</button>
              </div>
            </div>
          </div>
        </div>

        <div class="ctxBackdrop" data-role="ctxBackdrop" hidden></div>
        <div class="ctxMenu" data-role="ctxMenu" hidden role="menu" aria-label="网站操作">
          <button class="ctxItem" data-act="ctxOpen" role="menuitem">↗ 打开</button>
          <button class="ctxItem" data-act="ctxEdit" role="menuitem">✎ 编辑</button>
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

    root.addEventListener('pointerdown', (e) => {
      if (state.loading || state.modal) return
      if (!state.reorderMode) return
      if (String(state.query || '').trim()) return

      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const handleEl = t.closest('[data-role="dragHandle"]')
      if (!(handleEl instanceof HTMLElement)) return

      const tile = handleEl.closest('[data-role="tile"]')
      if (!(tile instanceof HTMLElement)) return
      const id = String(tile.getAttribute('data-id') || '').trim()
      if (!id) return

      e.preventDefault()
      e.stopPropagation()

      if (state.ctxMenu.open) {
        closeCtxMenu()
        renderCtxMenu()
      }

      clearReorderDomState()
      reorder.pointerId = e.pointerId
      reorder.draggingId = id
      reorder.overId = ''
      reorder.startX = e.clientX
      reorder.startY = e.clientY
      reorder.moved = false
      tile.classList.add('dragging')
    })

    window.addEventListener('pointermove', (e) => {
      if (!reorder.draggingId) return
      if (reorder.pointerId !== null && e.pointerId !== reorder.pointerId) return

      const dx = Math.abs(e.clientX - reorder.startX)
      const dy = Math.abs(e.clientY - reorder.startY)
      if (dx + dy > 4) reorder.moved = true

      const el = document.elementFromPoint(e.clientX, e.clientY)
      const tile = el?.closest?.('[data-role="tile"]')
      if (!(tile instanceof HTMLElement)) {
        if (reorder.overId) {
          const prev = getTileElById(reorder.overId)
          if (prev) prev.classList.remove('dragOver')
          reorder.overId = ''
        }
        return
      }
      const id = String(tile.getAttribute('data-id') || '').trim()
      if (!id || id === reorder.draggingId) {
        if (reorder.overId) {
          const prev = getTileElById(reorder.overId)
          if (prev) prev.classList.remove('dragOver')
          reorder.overId = ''
        }
        return
      }

      if (reorder.overId === id) return
      if (reorder.overId) {
        const prev = getTileElById(reorder.overId)
        if (prev) prev.classList.remove('dragOver')
      }
      reorder.overId = id
      tile.classList.add('dragOver')
    })

    function endReorder() {
      if (!reorder.draggingId) return

      const draggedId = reorder.draggingId
      const targetId = reorder.overId
      const moved = reorder.moved
      clearReorderDomState()

      reorder.pointerId = null
      reorder.draggingId = ''
      reorder.overId = ''
      reorder.startX = 0
      reorder.startY = 0
      reorder.moved = false

      if (!moved || !targetId || targetId === draggedId) return
      const next = moveItemById(state.items, draggedId, targetId)
      if (next === state.items) return
      state.items = next
      ;(async () => {
        await save()
        render()
      })()
    }

    window.addEventListener('pointerup', (e) => {
      if (reorder.pointerId !== null && e.pointerId !== reorder.pointerId) return
      endReorder()
    })
    window.addEventListener('pointercancel', (e) => {
      if (reorder.pointerId !== null && e.pointerId !== reorder.pointerId) return
      endReorder()
    })

    root.addEventListener('click', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (t.closest('[data-role="dragHandle"]')) return
      const act = t.getAttribute('data-act')

      if (act === 'ctxOpen') {
        const url = String(state.ctxMenu.url || '').trim()
        closeCtxMenu()
        renderCtxMenu()
        if (url) return openInWindow(url)
        return
      }
      if (act === 'ctxEdit') {
        const id = String(state.ctxMenu.id || '').trim()
        const item = state.items.find((x) => x.id === id)
        closeCtxMenu()
        renderCtxMenu()
        if (!item) return
        return openModal('edit', item)
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
        return deleteItem(id)
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
      if (act === 'toggleReorder') return setReorderMode(!state.reorderMode)
      if (act === 'closeModal') return closeModal()
      if (act === 'confirmAdd') return addItem()
      if (act === 'confirmEdit') return editItem()
      if (act === 'sniffFormIcon') return sniffFormIcon()
      if (act === 'clearFormIcon') return clearFormIcon()

      if (act === 'sniffIcon') {
        const id = String(t.getAttribute('data-id') || '')
        if (!id) return
        return refreshIconForItem(id)
      }

      if (act === 'editBtn') {
        const id = String(t.getAttribute('data-id') || '')
        const item = state.items.find((x) => x.id === id)
        if (!item) return
        return openModal('edit', item)
      }
      if (act === 'delBtn') {
        const id = String(t.getAttribute('data-id') || '')
        if (!id) return
        return deleteItem(id)
      }
      if (act === 'openBtn') {
        const url = String(t.getAttribute('data-url') || '')
        if (!url) return
        return openInWindow(url)
      }

      const openEl = t.closest('[data-act="open"]')
      if (openEl instanceof HTMLElement) {
        const url = String(openEl.getAttribute('data-url') || '')
        if (!url) return
        return openInWindow(url)
      }
    })

    root.addEventListener('contextmenu', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (state.modal) return
      const tile = t.closest('[data-role="tile"]')
      if (!(tile instanceof HTMLElement)) return
      const id = String(tile.getAttribute('data-id') || '').trim()
      const url = String(tile.getAttribute('data-url') || '').trim()
      if (!id) return
      e.preventDefault()
      state.ctxMenu.open = true
      state.ctxMenu.id = id
      state.ctxMenu.url = url
      state.ctxMenu.x = e.clientX
      state.ctxMenu.y = e.clientY
      renderCtxMenu()
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

    root.addEventListener('input', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const act = t.getAttribute('data-act')

      if (act === 'search' && t instanceof HTMLInputElement) {
        state.query = t.value
        render()
        return
      }
      if (act === 'formTitle' && t instanceof HTMLInputElement) {
        state.form.title = t.value
        return
      }
      if (act === 'formUrl' && t instanceof HTMLInputElement) {
        state.form.url = t.value
        return
      }
    })

    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (state.ctxMenu.open) {
          closeCtxMenu()
          renderCtxMenu()
          return
        }
        if (state.modal) closeModal()
      }
      if (e.key === 'Enter') {
        if (state.modal === 'add') return addItem()
        if (state.modal === 'edit') return editItem()
        if (!state.modal && !state.ctxMenu.open) {
          const ae = document.activeElement
          if (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement || ae instanceof HTMLSelectElement) return
          if (ae instanceof HTMLElement) {
            const tile = ae.closest?.('[data-role="tile"]')
            if (tile instanceof HTMLElement) {
              const url = String(tile.getAttribute('data-url') || '').trim()
              if (!url) return
              return openInWindow(url)
            }
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
    const overlayEdit = document.querySelector('[data-role="overlayEdit"]')
    if (overlayAdd instanceof HTMLElement) overlayAdd.hidden = state.modal !== 'add'
    if (overlayEdit instanceof HTMLElement) overlayEdit.hidden = state.modal !== 'edit'

    const searchEl = document.querySelector('input[data-act="search"]')
    if (searchEl instanceof HTMLInputElement) searchEl.value = state.query

    const reorderBtn = document.querySelector('button[data-act="toggleReorder"]')
    if (reorderBtn instanceof HTMLButtonElement) {
      reorderBtn.textContent = state.reorderMode ? '完成排序' : '拖拽排序'
      if (state.reorderMode) reorderBtn.classList.add('active')
      else reorderBtn.classList.remove('active')
      if (String(state.query || '').trim()) {
        reorderBtn.disabled = true
        reorderBtn.title = '搜索中不可排序'
      } else {
        reorderBtn.disabled = false
        reorderBtn.title = '拖拽排序模式'
      }
    }

    if (state.modal === 'add' || state.modal === 'edit') {
      const scope = state.modal === 'add' ? '[data-role="overlayAdd"]' : '[data-role="overlayEdit"]'
      const titleEl = document.querySelector(`${scope} input[data-act="formTitle"]`)
      const urlEl = document.querySelector(`${scope} input[data-act="formUrl"]`)
      if (titleEl instanceof HTMLInputElement) titleEl.value = state.form.title
      if (urlEl instanceof HTMLInputElement) urlEl.value = state.form.url

      if (state.modal === 'edit') {
        const it = state.items.find((x) => x.id === String(state.form.id || ''))
        if (it) ensureItemIconLoaded(it)
      }
      const iconEl = document.querySelector(`${scope} img[data-role="formIconImg"]`)
      if (iconEl instanceof HTMLImageElement) {
        iconEl.setAttribute('referrerpolicy', 'no-referrer')
        const cached = String(state.iconCacheById[String(state.form.id || '')] || '').trim()
        const icon =
          String(state.form.iconDataUrl || '').trim() ||
          (state.modal === 'edit' ? cached : '') ||
          String(state.form.iconUrl || '').trim()
        const wrap = iconEl.closest('.siteIcon')
        if (icon) {
          iconEl.src = icon
          if (wrap instanceof HTMLElement) wrap.classList.remove('err')
        } else {
          iconEl.removeAttribute('src')
          if (wrap instanceof HTMLElement) {
            wrap.classList.remove('ok')
            wrap.classList.remove('err')
          }
        }
      }
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

    const items = visibleItems()
    if (!items.length) {
      listEl.innerHTML = ''
      emptyEl.style.display = 'block'
      emptyEl.textContent = state.query ? '未找到匹配的网站' : '暂无网站，请点击右上角「新增」'
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
          const dragHandle =
            !state.reorderMode || String(state.query || '').trim()
              ? ''
              : `<button class="dragHandle" data-role="dragHandle" type="button" tabindex="-1" aria-label="拖拽排序" title="拖拽排序">⠿</button>`
          return `
            <div class="tile" tabindex="0" data-role="tile" data-act="open" data-id="${escapeHtml(x.id)}" data-url="${escapeHtml(x.url)}" title="${escapeHtml(x.url)}">
              ${dragHandle}
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
  }

  async function init() {
    await load()
    mount()
    render()
  }

  init()
})()
