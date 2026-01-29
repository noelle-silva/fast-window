// clipboard-history (iframe sandbox)
;(function () {
  const api = window.fastWindow
  const PLUGIN_ID = 'clipboard-history'

  const STORAGE_KEY = 'history'
  const FAVORITES_KEY = 'favorites'
  const SETTINGS_KEY = 'settings'

  const DEFAULT_SETTINGS = {
    maxHistory: 50,
    autoMonitor: true,
    pollInterval: 1000,
  }

  const state = {
    history: [],
    favorites: [],
    settings: { ...DEFAULT_SETTINGS },
    showFavorites: false,
    showSettings: false,
    searchQuery: '',

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
    }
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
    .content { flex: 1; overflow: auto; padding: 10px; }
    .list { display: flex; flex-direction: column; gap: 10px; }
    .card {
      background: var(--surface);
      border: 1px solid var(--outline);
      border-radius: 12px;
      padding: 10px;
      box-shadow: var(--shadow);
      cursor: pointer;
    }
    .card:hover { border-color: #CFCFCF; }
    .cardTop { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .pill { font-size: 11px; color: var(--muted); border: 1px solid var(--outline); padding: 2px 8px; border-radius: 999px; }
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
    }
    .iconBtn.fav { color: #FFB300; }
    .text { white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.55; }
    .imgWrap { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; }
    .img { display: block; max-width: 100%; max-height: 220px; object-fit: contain; border-radius: 10px; }
    .empty { color: var(--muted); text-align: center; padding: 24px 0; font-size: 13px; }
    .settings { border: 1px dashed var(--outline); background: var(--surface); border-radius: 12px; padding: 10px; margin-bottom: 10px; }
    .row { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
    .row label { width: 120px; color: var(--muted); font-size: 12px; }
    .row input[type="number"] { width: 120px; height: 30px; border: 1px solid var(--outline); border-radius: 8px; padding: 0 8px; }
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

  function getList() {
    return state.showFavorites ? state.favorites : state.history
  }

  function setList(list) {
    if (state.showFavorites) state.favorites = list
    else state.history = list
  }

  function isFav(item) {
    return state.favorites.some((f) => f.type === item.type && f.content === item.content)
  }

  function upsertHistoryItem(item) {
    state.history = [item, ...state.history.filter((it) => !(it.type === item.type && it.content === item.content))]
      .slice(0, state.settings.maxHistory)
  }

  function upsertFavoriteItem(item) {
    state.favorites = [item, ...state.favorites.filter((it) => !(it.type === item.type && it.content === item.content))]
  }

  function replaceInternalImageIfNeeded(internalContent, newContent) {
    if (!internalContent || internalContent === newContent) return
    const item = { type: 'image', content: newContent, time: now() }
    state.history = [item, ...state.history.filter((it) => !(it.type === 'image' && (it.content === internalContent || it.content === newContent)))]
      .slice(0, state.settings.maxHistory)
    if (state.showFavorites) {
      state.favorites = [item, ...state.favorites.filter((it) => !(it.type === 'image' && (it.content === internalContent || it.content === newContent)))]
    }
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

  async function persist() {
    try {
      await api.storage.set(STORAGE_KEY, state.history)
      await api.storage.set(FAVORITES_KEY, state.favorites)
      await api.storage.set(SETTINGS_KEY, state.settings)
    } catch (e) {}
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
    root.innerHTML = `
      <style>${styles}</style>
      <div class="wrap">
        <div class="topbar">
          <button class="btn" data-act="back">返回</button>
          <div class="title">剪贴板历史</div>
          <input class="search" placeholder="搜索文本（图片不参与）" data-act="search" />
          <button class="btn" data-act="toggleFav">收藏</button>
          <button class="btn" data-act="toggleSettings">设置</button>
          <button class="btn danger" data-act="clear">清空</button>
        </div>
        <div class="content">
          <div class="settings" data-area="settings" style="display:none"></div>
          <div class="list" data-area="list"></div>
          <div class="empty" data-area="empty" style="display:none"></div>
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
      if (act === 'toggleFav') {
        state.showFavorites = !state.showFavorites
        state.showSettings = false
        render()
        return
      }
      if (act === 'toggleSettings') {
        state.showSettings = !state.showSettings
        render()
        return
      }
      if (act === 'clear') {
        if (state.showFavorites) state.favorites = []
        else state.history = []
        await persist()
        render()
        return
      }

      const card = t.closest?.('.card')
      if (card) {
        const idxStr = card.getAttribute('data-idx')
        const idx = idxStr ? Number(idxStr) : -1
        const list = getList()
        const item = list[idx]
        if (!item) return

        // 操作按钮
        if (t.getAttribute('data-act') === 'fav') {
          const fav = isFav(item)
          if (fav) state.favorites = state.favorites.filter((f) => !(f.type === item.type && f.content === item.content))
          else upsertFavoriteItem(item)
          await persist()
          render()
          return
        }
        if (t.getAttribute('data-act') === 'del') {
          if (state.showFavorites) {
            state.favorites = state.favorites.filter((f) => !(f.type === item.type && f.content === item.content))
          } else {
            state.history = state.history.filter((h) => !(h.type === item.type && h.content === item.content))
          }
          await persist()
          render()
          return
        }

        // 点击卡片：复制并置顶
        try {
          setInternalCopy(item.type, item.content)
          if (item.type === 'image') await api.clipboard.writeImage(item.content)
          else await api.clipboard.writeText(item.content)

          const newItem = { ...item, time: now() }
          if (item.type === 'image') state.currentImage = item.content
          else state.currentText = item.content

          if (state.showFavorites) {
            upsertFavoriteItem(newItem)
          }
          upsertHistoryItem(newItem)

          await persist()
          api.ui?.showToast?.('复制成功')
          render()
        } catch (err) {
          clearInternalCopy()
        }
      }
    })

    root.addEventListener('input', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (t.getAttribute('data-act') === 'search') {
        state.searchQuery = (t instanceof HTMLInputElement ? t.value : '') || ''
        render()
      }
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
        await persist()
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
        await persist()
        restartMonitor()
        render()
      }
    }
  }

  function renderList() {
    const listEl = document.querySelector('[data-area="list"]')
    const emptyEl = document.querySelector('[data-area="empty"]')
    if (!(listEl instanceof HTMLElement) || !(emptyEl instanceof HTMLElement)) return

    const q = state.searchQuery.trim().toLowerCase()
    let list = getList()
    if (q) {
      list = list.filter((it) => it.type !== 'image' && String(it.content).toLowerCase().includes(q))
    }

    if (!list.length) {
      listEl.innerHTML = ''
      emptyEl.style.display = 'block'
      emptyEl.textContent = q ? '没有匹配的内容' : (state.showFavorites ? '暂无收藏' : '剪贴板历史为空')
      return
    }

    emptyEl.style.display = 'none'
    listEl.innerHTML = list
      .map((it, idx) => {
        const fav = isFav(it)
        const typeLabel = it.type === 'image' ? '图片' : '文本'
        const timeLabel = it.time ? formatTime(it.time) : ''
        const top = `
          <div class="cardTop">
            <span class="pill">${escapeHtml(typeLabel)}</span>
            <span class="pill">${escapeHtml(timeLabel)}</span>
            <span class="spacer"></span>
            <button class="iconBtn ${fav ? 'fav' : ''}" data-act="fav" title="收藏">${fav ? '★' : '☆'}</button>
            <button class="iconBtn" data-act="del" title="删除">🗑</button>
          </div>`

        const body = it.type === 'image'
          ? `<div class="imgWrap"><img class="img" src="${escapeHtml(it.content)}" /><div class="pill">🖼 图片</div></div>`
          : `<div class="text">${escapeHtml(it.content || '')}</div>`

        return `<div class="card" data-idx="${idx}">${top}${body}</div>`
      })
      .join('')
  }

  function render() {
    const favBtn = document.querySelector('[data-act="toggleFav"]')
    if (favBtn instanceof HTMLButtonElement) {
      favBtn.textContent = state.showFavorites ? '历史' : '收藏'
      favBtn.className = state.showFavorites ? 'btn primary' : 'btn'
    }
    renderSettings()
    renderList()
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

    await persist()
    render()
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
      const [savedHistory, savedFavorites, savedSettings] = await Promise.all([
        api.storage.get(STORAGE_KEY),
        api.storage.get(FAVORITES_KEY),
        api.storage.get(SETTINGS_KEY),
      ])

      if (Array.isArray(savedHistory)) state.history = savedHistory
      if (Array.isArray(savedFavorites)) state.favorites = savedFavorites
      if (savedSettings && typeof savedSettings === 'object') state.settings = { ...DEFAULT_SETTINGS, ...savedSettings }

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

