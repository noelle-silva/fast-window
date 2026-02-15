// web-view (iframe sandbox) (entry: index.js)
;(function () {
  const api = window.fastWindow
  const STORAGE_KEY = 'items'

  const state = {
    loading: true,
    query: '',
    items: [],
    modal: null, // 'add' | 'edit' | null
    form: { id: '', title: '', url: '' },
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
    .list { display: flex; flex-direction: column; gap: 10px; }
    .card {
      background: var(--surface);
      border: 1px solid var(--outline);
      border-radius: var(--radius);
      padding: 10px;
      box-shadow: var(--shadow);
      cursor: pointer;
    }
    .cardTop { display: flex; align-items: center; gap: 8px; }
    .name { font-weight: 800; font-size: 13px; line-height: 1.2; }
    .spacer { margin-left: auto; }
    .iconBtn {
      border: 1px solid var(--outline);
      background: white;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      line-height: 26px;
      text-align: center;
      color: var(--muted);
      flex-shrink: 0;
    }
    .iconBtn.danger { color: var(--danger); }
    .url { margin-top: 6px; font-size: 12px; color: var(--muted); word-break: break-all; }
    .hint { font-size: 12px; color: var(--muted); padding: 6px 2px; text-align: center; }

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

  async function load() {
    try {
      const saved = await api.storage.get(STORAGE_KEY)
      if (Array.isArray(saved)) {
        state.items = saved
          .map((x) => ({
            id: String(x?.id || ''),
            title: String(x?.title || ''),
            url: String(x?.url || ''),
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
      state.form = { id: '', title: '', url: '' }
    } else if (kind === 'edit' && item) {
      state.form = { id: String(item.id || ''), title: String(item.title || ''), url: String(item.url || '') }
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

  async function addItem() {
    const title = String(state.form.title || '').trim()
    const url = normalizeUrl(state.form.url)
    if (!url || !isHttpUrl(url)) {
      api.ui?.showToast?.('URL 只支持 http(s)://，可省略协议')
      return
    }
    const now = Date.now()
    state.items.unshift({
      id: uid(),
      title: title || url,
      url,
      createdAt: now,
      updatedAt: now,
    })
    await save()
    api.ui?.showToast?.('已添加')
    closeModal()
    render()
    void openInWindow(url)
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
    state.items[idx] = { ...state.items[idx], title: title || url, url, updatedAt: Date.now() }
    await save()
    api.ui?.showToast?.('已保存')
    closeModal()
    render()
  }

  async function deleteItem(id) {
    if (!confirmOnce(`del:${id}`, '再点一次删除')) return
    const before = state.items.length
    state.items = state.items.filter((x) => x.id !== id)
    if (state.items.length === before) return
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
                <div class="hint">保存只更新列表，不会自动打开</div>
                <div class="spacer"></div>
                <button class="btn" data-act="closeModal">取消</button>
                <button class="btn primary" data-act="confirmEdit">保存</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `

    root.addEventListener('click', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const act = t.getAttribute('data-act')

      if (act === 'back') return api.ui?.back ? api.ui.back() : api.ui?.showToast?.('无法返回')
      if (act === 'add') return openModal('add')
      if (act === 'closeModal') return closeModal()
      if (act === 'confirmAdd') return addItem()
      if (act === 'confirmEdit') return editItem()

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
        if (state.modal) closeModal()
      }
      if (e.key === 'Enter') {
        if (state.modal === 'add') return addItem()
        if (state.modal === 'edit') return editItem()
      }
    })
  }

  function render() {
    const overlayAdd = document.querySelector('[data-role="overlayAdd"]')
    const overlayEdit = document.querySelector('[data-role="overlayEdit"]')
    if (overlayAdd instanceof HTMLElement) overlayAdd.hidden = state.modal !== 'add'
    if (overlayEdit instanceof HTMLElement) overlayEdit.hidden = state.modal !== 'edit'

    const searchEl = document.querySelector('input[data-act="search"]')
    if (searchEl instanceof HTMLInputElement) searchEl.value = state.query

    if (state.modal === 'add' || state.modal === 'edit') {
      const scope = state.modal === 'add' ? '[data-role="overlayAdd"]' : '[data-role="overlayEdit"]'
      const titleEl = document.querySelector(`${scope} input[data-act="formTitle"]`)
      const urlEl = document.querySelector(`${scope} input[data-act="formUrl"]`)
      if (titleEl instanceof HTMLInputElement) titleEl.value = state.form.title
      if (urlEl instanceof HTMLInputElement) urlEl.value = state.form.url
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
          return `
            <div class="card" data-act="open" data-url="${escapeHtml(x.url)}" title="点击用新窗口打开">
              <div class="cardTop">
                <div class="name">${escapeHtml(x.title || x.url)}</div>
                <div class="spacer"></div>
                <button class="iconBtn" data-act="openBtn" data-url="${escapeHtml(x.url)}" title="打开">↗</button>
                <button class="iconBtn" data-act="editBtn" data-id="${escapeHtml(x.id)}" title="编辑">✎</button>
                <button class="iconBtn danger" data-act="delBtn" data-id="${escapeHtml(x.id)}" title="删除">🗑</button>
              </div>
              <div class="url">${escapeHtml(x.url)}</div>
            </div>
          `
        })
        .join('')
    }
  }

  async function init() {
    await load()
    mount()
    render()
  }

  init()
})()

