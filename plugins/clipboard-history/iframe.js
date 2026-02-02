// clipboard-history (iframe sandbox)
;(function () {
  const api = window.fastWindow

  const STORAGE_KEY = 'history'
  const SETTINGS_KEY = 'settings'
  const COLLECTIONS_KEY = 'collections'
  const RECENT_FOLDERS_KEY = 'recentFolders'

  const DEFAULT_SETTINGS = {
    maxHistory: 50,
    autoMonitor: true,
    pollInterval: 1000,
  }

  const state = {
    history: [],
    settings: { ...DEFAULT_SETTINGS },
    showSettings: false,

    view: 'clipboard', // 'clipboard' | 'folders'

    clipboardSearchQuery: '',

    collections: null,
    currentFolderId: 'root',
    folderSearchQuery: '',
    folderSearchScope: 'current', // 'current' | 'global'
    recentFolders: [],
    showRecentMenu: false,
    showMoreMenu: false,
    clearArmedAt: 0,

    showItemEditor: false,
    draftTitle: '',
    draftContent: '',

    showFolderEditor: false,
    draftFolderName: '',

    deleteArmedId: '',
    deleteArmedAt: 0,

    navBack: [],
    navForward: [],

    currentText: '',
    currentImage: '',
    internalCopy: { type: '', content: '', at: 0 },

    timer: null,
  }

  const styles = `
    :root {
      --bg: #FAFAFA;
      --surface: #FFFFFF;
      --text: #212121;
      --muted: #757575;
      --primary: #1976D2;
      --outline: #E0E0E0;
      --danger: #D32F2F;
      --shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);
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
      position: relative;
    }
    .dropdown { position: relative; }
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
    .btn:focus-visible { outline: 2px solid rgba(25,118,210,0.45); outline-offset: 1px; }
    .btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .title { font-weight: 700; font-size: 13px; margin-right: auto; }
    .search {
      width: 260px;
      max-width: 45vw;
      height: 30px;
      padding: 0 10px;
      border: 1px solid var(--outline);
      border-radius: 8px;
      outline: none;
      font-size: 12px;
      background: white;
    }
    .search:focus-visible { outline: 2px solid rgba(25,118,210,0.45); outline-offset: 1px; }
    .content { flex: 1; overflow: auto; padding: 10px; }
    .list {
      display: flex;
      flex-direction: column;
      gap: 0;
      background: var(--surface);
      border: 1px solid var(--outline);
      border-radius: 12px;
      overflow: hidden;
    }
    .card {
      background: transparent;
      border: none;
      border-radius: 0;
      padding: 10px 12px;
      cursor: pointer;
      position: relative;
    }
    .card + .card { border-top: 1px solid var(--outline); }
    .card:hover { background: rgba(0,0,0,0.03); }
    .cardTop { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .pill { font-size: 11px; color: var(--muted); border: 1px solid var(--outline); padding: 2px 8px; border-radius: 999px; }
    .spacer { margin-left: auto; }
    .iconBtn {
      border: 1px solid transparent;
      background: transparent;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      line-height: 26px;
      text-align: center;
      color: var(--muted);
    }
    .card:hover .iconBtn { border-color: var(--outline); background: white; }
    .iconBtn:hover { border-color: #CFCFCF; background: white; }
    .iconBtn:focus-visible { outline: 2px solid rgba(25,118,210,0.45); outline-offset: 1px; }
    .text { white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.55; }
    .imgWrap { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; }
    .img { display: block; max-width: 100%; max-height: 220px; object-fit: contain; border-radius: 10px; }
    .empty { color: var(--muted); text-align: center; padding: 24px 0; font-size: 13px; }
    .settings { border: 1px dashed var(--outline); background: var(--surface); border-radius: 12px; padding: 10px; margin-bottom: 10px; }
    .row { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
    .row label { width: 120px; color: var(--muted); font-size: 12px; }
    .row input[type="number"] { width: 120px; height: 30px; border: 1px solid var(--outline); border-radius: 8px; padding: 0 8px; }

    .subbar {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
      background: var(--surface);
      border: 1px solid var(--outline);
      border-radius: 12px;
      padding: 10px;
      box-shadow: var(--shadow);
      flex-wrap: wrap;
    }
    .crumbs { font-size: 12px; color: var(--muted); display: flex; gap: 6px; flex-wrap: wrap; }
    .crumb { cursor: pointer; border: 1px solid var(--outline); padding: 2px 8px; border-radius: 999px; background: white; }
    .crumb:hover { background: rgba(0,0,0,0.03); }
    .editor {
      background: var(--surface);
      border: 1px solid var(--outline);
      border-radius: 12px;
      padding: 10px;
      box-shadow: var(--shadow);
      margin-bottom: 10px;
    }
    .fieldRow { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .input {
      height: 30px;
      border: 1px solid var(--outline);
      border-radius: 8px;
      padding: 0 8px;
      outline: none;
      font-size: 12px;
      background: white;
      color: var(--text);
      flex: 1;
      min-width: 180px;
    }
    .input:focus-visible { outline: 2px solid rgba(25,118,210,0.45); outline-offset: 1px; }
    .textarea {
      width: 100%;
      min-height: 92px;
      border: 1px solid var(--outline);
      border-radius: 10px;
      padding: 10px;
      font-size: 13px;
      line-height: 1.5;
      outline: none;
      resize: vertical;
      background: white;
      color: var(--text);
      margin-top: 10px;
    }
    .textarea:focus-visible { outline: 2px solid rgba(25,118,210,0.45); outline-offset: 1px; }
    .hint { margin-top: 8px; font-size: 12px; color: var(--muted); display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }

    .folderCardTitle { display: flex; align-items: center; gap: 8px; }
    .folderName { font-weight: 700; font-size: 13px; color: var(--text); }
    .dragHandle {
      width: 26px;
      height: 26px;
      border-radius: 8px;
      border: 1px solid var(--outline);
      background: white;
      color: var(--muted);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
      flex-shrink: 0;
    }
    .menu {
      position: absolute;
      top: 36px;
      right: 0;
      background: var(--surface);
      border: 1px solid var(--outline);
      border-radius: 12px;
      box-shadow: var(--shadow);
      overflow: hidden;
      min-width: 260px;
      z-index: 20;
      display: none;
    }
    .menu.open { display: block; }
    .menuItem {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 10px 12px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 12px;
      text-align: left;
      color: var(--text);
    }
    .menuItem:hover { background: rgba(0,0,0,0.03); }
    .menuHeader { padding: 10px 12px; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--outline); }

    .placeholder {
      border: 2px dashed rgba(25,118,210,0.45);
      background: rgba(25,118,210,0.06);
      border-radius: 12px;
      margin: 0;
    }
    .ghost {
      position: fixed;
      left: 0;
      top: 0;
      pointer-events: none;
      z-index: 50;
      opacity: 0.92;
      transform: translate(-9999px, -9999px);
    }
  `

  function internalWindowMs() {
    return Math.max(1500, state.settings.pollInterval * 2)
  }

  function now() {
    return Date.now()
  }

  function setInternalCopy(type, content) {
    state.internalCopy = { type, content, at: now() }
  }

  function clearInternalCopy() {
    state.internalCopy = { type: '', content: '', at: 0 }
  }

  function withinInternalWindow() {
    return state.internalCopy.at && (now() - state.internalCopy.at) < internalWindowMs()
  }

  function upsertHistoryItem(item) {
    state.history = [item, ...state.history.filter((it) => !(it.type === item.type && it.content === item.content))]
      .slice(0, state.settings.maxHistory)
  }

  function replaceInternalImageIfNeeded(internalContent, newContent) {
    if (!internalContent || internalContent === newContent) return
    const item = { type: 'image', content: newContent, time: now() }
    state.history = [item, ...state.history.filter((it) => !(it.type === 'image' && (it.content === internalContent || it.content === newContent)))]
      .slice(0, state.settings.maxHistory)
  }

  function handleClipboardChange(type, content) {
    if (!content) return

    // 内部复制产生的剪贴板变化：不要再新增记录（避免重复）；图片可能被重编码，做一次替换
    if (withinInternalWindow() && state.internalCopy.type === type) {
      const internalContent = state.internalCopy.content
      clearInternalCopy()
      if (type === 'text') {
        state.currentText = content
        return
      }
      if (type === 'image') {
        replaceInternalImageIfNeeded(internalContent, content)
        state.currentImage = content
        return
      }
    }

    // 过期就清
    if (state.internalCopy.at && !withinInternalWindow()) clearInternalCopy()

    if (type === 'text') {
      if (content === state.currentText) return
      state.currentText = content
      upsertHistoryItem({ type: 'text', content, time: now() })
      return
    }

    if (type === 'image') {
      if (content === state.currentImage) return
      state.currentImage = content
      upsertHistoryItem({ type: 'image', content, time: now() })
      return
    }
  }

  async function persistClipboard() {
    try {
      await api.storage.set(STORAGE_KEY, state.history)
      await api.storage.set(SETTINGS_KEY, state.settings)
    } catch (e) {}
  }

  async function persistCollections() {
    try {
      if (state.collections) await api.storage.set(COLLECTIONS_KEY, state.collections)
      await api.storage.set(RECENT_FOLDERS_KEY, state.recentFolders)
    } catch (e) {}
  }

  function makeId() {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  function ensureCollections(saved) {
    const rootId = 'root'
    const empty = {
      version: 1,
      rootId,
      nodes: {
        [rootId]: { id: rootId, type: 'folder', name: '收藏夹', children: [], createdAt: now(), updatedAt: now() },
      },
    }
    if (!saved || typeof saved !== 'object') return empty
    if (!saved.nodes || typeof saved.nodes !== 'object') return empty
    if (!saved.rootId || !saved.nodes[saved.rootId]) return empty
    const root = saved.nodes[saved.rootId]
    if (!root || root.type !== 'folder' || !Array.isArray(root.children)) return empty
    return { ...empty, ...saved }
  }

  function getNode(id) {
    return state.collections?.nodes?.[id] || null
  }

  function isFolder(id) {
    const n = getNode(id)
    return !!n && n.type === 'folder'
  }

  function buildParentMap() {
    const map = new Map()
    const nodes = state.collections?.nodes || {}
    for (const id of Object.keys(nodes)) {
      const n = nodes[id]
      if (!n || n.type !== 'folder' || !Array.isArray(n.children)) continue
      for (const childId of n.children) map.set(childId, id)
    }
    return map
  }

  function buildPathIds(folderId) {
    const rootId = state.collections?.rootId || 'root'
    const parent = buildParentMap()
    const path = []
    let cur = folderId
    while (cur) {
      path.push(cur)
      if (cur === rootId) break
      cur = parent.get(cur)
    }
    return path.reverse()
  }

  function folderLabelById(folderId) {
    const path = buildPathIds(folderId)
    const parts = path
      .map((id) => getNode(id))
      .filter(Boolean)
      .map((n) => (n && n.type === 'folder' ? n.name : ''))
      .filter(Boolean)
    return parts.join(' / ') || '收藏夹'
  }

  function touchRecentFolder(folderId) {
    if (!folderId || !isFolder(folderId)) return
    state.recentFolders = [folderId, ...state.recentFolders.filter((id) => id !== folderId)].slice(0, 10)
    persistCollections()
  }

  function openFolder(folderId) {
    if (!folderId || !isFolder(folderId)) return
    state.currentFolderId = folderId
    touchRecentFolder(folderId)
    render()
  }

  function navigateFolder(folderId) {
    if (!folderId || !isFolder(folderId)) return
    if (folderId === state.currentFolderId) return
    state.navBack = [...state.navBack, state.currentFolderId].slice(-50)
    state.navForward = []
    openFolder(folderId)
  }

  function navigateBack() {
    const prev = state.navBack[state.navBack.length - 1]
    if (!prev || !isFolder(prev)) return
    state.navBack = state.navBack.slice(0, -1)
    state.navForward = [state.currentFolderId, ...state.navForward].slice(0, 50)
    openFolder(prev)
  }

  function navigateForward() {
    const next = state.navForward[0]
    if (!next || !isFolder(next)) return
    state.navForward = state.navForward.slice(1)
    state.navBack = [...state.navBack, state.currentFolderId].slice(-50)
    openFolder(next)
  }

  function isDeleteArmed(nodeId) {
    return state.deleteArmedId === nodeId && state.deleteArmedAt && (now() - state.deleteArmedAt) < 2500
  }

  function refreshListsOnly() {
    if (state.view === 'clipboard') {
      renderClipboardList()
      return
    }
    renderFolderList()
  }

  function armDelete(nodeId) {
    state.deleteArmedId = nodeId
    state.deleteArmedAt = now()
    setTimeout(() => {
      if (isDeleteArmed(nodeId)) {
        state.deleteArmedId = ''
        state.deleteArmedAt = 0
        refreshListsOnly()
      }
    }, 2600)
  }

  function hash32Sampled(s) {
    const str = String(s || '')
    const n = str.length
    const sample = n > 4096 ? (str.slice(0, 2048) + str.slice(-2048)) : str
    let h = 5381
    for (let i = 0; i < sample.length; i++) {
      h = ((h << 5) + h) ^ sample.charCodeAt(i)
    }
    return (h >>> 0).toString(16).padStart(8, '0')
  }

  function historyKey(item) {
    const type = item && item.type ? String(item.type) : 'text'
    const content = item && item.content ? String(item.content) : ''
    return `hist:${type}:${hash32Sampled(content)}`
  }

  function canMoveInto(targetFolderId, movingId) {
    if (!isFolder(targetFolderId)) return false
    if (targetFolderId === movingId) return false
    const parent = buildParentMap()
    let cur = targetFolderId
    while (cur) {
      if (cur === movingId) return false
      cur = parent.get(cur)
    }
    return true
  }

  function removeChild(parentId, childId) {
    const p = getNode(parentId)
    if (!p || p.type !== 'folder') return
    p.children = (p.children || []).filter((id) => id !== childId)
    p.updatedAt = now()
  }

  function insertChild(parentId, childId, index) {
    const p = getNode(parentId)
    if (!p || p.type !== 'folder') return
    const next = (p.children || []).filter((id) => id !== childId)
    const at = Math.max(0, Math.min(next.length, Number.isFinite(index) ? index : next.length))
    next.splice(at, 0, childId)
    p.children = next
    p.updatedAt = now()
  }

  function findParentId(childId) {
    return buildParentMap().get(childId) || null
  }

  function moveNode(movingId, toParentId, toIndex) {
    if (!state.collections) return false
    if (!canMoveInto(toParentId, movingId)) return false
    const fromParentId = findParentId(movingId)
    if (!fromParentId) return false
    removeChild(fromParentId, movingId)
    insertChild(toParentId, movingId, toIndex)
    persistCollections()
    return true
  }

  function deleteNodeRecursive(nodeId) {
    const n = getNode(nodeId)
    if (!n) return
    if (n.type === 'folder') {
      for (const childId of [...(n.children || [])]) deleteNodeRecursive(childId)
    }
    delete state.collections.nodes[nodeId]
  }

  function deleteNode(nodeId) {
    if (!nodeId || nodeId === state.collections?.rootId) return
    const parentId = findParentId(nodeId)
    if (parentId) removeChild(parentId, nodeId)
    deleteNodeRecursive(nodeId)
    persistCollections()
  }

  function createFolder(parentId, name) {
    if (!state.collections) return ''
    if (!isFolder(parentId)) return ''
    const folderId = makeId()
    const safeName = (name || '').trim() || '未命名收藏夹'
    state.collections.nodes[folderId] = { id: folderId, type: 'folder', name: safeName, children: [], createdAt: now(), updatedAt: now() }
    insertChild(parentId, folderId)
    persistCollections()
    return folderId
  }

  function createItem(parentId, title, content) {
    if (!state.collections) return ''
    if (!isFolder(parentId)) return ''
    const safeContent = (content || '').trim()
    if (!safeContent) return ''
    const itemId = makeId()
    const safeTitle = (title || '').trim() || safeContent.split(/\r?\n/)[0].slice(0, 24) || '未命名条目'
    state.collections.nodes[itemId] = { id: itemId, type: 'item', title: safeTitle, content: safeContent, createdAt: now(), updatedAt: now() }
    insertChild(parentId, itemId)
    persistCollections()
    return itemId
  }

  function listChildren(folderId) {
    const f = getNode(folderId)
    if (!f || f.type !== 'folder') return []
    return (f.children || []).map((id) => getNode(id)).filter(Boolean)
  }

  function traverseItemsUnder(folderId) {
    const res = []
    const stack = [folderId]
    while (stack.length) {
      const id = stack.pop()
      const n = getNode(id)
      if (!n) continue
      if (n.type === 'item') {
        res.push(n)
        continue
      }
      if (n.type === 'folder') {
        for (const childId of [...(n.children || [])].reverse()) stack.push(childId)
      }
    }
    return res
  }

  function searchItems(query, scope) {
    const q = (query || '').trim().toLowerCase()
    if (!q) return []
    const parent = buildParentMap()
    const baseId = scope === 'global' ? (state.collections?.rootId || 'root') : state.currentFolderId
    const items = traverseItemsUnder(baseId).filter((it) => {
      const c = String(it.content || '').toLowerCase()
      const t = String(it.title || '').toLowerCase()
      return c.includes(q) || t.includes(q)
    })
    return items.map((it) => {
      const folderId = parent.get(it.id) || (state.collections?.rootId || 'root')
      const path = buildPathIds(folderId)
        .map((id) => getNode(id))
        .filter(Boolean)
        .map((n) => (n.type === 'folder' ? n.name : ''))
        .filter(Boolean)
        .join(' / ')
      return { item: it, folderId, path }
    })
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;')
  }

  function formatTime(ts) {
    try {
      const d = new Date(ts)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    } catch {
      return ''
    }
  }

  function mount() {
    const root = document.getElementById('app') || document.body

    const drag = {
      active: false,
      id: '',
      originEl: null,
      listEl: null,
      placeholder: null,
      ghost: null,
      lastX: 0,
      lastY: 0,
      lastReorderAt: 0,
    }

    root.innerHTML = `
      <style>${styles}</style>
      <div class="wrap">
        <div class="topbar" data-area="topbar"></div>
        <div class="content">
          <div data-page="clipboard" data-area="clipboardPage">
            <div class="settings" data-area="settings" style="display:none"></div>
            <div class="list" data-area="clipboardList"></div>
            <div class="empty" data-area="clipboardEmpty" style="display:none"></div>
          </div>
          <div data-page="folders" data-area="foldersPage" style="display:none">
            <div class="subbar" data-area="foldersSubbar"></div>
            <div class="editor" data-area="itemEditor" style="display:none"></div>
            <div class="list" data-area="folderList"></div>
            <div class="empty" data-area="folderEmpty" style="display:none"></div>
          </div>
        </div>
      </div>
    `

    root.addEventListener('click', async (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return

      const act = t.getAttribute('data-act')
      if (act === 'back') {
        api.ui?.back ? api.ui.back() : api.ui?.showToast?.('无法返回')
        return
      }
      if (act === 'openFolders') {
        state.view = 'folders'
        state.showSettings = false
        state.showRecentMenu = false
        render()
        return
      }
      if (act === 'openClipboard') {
        state.view = 'clipboard'
        state.showSettings = false
        state.showRecentMenu = false
        render()
        return
      }
      if (act === 'toggleRecent') {
        state.showRecentMenu = !state.showRecentMenu
        render()
        return
      }
      if (act === 'toggleMore') {
        state.showMoreMenu = !state.showMoreMenu
        render()
        return
      }
      if (act === 'openRecentFolder') {
        const folderId = t.getAttribute('data-id') || ''
        state.view = 'folders'
        state.showRecentMenu = false
        openFolder(folderId)
        return
      }
      if (act === 'toggleSettings') {
        state.showSettings = !state.showSettings
        state.showMoreMenu = false
        render()
        return
      }
      if (act === 'clearHistory') {
        state.showMoreMenu = false
        const armed = state.clearArmedAt && (now() - state.clearArmedAt) < 2500
        if (!armed) {
          state.clearArmedAt = now()
          api.ui?.showToast?.('再点一次清空')
          renderTopbar()
          return
        }
        state.clearArmedAt = 0
        state.history = []
        await persistClipboard()
        api.ui?.showToast?.('已清空')
        render()
        return
      }

      if (act === 'toggleFolderEditor') {
        state.showFolderEditor = !state.showFolderEditor
        state.showItemEditor = false
        state.draftTitle = ''
        state.draftContent = ''
        if (!state.showFolderEditor) state.draftFolderName = ''
        render()
        return
      }
      if (act === 'saveFolder') {
        const id = createFolder(state.currentFolderId, state.draftFolderName)
        if (id) {
          state.showFolderEditor = false
          state.draftFolderName = ''
          api.ui?.showToast?.('已创建收藏夹')
        }
        render()
        return
      }
      if (act === 'cancelFolder') {
        state.showFolderEditor = false
        state.draftFolderName = ''
        render()
        return
      }
      if (act === 'toggleItemEditor') {
        state.showItemEditor = !state.showItemEditor
        state.showFolderEditor = false
        state.draftFolderName = ''
        if (!state.showItemEditor) {
          state.draftTitle = ''
          state.draftContent = ''
        }
        render()
        return
      }
      if (act === 'saveItem') {
        const id = createItem(state.currentFolderId, state.draftTitle, state.draftContent)
        if (id) {
          state.showItemEditor = false
          state.draftTitle = ''
          state.draftContent = ''
          api.ui?.showToast?.('已添加条目')
        }
        render()
        return
      }
      if (act === 'cancelItem') {
        state.showItemEditor = false
        state.draftTitle = ''
        state.draftContent = ''
        render()
        return
      }
      if (act === 'toggleFolderSearchScope') {
        state.folderSearchScope = state.folderSearchScope === 'global' ? 'current' : 'global'
        render()
        return
      }
      if (act === 'navBack') {
        navigateBack()
        return
      }
      if (act === 'navForward') {
        navigateForward()
        return
      }
      if (act === 'crumb') {
        const folderId = t.getAttribute('data-id') || ''
        navigateFolder(folderId)
        return
      }
      if (act === 'openFolder') {
        const folderId = t.getAttribute('data-id') || ''
        navigateFolder(folderId)
        return
      }
      if (act === 'deleteNode') {
        const nodeId = t.getAttribute('data-id') || ''
        const n = getNode(nodeId)
        if (!n) return
        if (!isDeleteArmed(nodeId)) {
          armDelete(nodeId)
          api.ui?.showToast?.('再点一次删除')
          renderFolderList()
          return
        }
        state.deleteArmedId = ''
        state.deleteArmedAt = 0
        deleteNode(nodeId)
        api.ui?.showToast?.('已删除')
        renderFolderList()
        return
      }
      if (act === 'copyFolderItem') {
        const itemId = t.getAttribute('data-id') || ''
        const it = getNode(itemId)
        if (!it || it.type !== 'item') return
        try {
          await api.clipboard.writeText(it.content)
          api.ui?.showToast?.('复制成功')
        } catch (e) {}
        return
      }
      if (act === 'openItemFolder') {
        const folderId = t.getAttribute('data-folder-id') || ''
        if (!folderId) return
        state.folderSearchQuery = ''
        navigateFolder(folderId)
        return
      }

      if (state.showRecentMenu && !t.closest?.('[data-role="recentDropdown"]')) {
        state.showRecentMenu = false
        renderTopbar()
        return
      }
      if (state.showMoreMenu && !t.closest?.('[data-role="moreDropdown"]')) {
        state.showMoreMenu = false
        renderTopbar()
        return
      }

      const clipCard = t.closest?.('[data-role="clipboardCard"]')
      if (clipCard) {
        const hid = clipCard.getAttribute('data-hid') || ''
        const item = state.history.find((it) => historyKey(it) === hid)
        if (!item) return

        if (t.getAttribute('data-act') === 'delHistory') {
          const key = historyKey(item)
          if (!isDeleteArmed(key)) {
            armDelete(key)
            api.ui?.showToast?.('再点一次删除')
            renderClipboardList()
            return
          }
          state.deleteArmedId = ''
          state.deleteArmedAt = 0
          state.history = state.history.filter((h) => historyKey(h) !== key)
          await persistClipboard()
          api.ui?.showToast?.('已删除')
          renderClipboardList()
          return
        }

        try {
          setInternalCopy(item.type, item.content)
          if (item.type === 'image') await api.clipboard.writeImage(item.content)
          else await api.clipboard.writeText(item.content)

          const newItem = { ...item, time: now() }
          if (item.type === 'image') state.currentImage = item.content
          else state.currentText = item.content

          upsertHistoryItem(newItem)

          await persistClipboard()
          api.ui?.showToast?.('复制成功')
          renderClipboardList()
        } catch (err) {
          clearInternalCopy()
        }
        return
      }

      const folderCard = t.closest?.('[data-role="folderCard"]')
      if (folderCard) {
        const nodeId = folderCard.getAttribute('data-id') || ''
        const n = getNode(nodeId)
        if (!n) return
        if (n.type === 'folder') {
          navigateFolder(nodeId)
          return
        }
        if (n.type === 'item') {
          try {
            await api.clipboard.writeText(n.content)
            api.ui?.showToast?.('复制成功')
          } catch (e) {}
          return
        }
      }
    })

    root.addEventListener('input', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const act = t.getAttribute('data-act')
      if (act === 'searchClipboard') {
        state.clipboardSearchQuery = (t instanceof HTMLInputElement ? t.value : '') || ''
        renderClipboardList()
        return
      }
      if (act === 'searchFolders') {
        state.folderSearchQuery = (t instanceof HTMLInputElement ? t.value : '') || ''
        renderFolderList()
        return
      }
      if (act === 'draftTitle') {
        state.draftTitle = (t instanceof HTMLInputElement ? t.value : '') || ''
        return
      }
      if (act === 'draftFolderName') {
        state.draftFolderName = (t instanceof HTMLInputElement ? t.value : '') || ''
        return
      }
      if (act === 'draftContent') {
        state.draftContent = (t instanceof HTMLTextAreaElement ? t.value : '') || ''
      }
    })

    function endDrag(commit) {
      if (!drag.active) return
      drag.active = false

      if (drag.originEl instanceof HTMLElement) {
        drag.originEl.style.display = ''
      }

      if (drag.ghost instanceof HTMLElement) drag.ghost.remove()
      if (drag.placeholder instanceof HTMLElement) drag.placeholder.remove()

      if (commit && drag.id && state.collections && state.view === 'folders' && !state.folderSearchQuery.trim()) {
        if (isFolder(state.currentFolderId) && drag.listEl instanceof HTMLElement) {
          let insertIndex = 0
          const children = Array.from(drag.listEl.children)
          for (const el of children) {
            if (el === drag.placeholder) break
            if (!(el instanceof HTMLElement)) continue
            if (el.getAttribute('data-role') !== 'folderCard') continue
            const id = el.getAttribute('data-id') || ''
            if (id && id !== drag.id) insertIndex += 1
          }
          moveNode(drag.id, state.currentFolderId, insertIndex)
        }
        render()
      }

      drag.id = ''
      drag.originEl = null
      drag.listEl = null
      drag.placeholder = null
      drag.ghost = null
    }

    function onPointerMove(e) {
      if (!drag.active) return
      if (!(drag.ghost instanceof HTMLElement)) return

      drag.ghost.style.transform = `translate(${e.clientX + 10}px, ${e.clientY + 10}px)`

      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (!(el instanceof HTMLElement)) return

      const list = drag.listEl
      if (!(list instanceof HTMLElement)) return

      // 防止“占位符追着鼠标跑”导致过度敏感：需要明显移动/节流才重排
      const moved = Math.abs(e.clientX - drag.lastX) + Math.abs(e.clientY - drag.lastY)
      const tNow = now()
      drag.lastX = e.clientX
      drag.lastY = e.clientY
      if (moved < 3) return
      if (drag.lastReorderAt && (tNow - drag.lastReorderAt) < 60) return

      function snapshot(listEl) {
        const map = new Map()
        for (const el of Array.from(listEl.children)) {
          if (!(el instanceof HTMLElement)) continue
          if (el.getAttribute('data-role') !== 'folderCard') continue
          if (el.style.display === 'none') continue
          map.set(el, el.getBoundingClientRect())
        }
        return map
      }

      function playFlip(first, listEl) {
        for (const el of Array.from(listEl.children)) {
          if (!(el instanceof HTMLElement)) continue
          if (el.getAttribute('data-role') !== 'folderCard') continue
          if (el.style.display === 'none') continue
          const a = first.get(el)
          if (!a) continue
          const b = el.getBoundingClientRect()
          const dx = a.left - b.left
          const dy = a.top - b.top
          if (!dx && !dy) continue
          if (typeof el.animate === 'function') {
            el.animate(
              [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
              { duration: 140, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
            )
          } else {
            el.style.transition = 'transform 0s'
            el.style.transform = `translate(${dx}px, ${dy}px)`
            requestAnimationFrame(() => {
              el.style.transition = 'transform 140ms cubic-bezier(0.2, 0, 0, 1)'
              el.style.transform = 'translate(0, 0)'
              setTimeout(() => {
                el.style.transition = ''
                el.style.transform = ''
              }, 160)
            })
          }
        }
      }

      const card = el.closest?.('[data-role="folderCard"]')
      if (card instanceof HTMLElement && card !== drag.originEl) {
        const first = snapshot(list)
        const rect = card.getBoundingClientRect()
        const before = e.clientY < rect.top + rect.height / 2
        list.insertBefore(drag.placeholder, before ? card : card.nextSibling)
        playFlip(first, list)
        drag.lastReorderAt = tNow
        return
      }

      // 空白区域：放到末尾
      if (el.closest?.('[data-area="folderList"]')) {
        const first = snapshot(list)
        list.appendChild(drag.placeholder)
        playFlip(first, list)
        drag.lastReorderAt = tNow
      }
    }

    function onPointerUp() {
      if (!drag.active) return
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      endDrag(true)
    }

    root.addEventListener('pointerdown', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (state.view !== 'folders') return
      if (state.folderSearchQuery.trim()) return

      const handle = t.closest?.('[data-role="dragHandle"]')
      if (!handle) return
      const card = t.closest?.('[data-role="folderCard"]')
      if (!(card instanceof HTMLElement)) return
      const nodeId = card.getAttribute('data-id') || ''
      if (!nodeId) return

      const list = document.querySelector('[data-area="folderList"]')
      if (!(list instanceof HTMLElement)) return

      drag.active = true
      drag.id = nodeId
      drag.originEl = card
      drag.listEl = list
      drag.lastX = e.clientX
      drag.lastY = e.clientY
      drag.lastReorderAt = 0

      const ph = document.createElement('div')
      ph.className = 'placeholder'
      ph.style.height = `${Math.max(36, card.getBoundingClientRect().height)}px`
      drag.placeholder = ph

      list.insertBefore(ph, card.nextSibling)
      card.style.display = 'none'

      const ghost = card.cloneNode(true)
      if (ghost instanceof HTMLElement) {
        ghost.classList.add('ghost')
        ghost.style.width = `${Math.max(240, card.getBoundingClientRect().width)}px`
        document.body.appendChild(ghost)
        drag.ghost = ghost
        ghost.style.transform = `translate(${e.clientX + 10}px, ${e.clientY + 10}px)`
      }

      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      e.preventDefault()
    })
  }

  function renderSettings() {
    const area = document.querySelector('[data-area="settings"]')
    if (!(area instanceof HTMLElement)) return
    if (!state.showSettings) {
      area.style.display = 'none'
      return
    }
    area.style.display = 'block'
    area.innerHTML = `
      <div class="row">
        <label>自动监控</label>
        <button class="btn ${state.settings.autoMonitor ? 'primary' : ''}" data-act="toggleAuto">${state.settings.autoMonitor ? '开启' : '关闭'}</button>
      </div>
      <div class="row">
        <label>轮询间隔(ms)</label>
        <input type="number" min="200" step="100" value="${state.settings.pollInterval}" data-act="pollInterval" />
      </div>
      <div class="row">
        <label>最大记录数</label>
        <input type="number" min="10" step="10" value="${state.settings.maxHistory}" data-act="maxHistory" />
      </div>
      <div class="row">
        <button class="btn primary" data-act="saveSettings">保存</button>
      </div>
    `

    area.onclick = async (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const act = t.getAttribute('data-act')
      if (act === 'toggleAuto') {
        state.settings.autoMonitor = !state.settings.autoMonitor
        await persistClipboard()
        restartMonitor()
        render()
      }
      if (act === 'saveSettings') {
        const poll = area.querySelector('input[data-act="pollInterval"]')
        const maxH = area.querySelector('input[data-act="maxHistory"]')
        const pollInterval = poll instanceof HTMLInputElement ? Number(poll.value) : state.settings.pollInterval
        const maxHistory = maxH instanceof HTMLInputElement ? Number(maxH.value) : state.settings.maxHistory
        state.settings.pollInterval = Math.max(200, Number.isFinite(pollInterval) ? pollInterval : DEFAULT_SETTINGS.pollInterval)
        state.settings.maxHistory = Math.max(10, Number.isFinite(maxHistory) ? maxHistory : DEFAULT_SETTINGS.maxHistory)
        await persistClipboard()
        restartMonitor()
        render()
      }
    }
  }

  function renderTopbar() {
    const topbar = document.querySelector('[data-area="topbar"]')
    if (!(topbar instanceof HTMLElement)) return

    if (state.view === 'clipboard') {
      topbar.innerHTML = `
        <button class="btn" data-act="back">返回</button>
        <div class="title">剪贴板历史</div>
        <input class="search" placeholder="搜索文本（图片不参与）" data-act="searchClipboard" value="${escapeHtml(state.clipboardSearchQuery)}" />
        <div class="dropdown" data-role="recentDropdown">
          <button class="btn" data-act="toggleRecent">最近收藏夹 ▾</button>
          <div class="menu ${state.showRecentMenu ? 'open' : ''}">
            <div class="menuHeader">最近打开（最多10个）</div>
            ${
              state.recentFolders.length
                ? state.recentFolders
                    .filter((id) => isFolder(id))
                    .map((id) => `<button class="menuItem" data-act="openRecentFolder" data-id="${escapeHtml(id)}">📁 ${escapeHtml(folderLabelById(id))}</button>`)
                    .join('')
                : `<div class="menuHeader">暂无</div>`
            }
          </div>
        </div>
        <span class="spacer"></span>
        <div class="dropdown" data-role="moreDropdown">
          <button class="btn" data-act="toggleMore">⋮</button>
          <div class="menu ${state.showMoreMenu ? 'open' : ''}">
            <div class="menuHeader">更多</div>
            <button class="menuItem" data-act="toggleSettings">⚙ 设置</button>
            <button class="menuItem" data-act="clearHistory">🗑 清空历史</button>
          </div>
        </div>
        <button class="btn primary" data-act="openFolders">收藏夹</button>
      `
      return
    }

    topbar.innerHTML = `
      <button class="btn" data-act="back">返回</button>
      <div class="title">收藏夹</div>
      <input class="search" placeholder="${state.folderSearchScope === 'global' ? '全局搜索（标题/内容）' : '当前收藏夹内搜索（含子收藏夹）'}" data-act="searchFolders" value="${escapeHtml(state.folderSearchQuery)}" />
      <button class="btn" data-act="toggleFolderSearchScope">${state.folderSearchScope === 'global' ? '全局' : '当前'}</button>
      <span class="spacer"></span>
      <button class="btn primary" data-act="openClipboard">剪贴板</button>
    `
  }

  function renderClipboardList() {
    const listEl = document.querySelector('[data-area="clipboardList"]')
    const emptyEl = document.querySelector('[data-area="clipboardEmpty"]')
    if (!(listEl instanceof HTMLElement) || !(emptyEl instanceof HTMLElement)) return

    const q = state.clipboardSearchQuery.trim().toLowerCase()
    let list = state.history
    if (q) {
      list = list.filter((it) => it.type !== 'image' && String(it.content).toLowerCase().includes(q))
    }

    if (!list.length) {
      listEl.innerHTML = ''
      listEl.style.display = 'none'
      emptyEl.style.display = 'block'
      emptyEl.textContent = q ? '没有匹配的内容' : '剪贴板历史为空'
      return
    }

    listEl.style.display = 'flex'
    emptyEl.style.display = 'none'
    listEl.innerHTML = list
      .map((it, idx) => {
        const typeLabel = it.type === 'image' ? '图片' : '文本'
        const timeLabel = it.time ? formatTime(it.time) : ''
        const key = historyKey(it)
        const top = `
          <div class="cardTop">
            <span class="pill">${escapeHtml(typeLabel)}</span>
            <span class="pill">${escapeHtml(timeLabel)}</span>
            <span class="spacer"></span>
            <button class="iconBtn" data-act="delHistory" title="${isDeleteArmed(key) ? '再点一次确认删除' : '删除'}">${isDeleteArmed(key) ? '⚠' : '🗑'}</button>
          </div>`

        const body = it.type === 'image'
          ? `<div class="imgWrap"><img class="img" src="${escapeHtml(it.content)}" /><div class="pill">🖼 图片</div></div>`
          : `<div class="text">${escapeHtml(it.content || '')}</div>`

        return `<div class="card" data-role="clipboardCard" data-hid="${escapeHtml(key)}">${top}${body}</div>`
      })
      .join('')
  }

  function renderFoldersSubbar() {
    const sub = document.querySelector('[data-area="foldersSubbar"]')
    if (!(sub instanceof HTMLElement)) return
    if (!state.collections) return

    const pathIds = buildPathIds(state.currentFolderId)
    const crumbs = pathIds
      .map((id) => {
        const n = getNode(id)
        const name = n && n.type === 'folder' ? n.name : ''
        return `<span class="crumb" data-act="crumb" data-id="${escapeHtml(id)}">${escapeHtml(name)}</span>`
      })
      .join(`<span class="pill">/</span>`)

    sub.innerHTML = `
      <div class="crumbs">${crumbs}</div>
      <span class="spacer"></span>
      <button class="btn" data-act="navBack" ${state.navBack.length ? '' : 'disabled'} title="后退">←</button>
      <button class="btn" data-act="navForward" ${state.navForward.length ? '' : 'disabled'} title="前进">→</button>
      <button class="btn" data-act="toggleFolderEditor">${state.showFolderEditor ? '收起新建' : '新建收藏夹'}</button>
      <button class="btn primary" data-act="toggleItemEditor">${state.showItemEditor ? '收起输入' : '新建条目'}</button>
      ${
        state.showFolderEditor
          ? `
            <div class="fieldRow" style="width:100%">
              <input class="input" placeholder="收藏夹名称" data-act="draftFolderName" value="${escapeHtml(state.draftFolderName)}" />
              <button class="btn primary" data-act="saveFolder">创建</button>
              <button class="btn" data-act="cancelFolder">取消</button>
            </div>
          `
          : ''
      }
    `
  }

  function renderItemEditor() {
    const area = document.querySelector('[data-area="itemEditor"]')
    if (!(area instanceof HTMLElement)) return
    if (!state.showItemEditor) {
      area.style.display = 'none'
      return
    }
    area.style.display = 'block'
    area.innerHTML = `
      <div class="fieldRow">
        <input class="input" placeholder="标题（可选）" data-act="draftTitle" value="${escapeHtml(state.draftTitle)}" />
        <button class="btn primary" data-act="saveItem">添加</button>
        <button class="btn" data-act="cancelItem">取消</button>
      </div>
      <textarea class="textarea" placeholder="输入要收藏的纯文本内容" data-act="draftContent">${escapeHtml(state.draftContent)}</textarea>
      <div class="hint">
        <span>提示：条目卡片点击即可复制</span>
        <span>拖拽卡片排序（仅排序，不支持移入）</span>
      </div>
    `
  }

  function renderFolderList() {
    const listEl = document.querySelector('[data-area="folderList"]')
    const emptyEl = document.querySelector('[data-area="folderEmpty"]')
    if (!(listEl instanceof HTMLElement) || !(emptyEl instanceof HTMLElement)) return
    if (!state.collections) return

    const q = (state.folderSearchQuery || '').trim()
    const results = q ? searchItems(q, state.folderSearchScope) : []

    if (q) {
      if (!results.length) {
        listEl.innerHTML = ''
        listEl.style.display = 'none'
        emptyEl.style.display = 'block'
        emptyEl.textContent = '没有匹配的内容'
        return
      }

      emptyEl.style.display = 'none'
      listEl.style.display = 'flex'
      listEl.innerHTML = results
        .map(({ item, folderId, path }) => {
          const top = `
            <div class="cardTop">
              <span class="pill">文本</span>
              <span class="pill">${escapeHtml(path)}</span>
              <span class="spacer"></span>
              <button class="iconBtn" data-act="openItemFolder" data-folder-id="${escapeHtml(folderId)}" title="打开所在收藏夹">📂</button>
              <button class="iconBtn" data-act="copyFolderItem" data-id="${escapeHtml(item.id)}" title="复制">📋</button>
            </div>`
          const body = `<div class="text">${escapeHtml(item.content || '')}</div>`
          return `<div class="card" data-role="folderCard" data-id="${escapeHtml(item.id)}">${top}${body}</div>`
        })
        .join('')
      return
    }

    const children = listChildren(state.currentFolderId)
    if (!children.length) {
      listEl.innerHTML = ''
      listEl.style.display = 'none'
      emptyEl.style.display = 'block'
      emptyEl.textContent = '当前收藏夹为空'
      return
    }

    emptyEl.style.display = 'none'
    listEl.style.display = 'flex'
    listEl.innerHTML = children
      .map((n) => {
        if (n.type === 'folder') {
          const count = Array.isArray(n.children) ? n.children.length : 0
          const top = `
            <div class="cardTop">
              <span class="dragHandle" title="拖拽排序" data-role="dragHandle">⋮⋮</span>
              <div class="folderCardTitle">
                <span class="pill">📁</span>
                <span class="folderName">${escapeHtml(n.name)}</span>
              </div>
              <span class="pill">${count} 项</span>
              <span class="spacer"></span>
              <button class="iconBtn" data-act="deleteNode" data-id="${escapeHtml(n.id)}" title="${isDeleteArmed(n.id) ? '再点一次确认删除' : '删除'}">${isDeleteArmed(n.id) ? '⚠' : '🗑'}</button>
            </div>`
          return `<div class="card" data-role="folderCard" data-id="${escapeHtml(n.id)}">${top}</div>`
        }

        const top = `
          <div class="cardTop">
            <span class="dragHandle" title="拖拽排序" data-role="dragHandle">⋮⋮</span>
            <span class="pill">文本</span>
            <span class="pill">${escapeHtml(n.title || '')}</span>
            <span class="spacer"></span>
            <button class="iconBtn" data-act="copyFolderItem" data-id="${escapeHtml(n.id)}" title="复制">📋</button>
            <button class="iconBtn" data-act="deleteNode" data-id="${escapeHtml(n.id)}" title="${isDeleteArmed(n.id) ? '再点一次确认删除' : '删除'}">${isDeleteArmed(n.id) ? '⚠' : '🗑'}</button>
          </div>`
        const body = `<div class="text">${escapeHtml(n.content || '')}</div>`
        return `<div class="card" data-role="folderCard" data-id="${escapeHtml(n.id)}">${top}${body}</div>`
      })
      .join('')
  }

  function render() {
    renderTopbar()

    const clipboardPage = document.querySelector('[data-area="clipboardPage"]')
    const foldersPage = document.querySelector('[data-area="foldersPage"]')
    if (clipboardPage instanceof HTMLElement) clipboardPage.style.display = state.view === 'clipboard' ? 'block' : 'none'
    if (foldersPage instanceof HTMLElement) foldersPage.style.display = state.view === 'folders' ? 'block' : 'none'

    if (state.view === 'clipboard') {
      renderSettings()
      renderClipboardList()
      return
    }

    renderFoldersSubbar()
    renderItemEditor()
    renderFolderList()
  }

  async function checkClipboard() {
    if (!state.settings.autoMonitor) return

    try {
      const text = await api.clipboard.readText()
      handleClipboardChange('text', text)
    } catch (e) {}

    try {
      const img = await api.clipboard.readImage()
      handleClipboardChange('image', img)
    } catch (e) {}

    await persistClipboard()
    if (state.view === 'clipboard') renderClipboardList()
  }

  function restartMonitor() {
    if (state.timer) {
      clearInterval(state.timer)
      state.timer = null
    }
    if (!state.settings.autoMonitor) return
    state.timer = setInterval(checkClipboard, state.settings.pollInterval)
  }

  async function init() {
    try {
      const [savedHistory, savedSettings, savedCollections, savedRecent] = await Promise.all([
        api.storage.get(STORAGE_KEY),
        api.storage.get(SETTINGS_KEY),
        api.storage.get(COLLECTIONS_KEY),
        api.storage.get(RECENT_FOLDERS_KEY),
      ])

      if (Array.isArray(savedHistory)) state.history = savedHistory
      if (savedSettings && typeof savedSettings === 'object') state.settings = { ...DEFAULT_SETTINGS, ...savedSettings }
      state.collections = ensureCollections(savedCollections)
      state.currentFolderId = state.collections.rootId || 'root'
      if (Array.isArray(savedRecent)) state.recentFolders = savedRecent.filter((x) => typeof x === 'string')
      if (!savedCollections) await persistCollections()

      const firstText = state.history.find((it) => it && it.type === 'text' && it.content)
      if (firstText) state.currentText = firstText.content
      const firstImage = state.history.find((it) => it && it.type === 'image' && it.content)
      if (firstImage) state.currentImage = firstImage.content
    } catch (e) {}

    mount()
    render()
    restartMonitor()
    checkClipboard()
  }

  init()
})()
