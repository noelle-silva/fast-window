// folders (iframe sandbox) (entry: index.js)
;(function () {
  const api = window.fastWindow
  const STORAGE_KEY = 'data'
  const DEFAULT_GROUP_ID = 'default'
  const ALL_GROUP_ID = '__all__'

  const state = {
    mounted: false,
    loading: true,
    groupId: ALL_GROUP_ID,
    search: '',
    data: {
      schemaVersion: 1,
      groups: [{ id: DEFAULT_GROUP_ID, name: '默认' }],
      items: [],
    },
    modal: null, // 'add' | null
    addName: '',
    addPath: '',
    addGroupId: DEFAULT_GROUP_ID,
    newGroupName: '',
    confirmKey: '',
    confirmUntil: 0,
    ctxMenu: { open: false, id: '', x: 0, y: 0 },
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
      padding: 6px 10px;
      border-radius: 10px;
      cursor: pointer;
      font-size: 12px;
      user-select: none;
    }
    .btn.primary { border-color: transparent; background: var(--primary); color: white; }
    .btn.danger { border-color: transparent; background: var(--danger); color: white; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

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
    .tileMeta {
      font-size: 11px;
      color: var(--muted);
      width: 100%;
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-top: -4px;
    }
    .empty { color: var(--muted); text-align: center; padding: 28px 0; font-size: 13px; }

    .tile .siteIcon {
      width: 52px;
      height: 52px;
      border-radius: 999px;
      border: 1px solid var(--outline);
      background: white;
      box-shadow: 0 1px 2px rgba(0,0,0,0.08);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .fallback { font-size: 22px; line-height: 1; }

    .overlay[hidden] { display: none; }
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      z-index: 40;
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
    .modalTitle { font-weight: 900; font-size: 13px; }
    .modalBody { padding: 10px; display: flex; flex-direction: column; gap: 10px; }
    .row2 { display: flex; gap: 8px; align-items: center; }
    .grow { flex: 1; min-width: 0; }
    .help { font-size: 11px; color: var(--muted); }
    .spacer { margin-left: auto; }

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
    const groups = Array.isArray(d?.groups) ? d.groups : []
    const items = Array.isArray(d?.items) ? d.items : []

    const safeGroups = [{ id: DEFAULT_GROUP_ID, name: '默认' }]
    const seen = new Set([DEFAULT_GROUP_ID])
    for (const g of groups) {
      const id = String(g?.id || '').trim()
      const name = String(g?.name || '').trim()
      if (!id || !name) continue
      if (seen.has(id)) continue
      if (!/^[A-Za-z0-9_-]+$/.test(id)) continue
      safeGroups.push({ id, name })
      seen.add(id)
    }

    const safeItems = []
    for (const it of items) {
      const id = String(it?.id || '').trim()
      const name = String(it?.name || '').trim()
      const path = String(it?.path || '').trim()
      const groupId = String(it?.groupId || DEFAULT_GROUP_ID).trim() || DEFAULT_GROUP_ID
      const createdAtMs = typeof it?.createdAtMs === 'number' ? it.createdAtMs : now()
      if (!id || !path) continue
      safeItems.push({ id, name, path, groupId: seen.has(groupId) ? groupId : DEFAULT_GROUP_ID, createdAtMs })
    }

    return { schemaVersion: 1, groups: safeGroups, items: safeItems }
  }

  async function load() {
    state.loading = true
    render()
    const raw = await api.storage.get(STORAGE_KEY).catch(() => null)
    state.data = normalizeData(raw)
    state.loading = false
    render()
  }

  async function persist() {
    await api.storage.set(STORAGE_KEY, state.data).catch((e) => api.ui.showToast(`保存失败：${String(e?.message || e)}`))
  }

  function groupNameById(groupId) {
    const g = state.data.groups.find((x) => x.id === groupId)
    return g ? g.name : '默认'
  }

  function deriveNameFromPath(p) {
    const s = String(p || '').trim()
    if (!s) return ''
    const parts = s.replaceAll('\\', '/').split('/').filter(Boolean)
    return parts[parts.length - 1] || s
  }

  function openAddModal() {
    state.modal = 'add'
    state.addName = ''
    state.addPath = ''
    state.addGroupId = state.groupId !== ALL_GROUP_ID ? state.groupId : DEFAULT_GROUP_ID
    state.newGroupName = ''
    closeCtxMenu()
    render()
  }

  function closeModal() {
    state.modal = null
    render()
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

  async function pickDir() {
    const dir = await api.files.pickDir().catch((e) => {
      api.ui.showToast(`选择失败：${String(e?.message || e)}`)
      return null
    })
    if (!dir) return
    state.addPath = String(dir || '').trim()
    if (!state.addName) state.addName = deriveNameFromPath(state.addPath)
    render()
  }

  async function addItem() {
    const path = String(state.addPath || '').trim()
    if (!path) {
      api.ui.showToast('请先选择文件夹')
      return
    }

    let groupId = String(state.addGroupId || DEFAULT_GROUP_ID).trim() || DEFAULT_GROUP_ID
    const newGroupName = String(state.newGroupName || '').trim()
    if (newGroupName) {
      const gid = newGroupName
        .toLowerCase()
        .replaceAll(/[^a-z0-9_-]+/g, '-')
        .replaceAll(/-+/g, '-')
        .replaceAll(/^[-_]+|[-_]+$/g, '')
        .slice(0, 32)
      if (!gid) {
        api.ui.showToast('新分组名不合法')
        return
      }
      if (!state.data.groups.some((g) => g.id === gid)) {
        state.data.groups.push({ id: gid, name: newGroupName.slice(0, 40) })
      }
      groupId = gid
    }

    const nameRaw = String(state.addName || '').trim()
    const name = (nameRaw || deriveNameFromPath(path)).slice(0, 80)

    const item = { id: genId(), name, path, groupId, createdAtMs: now() }
    state.data.items = [item, ...state.data.items]
    await persist()
    api.ui.showToast('已添加')
    closeModal()
  }

  async function deleteItem(id) {
    const key = `del:${id}`
    if (!isConfirmArmed(key)) {
      armConfirm(key, '再点一次删除')
      render()
      return
    }
    state.data.items = state.data.items.filter((x) => x.id !== id)
    await persist()
    api.ui.showToast('已删除')
    render()
  }

  async function openDirById(id) {
    const it = state.data.items.find((x) => x.id === id)
    if (!it) return
    await api.files.openDir(it.path).catch((e) => api.ui.showToast(`打开失败：${String(e?.message || e)}`))
  }

  function filteredItems() {
    const q = String(state.search || '').trim().toLowerCase()
    const g = state.groupId
    return state.data.items.filter((it) => {
      if (g !== ALL_GROUP_ID && it.groupId !== g) return false
      if (!q) return true
      return String(it.name || '').toLowerCase().includes(q) || String(it.path || '').toLowerCase().includes(q)
    })
  }

  function mount() {
    if (state.mounted) return
    state.mounted = true

    const root = document.getElementById('app') || document.body
    root.innerHTML = `
      <style>${styles}</style>
      <div class="wrap">
        <div class="topbar">
          <button class="btn" data-act="back" aria-label="返回主页" title="返回主页">←</button>
          <div class="title">文件夹收藏</div>
          <button class="btn primary" data-act="add" aria-label="新增文件夹" title="新增文件夹">新增</button>
        </div>

        <div class="filters">
          <label class="field">
            <span class="label">分组</span>
            <select data-act="group" aria-label="分组筛选"></select>
          </label>
          <label class="field grow">
            <span class="label">搜索</span>
            <input data-act="search" aria-label="搜索" placeholder="按名称 / 路径搜索" />
          </label>
        </div>

        <div class="content">
          <div class="list" data-area="list"></div>
          <div class="empty" data-area="empty" style="display:none"></div>
        </div>

        <div class="overlay" data-role="overlayAdd" hidden>
          <div class="modal" role="dialog" aria-modal="true" aria-label="添加文件夹">
            <div class="modalHead">
              <div class="modalTitle">添加文件夹</div>
              <div class="spacer"></div>
              <button class="btn" data-act="closeAdd">关闭</button>
            </div>
            <div class="modalBody">
              <label class="field">
                <span class="label">名称（可选）</span>
                <input data-act="addName" placeholder="例如：项目目录" />
              </label>
              <label class="field">
                <span class="label">路径</span>
                <div class="row2">
                  <input class="grow" data-act="addPath" placeholder="请选择或粘贴绝对路径" />
                  <button class="btn" data-act="pickDir">选择…</button>
                </div>
              </label>
              <div class="row2">
                <label class="field grow">
                  <span class="label">分组</span>
                  <select data-act="addGroupId" aria-label="选择分组"></select>
                </label>
                <label class="field grow">
                  <span class="label">新分组（可选）</span>
                  <input data-act="newGroupName" placeholder="输入新分组名" />
                </label>
              </div>
              <div class="help">右键条目可打开菜单（打开/删除）。删除需要二次确认。</div>
              <div class="row2">
                <div class="spacer"></div>
                <button class="btn" data-act="closeAdd">取消</button>
                <button class="btn primary" data-act="confirmAdd">添加</button>
              </div>
            </div>
          </div>
        </div>

        <div class="ctxBackdrop" data-role="ctxBackdrop" hidden></div>
        <div class="ctxMenu" data-role="ctxMenu" hidden role="menu" aria-label="文件夹操作">
          <button class="ctxItem" data-act="ctxOpen" role="menuitem">📂 打开</button>
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
        return openDirById(id)
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
      if (act === 'add') return openAddModal()
      if (act === 'pickDir') return pickDir()
      if (act === 'confirmAdd') return addItem()
      if (act === 'closeAdd') return closeModal()

      const openEl = t.closest('[data-act="open"]')
      if (openEl instanceof HTMLElement) {
        const id = String(openEl.getAttribute('data-id') || '').trim()
        if (!id) return
        return openDirById(id)
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
      if (act === 'addName' && t instanceof HTMLInputElement) {
        state.addName = t.value
        return
      }
      if (act === 'addPath' && t instanceof HTMLInputElement) {
        state.addPath = t.value
        return
      }
      if (act === 'newGroupName' && t instanceof HTMLInputElement) {
        state.newGroupName = t.value
      }
    })

    root.addEventListener('change', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const act = t.getAttribute('data-act')

      if (act === 'group' && t instanceof HTMLSelectElement) {
        state.groupId = String(t.value || ALL_GROUP_ID)
        render()
        return
      }
      if (act === 'addGroupId' && t instanceof HTMLSelectElement) {
        state.addGroupId = String(t.value || DEFAULT_GROUP_ID)
      }
    })

    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (state.ctxMenu.open) {
          closeCtxMenu()
          renderCtxMenu()
          return
        }
        if (state.modal) return closeModal()
      }

      if (e.key === 'Enter' && state.modal === 'add') {
        const t = e.target
        if (t instanceof HTMLElement) {
          const act = t.getAttribute('data-act')
          if (act === 'addName' || act === 'addPath' || act === 'newGroupName') {
            e.preventDefault()
            return addItem()
          }
        }
        return
      }

      if (e.key !== 'Enter' || state.modal || state.ctxMenu.open) return
      const ae = document.activeElement
      const tile = ae && ae.closest ? ae.closest('[data-role="tile"]') : null
      if (tile instanceof HTMLElement) {
        const id = String(tile.getAttribute('data-id') || '').trim()
        if (!id) return
        e.preventDefault()
        openDirById(id)
      }
    })
  }

  function render() {
    mount()

    const searchEl = document.querySelector('input[data-act="search"]')
    if (searchEl instanceof HTMLInputElement) searchEl.value = state.search

    const groupSel = document.querySelector('select[data-act="group"]')
    const addGroupSel = document.querySelector('select[data-act="addGroupId"]')
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

    const overlayAdd = document.querySelector('[data-role="overlayAdd"]')
    if (overlayAdd instanceof HTMLElement) overlayAdd.hidden = state.modal !== 'add'

    const addName = document.querySelector('input[data-act="addName"]')
    const addPath = document.querySelector('input[data-act="addPath"]')
    const newGroupName = document.querySelector('input[data-act="newGroupName"]')
    if (addName instanceof HTMLInputElement) addName.value = state.addName
    if (addPath instanceof HTMLInputElement) addPath.value = state.addPath
    if (newGroupName instanceof HTMLInputElement) newGroupName.value = state.newGroupName

    const listEl = document.querySelector('[data-area="list"]')
    const emptyEl = document.querySelector('[data-area="empty"]')
    if (!(listEl instanceof HTMLElement) || !(emptyEl instanceof HTMLElement)) return

    if (state.loading) {
      listEl.innerHTML = ''
      emptyEl.style.display = 'block'
      emptyEl.textContent = '加载中...'
      renderCtxMenu()
      return
    }

    const list = filteredItems()
    if (!list.length) {
      listEl.innerHTML = ''
      emptyEl.style.display = 'block'
      emptyEl.textContent = state.search ? '未找到匹配的文件夹' : '暂无条目'
    } else {
      emptyEl.style.display = 'none'
      listEl.innerHTML = list
        .map((it) => {
          const name = it.name || deriveNameFromPath(it.path)
          const meta = state.groupId === ALL_GROUP_ID ? groupNameById(it.groupId) : ''
          return `
            <div class="tile" tabindex="0" data-role="tile" data-act="open" data-id="${escapeHtml(it.id)}" title="${escapeHtml(it.path)}" aria-label="打开文件夹：${escapeHtml(name)}">
              <div class="siteIcon" aria-hidden="true"><span class="fallback">📁</span></div>
              <div class="tileName">${escapeHtml(name)}</div>
              ${meta ? `<div class="tileMeta">${escapeHtml(meta)}</div>` : ``}
            </div>
          `
        })
        .join('')
    }

    renderCtxMenu()
  }

  load()
})()
