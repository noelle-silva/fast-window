// vscode-workspaces (iframe sandbox) (entry: index.js)
;(function () {
  const api = window.fastWindow
  const STORAGE_KEY = 'data'

  const state = {
    loading: true,
    items: [],
    addOpen: false,
    addName: '',
    addPath: '',
    confirmKey: '',
    confirmUntil: 0,
  }

  const styles = `
    :root{
      --bg:#FAFAFA; --surface:#FFF; --text:#212121; --muted:#757575;
      --outline:#E0E0E0; --primary:#1976D2; --danger:#D32F2F;
      --shadow:0 1px 3px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.24);
      --radius:12px;
    }
    *{box-sizing:border-box;}
    body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;}
    .wrap{height:100vh;display:flex;flex-direction:column;}
    .topbar{
      height:44px;flex-shrink:0;display:flex;align-items:center;gap:8px;
      padding:0 10px;background:var(--surface);border-bottom:1px solid var(--outline);box-shadow:var(--shadow);
    }
    .title{font-weight:900;font-size:13px;margin-right:auto;}
    .btn{
      height:32px;padding:0 10px;border-radius:10px;cursor:pointer;user-select:none;
      border:1px solid var(--outline);background:var(--surface);color:var(--text);font-size:12px;
    }
    .btn.primary{border-color:transparent;background:var(--primary);color:#fff;}
    .btn.danger{border-color:transparent;background:var(--danger);color:#fff;}
    .btn:disabled{opacity:.5;cursor:not-allowed;}
    .panel{padding:10px;display:flex;flex-direction:column;gap:10px;border-bottom:1px solid var(--outline);background:var(--surface);}
    .row{display:flex;gap:8px;align-items:center;}
    .field{display:flex;flex-direction:column;gap:6px;flex:1;min-width:0;}
    .label{font-size:11px;color:var(--muted);}
    input{
      height:34px;border:1px solid var(--outline);border-radius:10px;padding:0 10px;font-size:13px;
      outline:none;background:#fff;color:var(--text);min-width:0;
    }
    input[readonly]{background:#f7f7f7;}
    .content{flex:1;overflow:auto;padding:10px;}
    .list{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;align-content:start;}
    .card{
      background:var(--surface);border:1px solid var(--outline);border-radius:var(--radius);
      box-shadow:var(--shadow);padding:12px;display:flex;flex-direction:column;gap:10px;
    }
    .name{font-weight:900;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .path{font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .actions{display:flex;gap:8px;margin-top:auto;}
    .empty{color:var(--muted);text-align:center;padding:26px 0;font-size:13px;}
  `

  function escapeHtml(s) {
    return String(s || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
  }

  function now() {
    return Date.now()
  }

  function isConfirmArmed(key) {
    return state.confirmKey === key && state.confirmUntil > now()
  }

  function armConfirm(key, tip) {
    state.confirmKey = key
    state.confirmUntil = now() + 2500
    api.ui.showToast(tip || '再点一次确认')
    setTimeout(() => {
      if (isConfirmArmed(key)) {
        state.confirmKey = ''
        state.confirmUntil = 0
        render()
      }
    }, 2600)
  }

  function genId() {
    return `${now()}-${Math.random().toString(16).slice(2)}`
  }

  function normalizeData(raw) {
    const d = raw && typeof raw === 'object' ? raw : null
    const items = Array.isArray(d?.items) ? d.items : []
    const out = []
    for (const it of items) {
      const id = String(it?.id || '').trim()
      const name = String(it?.name || '').trim()
      const path = String(it?.path || '').trim()
      if (!id || !path) continue
      out.push({ id, name: name || path, path })
    }
    return { schemaVersion: 1, items: out }
  }

  function basename(p) {
    const s = String(p || '').replaceAll('\\', '/').replace(/\/+$/g, '')
    const parts = s.split('/').filter(Boolean)
    return parts[parts.length - 1] || s || '未命名'
  }

  function toVscodeFileUri(path) {
    let p = String(path || '').trim()
    if (!p) return ''
    p = p.replaceAll('\\', '/').replace(/^\/+/g, '')
    return `vscode://file/${encodeURI(p)}`
  }

  async function load() {
    state.loading = true
    render()
    const raw = await api.storage.get(STORAGE_KEY).catch(() => null)
    const d = normalizeData(raw)
    state.items = d.items
    state.loading = false
    render()
  }

  async function persist() {
    await api.storage.set(STORAGE_KEY, { schemaVersion: 1, items: state.items }).catch(() => {})
  }

  async function pickDirIntoForm() {
    const dir = await api.files.pickDir().catch(() => null)
    if (!dir) return
    state.addPath = String(dir)
    if (!state.addName.trim()) state.addName = basename(dir)
    render()
  }

  async function addItem() {
    const path = String(state.addPath || '').trim()
    if (!path) {
      api.ui.showToast('请先选择目录')
      return
    }
    const name = String(state.addName || '').trim() || basename(path)
    state.items.unshift({ id: genId(), name, path })
    state.addName = ''
    state.addPath = ''
    state.addOpen = false
    await persist()
    render()
  }

  async function removeItem(id) {
    const key = `rm:${id}`
    if (!isConfirmArmed(key)) return armConfirm(key, '再点一次删除')
    state.items = state.items.filter(x => x.id !== id)
    await persist()
    render()
  }

  async function openInVscode(path) {
    const uri = toVscodeFileUri(path)
    if (!uri) return
    try {
      await api.ui.openExternal(uri)
    } catch (e) {
      api.ui.showToast(`打开失败：${String(e?.message || e || '')}`)
    }
  }

  function mount() {
    const styleEl = document.createElement('style')
    styleEl.textContent = styles
    document.head.appendChild(styleEl)
    load()
  }

  function render() {
    const el = document.getElementById('app')
    if (!el) return

    const listHtml =
      state.loading ? `<div class="empty">加载中…</div>`
      : state.items.length === 0 ? `<div class="empty">还没有收藏。点右上角“添加”。</div>`
      : `<div class="list">
          ${state.items
            .map(
              it => `<div class="card">
                <div class="name" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</div>
                <div class="path" title="${escapeHtml(it.path)}">${escapeHtml(it.path)}</div>
                <div class="actions">
                  <button class="btn primary" data-act="open" data-id="${escapeHtml(it.id)}">打开</button>
                  <button class="btn danger" data-act="rm" data-id="${escapeHtml(it.id)}">${
                    isConfirmArmed(`rm:${it.id}`) ? '确认删除' : '删除'
                  }</button>
                </div>
              </div>`,
            )
            .join('')}
        </div>`

    el.innerHTML = `
      <div class="wrap">
        <div class="topbar">
          <div class="title">VSCode 工作区</div>
          <button class="btn ${state.addOpen ? '' : 'primary'}" data-act="toggleAdd">${state.addOpen ? '收起' : '添加'}</button>
        </div>
        ${state.addOpen ? `
          <div class="panel">
            <div class="row">
              <div class="field">
                <div class="label">名称</div>
                <input data-act="name" value="${escapeHtml(state.addName)}" placeholder="例如：项目 A" />
              </div>
            </div>
            <div class="row">
              <div class="field">
                <div class="label">目录</div>
                <input readonly value="${escapeHtml(state.addPath || '')}" placeholder="请选择一个目录" />
              </div>
              <button class="btn" data-act="pick">选择…</button>
            </div>
            <div class="row">
              <button class="btn primary" data-act="add">保存</button>
            </div>
          </div>
        ` : ''}
        <div class="content">${listHtml}</div>
      </div>
    `

    el.querySelectorAll('button[data-act="open"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id') || ''
        const it = state.items.find(x => x.id === id)
        if (it) openInVscode(it.path)
      })
    })
    el.querySelectorAll('button[data-act="rm"]').forEach(btn => {
      btn.addEventListener('click', () => removeItem(btn.getAttribute('data-id') || ''))
    })
    const toggle = el.querySelector('button[data-act="toggleAdd"]')
    if (toggle) toggle.addEventListener('click', () => ((state.addOpen = !state.addOpen), render()))
    const pick = el.querySelector('button[data-act="pick"]')
    if (pick) pick.addEventListener('click', () => pickDirIntoForm())
    const add = el.querySelector('button[data-act="add"]')
    if (add) add.addEventListener('click', () => addItem())
    const nameInput = el.querySelector('input[data-act="name"]')
    if (nameInput) {
      nameInput.addEventListener('input', e => {
        state.addName = String(e?.target?.value || '')
      })
      nameInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') addItem()
      })
    }
  }

  mount()
})()

