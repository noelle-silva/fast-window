// bookmarks v3 ui (iframe sandbox) (entry: index.js)
;(function () {
  const DEFAULT_GROUP_ID = 'default'
  const ALL_GROUP_ID = '__all__'
  const MAILBOX_DIR = '_mailbox'
  const REQUEST_DIR = `${MAILBOX_DIR}/requests`
  const RESPONSE_DIR = `${MAILBOX_DIR}/responses`
  const RESPONSE_TIMEOUT_MS = 8000
  const RESPONSE_POLL_MS = 80

  function requireV3Api(baseApi) {
    const api = baseApi || {}
    if (!api || Number(api.__meta?.apiVersion || 0) < 3) {
      throw new Error('网站收藏需要 v3 插件宿主 API')
    }
    if (!api.workspace?.fs?.writeText || !api.workspace?.fs?.readText || !api.workspace?.fs?.remove) {
      throw new Error('workspace.fs 不可用')
    }
    if (!api.process?.openExternalUrl) {
      throw new Error('process.openExternalUrl 不可用')
    }
    return api
  }

  const api = requireV3Api(window.fastWindow)

  function uid() {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function readJson(path) {
    const text = await api.workspace.fs.readText({ scope: 'data', path })
    return JSON.parse(String(text || 'null'))
  }

  async function writeJson(path, value) {
    await api.workspace.fs.writeText({ scope: 'data', path, text: JSON.stringify(value ?? null, null, 2) + '\n', overwrite: true })
  }

  async function removePath(path) {
    await api.workspace.fs.remove({ scope: 'data', path }).catch(() => {})
  }

  async function ensureMailbox() {
    await api.workspace.fs.mkdir({ scope: 'data', path: MAILBOX_DIR }).catch(() => {})
    await api.workspace.fs.mkdir({ scope: 'data', path: REQUEST_DIR }).catch(() => {})
    await api.workspace.fs.mkdir({ scope: 'data', path: RESPONSE_DIR }).catch(() => {})
  }

  async function backend(action, payload) {
    const id = uid()
    const reqPath = `${REQUEST_DIR}/${id}.json`
    const resPath = `${RESPONSE_DIR}/${id}.json`
    await ensureMailbox()
    await writeJson(reqPath, { id, action, payload: payload ?? null, createdAt: Date.now() })

    const startedAt = Date.now()
    while (Date.now() - startedAt < RESPONSE_TIMEOUT_MS) {
      try {
        const res = await readJson(resPath)
        await removePath(resPath)
        await removePath(reqPath)
        if (!res || res.ok !== true) throw new Error(String(res?.error || '后端请求失败'))
        return res.result
      } catch (e) {
        const msg = String(e?.message || e || '')
        if (!msg.includes('文件不存在') && !msg.includes('not found') && !msg.includes('No such file')) throw e
      }
      await sleep(RESPONSE_POLL_MS)
    }

    await removePath(reqPath)
    throw new Error('后端响应超时')
  }

  function showToast(message) {
    const text = String(message || '').trim()
    if (!text) return
    api.host?.toast?.(text).catch(() => {})
  }

  const state = {
    loading: true,
    groupId: ALL_GROUP_ID,
    search: '',
    data: {
      schemaVersion: 1,
      groups: [],
      items: [],
    },
    modal: null,
    editId: '',
    addTitle: '',
    addUrl: '',
    addGroupId: DEFAULT_GROUP_ID,
    addIconUrl: '',
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
    .btn[disabled] { opacity: 0.55; cursor: not-allowed; }
    .filters { display: flex; gap: 10px; padding: 10px; flex-shrink: 0; }
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
    .list { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 12px; align-content: start; }
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
    .tile:focus { outline: 2px solid rgba(25,118,210,0.28); outline-offset: 2px; }
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
    .siteIcon {
      width: 52px;
      height: 52px;
      border-radius: 999px;
      border: 1px solid var(--outline);
      background: white;
      box-shadow: 0 1px 2px rgba(0,0,0,0.08);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      flex-shrink: 0;
    }
    .siteIcon.small { width: 24px; height: 24px; border-radius: 6px; }
    .siteIcon img { width: 100%; height: 100%; display: block; }
    .siteIcon.ok .fallback { display: none; }
    .siteIcon.err img { display: none; }
    .fallback { font-size: 22px; color: var(--muted); line-height: 1; }
    .siteIcon.small .fallback { font-size: 13px; }
    .overlay[hidden], .ctxBackdrop[hidden], .ctxMenu[hidden] { display: none; }
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
    .modalTitle { font-size: 13px; font-weight: 800; margin-right: auto; }
    .modalBody { padding: 10px; display: flex; flex-direction: column; gap: 10px; }
    .row { display: flex; gap: 10px; align-items: center; }
    .row.grow { align-items: stretch; }
    .row .grow { flex: 1; min-width: 0; }
    .help { font-size: 12px; color: var(--muted); }
    .groupRow { display: flex; gap: 8px; align-items: center; padding: 8px; border: 1px solid var(--outline); border-radius: 12px; background: white; }
    .groupRow input { flex: 1; }
    .iconLine { display: flex; align-items: center; gap: 10px; }
    .ctxBackdrop { position: fixed; inset: 0; background: transparent; z-index: 50; }
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

  function findItem(id) {
    return state.data.items.find((x) => x.id === id) || null
  }

  function getVisibleItems() {
    const q = String(state.search || '').trim().toLowerCase()
    const gid = state.groupId
    return state.data.items.filter((x) => {
      if (gid !== ALL_GROUP_ID && x.groupId !== gid) return false
      if (!q) return true
      return String(x.title || '').toLowerCase().includes(q) || String(x.url || '').toLowerCase().includes(q)
    })
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
    showToast(message || '再点一次确认')
    return false
  }

  async function load() {
    state.data = await backend('list', {})
    if (!state.data.groups.some((x) => x.id === state.addGroupId)) state.addGroupId = DEFAULT_GROUP_ID
    state.loading = false
  }

  async function reloadAndRender() {
    await load()
    render()
  }

  function openModal(kind) {
    state.modal = kind
    if (kind === 'add') {
      state.editId = ''
      state.addTitle = ''
      state.addUrl = ''
      state.addGroupId = state.groupId === ALL_GROUP_ID ? DEFAULT_GROUP_ID : state.groupId
      state.addIconUrl = ''
    }
    if (kind === 'groups') {
      state.newGroupName = ''
      state.groupNameEdits = {}
    }
    render()
  }

  function openEditModal(id) {
    const item = findItem(id)
    if (!item) {
      showToast('条目不存在')
      return
    }
    state.modal = 'add'
    state.editId = id
    state.addTitle = String(item.title || '')
    state.addUrl = String(item.url || '')
    state.addGroupId = state.data.groups.some((g) => g.id === item.groupId) ? String(item.groupId) : DEFAULT_GROUP_ID
    state.addIconUrl = String(item.iconUrl || '')
    closeCtxMenu()
    render()

    const titleEl = document.querySelector('input[data-act="addTitle"]')
    if (titleEl instanceof HTMLInputElement) {
      titleEl.focus()
      titleEl.select()
    }
  }

  function closeModal() {
    state.modal = null
    state.editId = ''
    render()
  }

  async function saveBookmarkFromModal() {
    const payload = {
      id: String(state.editId || '').trim(),
      title: state.addTitle,
      url: state.addUrl,
      groupId: state.addGroupId,
      iconUrl: state.addIconUrl,
    }
    try {
      state.data = await backend(payload.id ? 'updateBookmark' : 'addBookmark', payload)
      showToast(payload.id ? '已保存' : '已添加')
      closeModal()
    } catch (e) {
      showToast(String(e?.message || e || '保存失败'))
    }
  }

  async function deleteBookmark(id) {
    try {
      state.data = await backend('deleteBookmark', { id })
      showToast('已删除')
      render()
    } catch (e) {
      showToast(String(e?.message || e || '删除失败'))
    }
  }

  async function openBookmark(id) {
    const item = findItem(id)
    if (!item) return
    try {
      const result = await backend('openBookmark', { id })
      const url = String(result?.url || '').trim()
      if (!url) throw new Error('URL 不合法')
      await api.process.openExternalUrl({ url })
      state.data = result.data
      render()
    } catch (e) {
      showToast(String(e?.message || e || '打开失败'))
    }
  }

  async function refreshIconForItem(id) {
    try {
      state.data = await backend('refreshIcon', { id })
      showToast('已刷新图标地址')
      render()
    } catch (e) {
      showToast(String(e?.message || e || '刷新失败'))
    }
  }

  async function sniffAddIcon() {
    try {
      const res = await backend('inferIcon', { url: state.addUrl })
      state.addIconUrl = String(res?.iconUrl || '')
      showToast(state.addIconUrl ? '已推断图标地址' : '未找到图标')
      render()
    } catch (e) {
      showToast(String(e?.message || e || '图标推断失败'))
    }
  }

  async function addGroup() {
    const name = String(state.newGroupName || '').trim()
    if (!name) return
    try {
      state.data = await backend('addGroup', { name })
      state.newGroupName = ''
      render()
    } catch (e) {
      showToast(String(e?.message || e || '添加失败'))
    }
  }

  async function renameGroup(groupId) {
    const name = String(state.groupNameEdits[groupId] ?? '').trim()
    if (!name) return
    try {
      state.data = await backend('renameGroup', { groupId, name })
      showToast('已保存')
      render()
    } catch (e) {
      showToast(String(e?.message || e || '保存失败'))
    }
  }

  async function deleteGroup(groupId) {
    if (groupId === DEFAULT_GROUP_ID) return
    if (!confirmOnce(`delGroup:${groupId}`, '再点一次删除分组（收藏会移到「默认」）')) return
    try {
      state.data = await backend('deleteGroup', { groupId })
      if (state.groupId === groupId) state.groupId = ALL_GROUP_ID
      showToast('已删除')
      render()
    } catch (e) {
      showToast(String(e?.message || e || '删除失败'))
    }
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
          <div class="modal" data-role="addModal" role="dialog" aria-modal="true" aria-label="新增收藏">
            <div class="modalHead">
              <div class="modalTitle" data-role="addModalTitle">新增收藏</div>
              <button class="btn" data-act="closeAdd">关闭</button>
            </div>
            <div class="modalBody">
              <label class="field"><span class="label">标题（可选）</span><input data-act="addTitle" placeholder="例如：GitHub" /></label>
              <label class="field"><span class="label">URL</span><input data-act="addUrl" placeholder="https://example.com（可省略协议）" /></label>
              <div class="row">
                <div class="iconLine">
                  <div class="siteIcon small" data-role="addIconWrap"><span class="fallback">🌐</span><img data-role="addIconImg" alt="网站图标" /></div>
                  <div class="help">v3 模式下由后端推断 favicon 地址</div>
                </div>
                <div class="spacer"></div>
                <button class="btn" data-act="sniffAddIcon">推断图标</button>
                <button class="btn" data-act="clearAddIcon">清除</button>
              </div>
              <label class="field"><span class="label">分组</span><select data-act="addGroup" aria-label="选择分组"></select></label>
              <div class="row">
                <div class="help">仅支持 http(s)://</div>
                <div class="spacer"></div>
                <button class="btn" data-act="closeAdd">取消</button>
                <button class="btn primary" data-role="addConfirmBtn" data-act="confirmAdd">添加</button>
              </div>
            </div>
          </div>
        </div>
        <div class="overlay" data-role="overlayGroups" hidden>
          <div class="modal" role="dialog" aria-modal="true" aria-label="分组管理">
            <div class="modalHead"><div class="modalTitle">分组管理</div><button class="btn" data-act="closeGroups">关闭</button></div>
            <div class="modalBody">
              <div class="help">删除分组会把收藏移动到「默认」</div>
              <div data-area="groupsList"></div>
              <div class="row grow"><input class="grow" data-act="newGroupName" placeholder="新分组名" /><button class="btn primary" data-act="addGroup">添加</button></div>
            </div>
          </div>
        </div>
        <div class="ctxBackdrop" data-role="ctxBackdrop" hidden></div>
        <div class="ctxMenu" data-role="ctxMenu" hidden role="menu" aria-label="收藏操作">
          <button class="ctxItem" data-act="ctxOpen" role="menuitem">↗ 打开</button>
          <button class="ctxItem" data-act="ctxEdit" role="menuitem">✎ 编辑</button>
          <button class="ctxItem" data-act="ctxSniff" role="menuitem">⟳ 刷新图标</button>
          <div class="ctxSep" role="separator"></div>
          <button class="ctxItem danger" data-act="ctxDelete" role="menuitem">删除</button>
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
        api.host?.startDragging?.().catch(() => {})
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
        if (id) return openBookmark(id)
      }
      if (act === 'ctxEdit') {
        const id = String(state.ctxMenu.id || '').trim()
        closeCtxMenu()
        renderCtxMenu()
        if (id) return openEditModal(id)
      }
      if (act === 'ctxSniff') {
        const id = String(state.ctxMenu.id || '').trim()
        closeCtxMenu()
        renderCtxMenu()
        if (id) return refreshIconForItem(id)
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

      if (act === 'back') return api.host?.back?.()
      if (act === 'add') return openModal('add')
      if (act === 'groups') return openModal('groups')
      if (act === 'closeAdd' || act === 'closeGroups') return closeModal()
      if (act === 'confirmAdd') return saveBookmarkFromModal()
      if (act === 'sniffAddIcon') return sniffAddIcon()
      if (act === 'clearAddIcon') {
        state.addIconUrl = ''
        render()
        return
      }
      if (act === 'addGroup') return addGroup()
      if (act === 'saveGroup') return renameGroup(String(t.getAttribute('data-id') || ''))
      if (act === 'delGroup') return deleteGroup(String(t.getAttribute('data-id') || ''))

      const openEl = t.closest('[data-act="open"]')
      if (openEl instanceof HTMLElement) {
        const id = String(openEl.getAttribute('data-id') || '')
        if (id) return openBookmark(id)
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
      if (act === 'addTitle' && t instanceof HTMLInputElement) state.addTitle = t.value
      if (act === 'addUrl' && t instanceof HTMLInputElement) state.addUrl = t.value
      if (act === 'newGroupName' && t instanceof HTMLInputElement) state.newGroupName = t.value
      if (act === 'groupName' && t instanceof HTMLInputElement) {
        const gid = String(t.getAttribute('data-id') || '')
        if (gid) state.groupNameEdits[gid] = t.value
      }
    })

    root.addEventListener('change', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const act = t.getAttribute('data-act')
      if (act === 'group' && t instanceof HTMLSelectElement) {
        state.groupId = t.value || ALL_GROUP_ID
        render()
      }
      if (act === 'addGroup' && t instanceof HTMLSelectElement) state.addGroupId = t.value || DEFAULT_GROUP_ID
    })

    root.addEventListener('load', (e) => {
      const t = e.target
      if (!(t instanceof HTMLImageElement)) return
      const wrap = t.closest('.siteIcon')
      if (wrap instanceof HTMLElement) {
        wrap.classList.add('ok')
        wrap.classList.remove('err')
      }
    }, true)

    root.addEventListener('error', (e) => {
      const t = e.target
      if (!(t instanceof HTMLImageElement)) return
      const wrap = t.closest('.siteIcon')
      if (wrap instanceof HTMLElement) {
        wrap.classList.add('err')
        wrap.classList.remove('ok')
      }
    }, true)

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
        const tile = ae instanceof HTMLElement ? ae.closest('[data-role="tile"]') : null
        if (tile instanceof HTMLElement) {
          const id = String(tile.getAttribute('data-id') || '').trim()
          if (id) return openBookmark(id)
        }
      }
    })

    root.addEventListener('scroll', () => {
      if (!state.ctxMenu.open) return
      closeCtxMenu()
      renderCtxMenu()
    }, true)
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
      const opts = [{ id: ALL_GROUP_ID, name: '全部' }, ...state.data.groups]
      groupSel.innerHTML = opts.map((x) => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)}</option>`).join('')
      groupSel.value = state.groupId || ALL_GROUP_ID
    }
    if (addGroupSel instanceof HTMLSelectElement) {
      addGroupSel.innerHTML = state.data.groups.map((x) => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)}</option>`).join('')
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
      listEl.innerHTML = items.map((x) => {
        const icon = String(x.iconUrl || '').trim()
        const iconImg = icon ? `<img alt="网站图标" loading="lazy" referrerpolicy="no-referrer" src="${escapeHtml(icon)}" />` : `<img alt="网站图标" loading="lazy" referrerpolicy="no-referrer" />`
        return `
          <div class="tile" tabindex="0" data-role="tile" data-act="open" data-id="${escapeHtml(x.id)}" title="${escapeHtml(x.url)}">
            <div class="siteIcon" aria-hidden="true"><span class="fallback">🌐</span>${iconImg}</div>
            <div class="tileName">${escapeHtml(x.title || x.url)}</div>
          </div>
        `
      }).join('')
    }

    renderCtxMenu()

    const groupsList = document.querySelector('[data-area="groupsList"]')
    if (groupsList instanceof HTMLElement) {
      groupsList.innerHTML = state.data.groups.slice().sort((a, b) => a.createdAt - b.createdAt).map((g) => {
        const val = state.groupNameEdits[g.id]
        const name = typeof val === 'string' ? val : g.name
        const canDel = g.id !== DEFAULT_GROUP_ID
        return `
          <div class="groupRow">
            <input data-act="groupName" data-id="${escapeHtml(g.id)}" value="${escapeHtml(name)}" aria-label="分组名" />
            <button class="btn" data-act="saveGroup" data-id="${escapeHtml(g.id)}">保存</button>
            ${canDel ? `<button class="btn danger" data-act="delGroup" data-id="${escapeHtml(g.id)}">删除</button>` : `<button class="btn" disabled title="默认分组不可删除">锁定</button>`}
          </div>
        `
      }).join('')
    }

    const addTitle = document.querySelector('input[data-act="addTitle"]')
    const addUrl = document.querySelector('input[data-act="addUrl"]')
    const newGroupName = document.querySelector('input[data-act="newGroupName"]')
    if (addTitle instanceof HTMLInputElement) addTitle.value = state.addTitle
    if (addUrl instanceof HTMLInputElement) addUrl.value = state.addUrl
    if (newGroupName instanceof HTMLInputElement) newGroupName.value = state.newGroupName

    const isEdit = !!String(state.editId || '').trim()
    const addModal = document.querySelector('[data-role="addModal"]')
    const addModalTitle = document.querySelector('[data-role="addModalTitle"]')
    const addConfirmBtn = document.querySelector('[data-role="addConfirmBtn"]')
    if (addModal instanceof HTMLElement) addModal.setAttribute('aria-label', isEdit ? '编辑收藏' : '新增收藏')
    if (addModalTitle instanceof HTMLElement) addModalTitle.textContent = isEdit ? '编辑收藏' : '新增收藏'
    if (addConfirmBtn instanceof HTMLButtonElement) addConfirmBtn.textContent = isEdit ? '保存' : '添加'

    const addIconImg = document.querySelector('img[data-role="addIconImg"]')
    if (addIconImg instanceof HTMLImageElement) {
      addIconImg.setAttribute('referrerpolicy', 'no-referrer')
      const icon = String(state.addIconUrl || '').trim()
      const wrap = addIconImg.closest('.siteIcon')
      if (icon) {
        addIconImg.src = icon
        if (wrap instanceof HTMLElement) wrap.classList.remove('err')
      } else {
        addIconImg.removeAttribute('src')
        if (wrap instanceof HTMLElement) {
          wrap.classList.remove('ok')
          wrap.classList.remove('err')
        }
      }
    }
  }

  async function init() {
    mount()
    render()
    try {
      await reloadAndRender()
    } catch (e) {
      state.loading = false
      render()
      showToast(String(e?.message || e || '加载失败'))
    }
  }

  init()
})()
