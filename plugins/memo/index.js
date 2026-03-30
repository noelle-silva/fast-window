// memo (iframe sandbox) (entry: index.js)
;(function () {
  const PLUGIN_ID = 'memo'
  const STORAGE_KEY = 'items'

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v)
  }

  function createToast() {
    let el = null
    let timer = 0

    function ensure() {
      if (typeof document === 'undefined') return null
      if (el && el.isConnected) return el
      el = document.createElement('div')
      el.id = '__fastWindowMemoToast'
      el.style.position = 'fixed'
      el.style.left = '50%'
      el.style.bottom = '24px'
      el.style.transform = 'translateX(-50%)'
      el.style.maxWidth = 'min(520px, calc(100vw - 24px))'
      el.style.padding = '10px 12px'
      el.style.borderRadius = '10px'
      el.style.background = 'rgba(0,0,0,0.82)'
      el.style.color = '#fff'
      el.style.fontSize = '12px'
      el.style.lineHeight = '1.4'
      el.style.boxShadow = '0 6px 18px rgba(0,0,0,0.28)'
      el.style.zIndex = '999999'
      el.style.opacity = '0'
      el.style.transition = 'opacity 160ms ease'
      el.style.pointerEvents = 'none'
      document.body.appendChild(el)
      return el
    }

    return (message) => {
      const d = ensure()
      if (!d) return
      const text = String(message ?? '').trim()
      if (!text) return

      d.textContent = text
      d.style.opacity = '1'
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (!d.isConnected) return
        d.style.opacity = '0'
      }, 1800)
    }
  }

  const toast = createToast()

  function createCompatApi(baseApi) {
    const base = baseApi || {}
    const tauri = base && base.tauri ? base.tauri : null
    if (!tauri || typeof tauri.invoke !== 'function') {
      throw new Error('tauri.invoke 不可用（请更新宿主网关）')
    }

    const STORAGE_SCHEMA_VERSION = 1
    const STORAGE_META_PATH = '_meta.json'

    function nowId() {
      const d = new Date()
      const pad = (n, w) => String(n).padStart(w, '0')
      return (
        pad(d.getFullYear(), 4) +
        pad(d.getMonth() + 1, 2) +
        pad(d.getDate(), 2) +
        '-' +
        pad(d.getHours(), 2) +
        pad(d.getMinutes(), 2) +
        pad(d.getSeconds(), 2)
      )
    }

    function safeStorageKey(raw) {
      const k = String(raw || '').trim()
      if (!k) throw new Error('storage key 不能为空')
      if (k.length > 80) throw new Error('storage key 过长')
      if (!/^[a-zA-Z0-9._-]+$/.test(k)) throw new Error(`storage key 不合法：${k}`)
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') throw new Error(`storage key 不安全：${k}`)
      return k
    }

    function keyToPath(key) {
      const k = safeStorageKey(key)
      return `${k}.json`
    }

    async function filesListDir(dir) {
      return tauri.invoke({ command: 'plugin_files_list_dir', payload: { pluginId: PLUGIN_ID, req: { scope: 'data', dir } } })
    }

    async function filesReadText(path) {
      return tauri.invoke({ command: 'plugin_files_read_text', payload: { pluginId: PLUGIN_ID, req: { scope: 'data', path } } })
    }

    async function filesWriteText(path, text) {
      return tauri.invoke({
        command: 'plugin_files_write_text',
        payload: { pluginId: PLUGIN_ID, req: { scope: 'data', path, text: String(text ?? ''), overwrite: true } },
      })
    }

    async function filesDelete(path) {
      return tauri.invoke({ command: 'plugin_files_delete', payload: { pluginId: PLUGIN_ID, req: { scope: 'data', path } } })
    }

    async function readJson(path) {
      let text = ''
      try {
        text = await filesReadText(path)
      } catch (e) {
        const msg = String(e?.message || e || '')
        if (msg.includes('文件不存在')) return null
        throw e
      }
      const s = String(text || '').trim()
      if (!s) return null
      try {
        return JSON.parse(s)
      } catch {
        throw new Error(`JSON 解析失败：${path}`)
      }
    }

    async function writeJson(path, value) {
      const text = JSON.stringify(value ?? null, null, 2) + '\n'
      await filesWriteText(path, text)
    }

    let storageReady = false
    let storageReadyPromise = null

    async function ensureStorageReady() {
      if (storageReady) return
      if (storageReadyPromise) return storageReadyPromise

      storageReadyPromise = Promise.resolve()
        .then(async () => {
          await filesListDir(null)
          const meta = await readJson(STORAGE_META_PATH).catch(() => null)
          if (meta && typeof meta === 'object' && Number(meta.schemaVersion || 0) >= STORAGE_SCHEMA_VERSION) {
            storageReady = true
            return
          }

          const shardPath = keyToPath(STORAGE_KEY)
          const entries = await filesListDir(null).catch(() => [])
          const names = new Set(Array.isArray(entries) ? entries.filter((e) => e && e.isFile).map((e) => String(e.name || '')) : [])
          if (names.has(shardPath)) {
            await writeJson(STORAGE_META_PATH, { schemaVersion: STORAGE_SCHEMA_VERSION, migratedAt: Date.now(), reason: 'shards-existed' })
            storageReady = true
            return
          }

          const source = { from: `${PLUGIN_ID}.json` }
          const obj0 = await readJson(`${PLUGIN_ID}.json`).catch(() => null)
          const obj = obj0 && typeof obj0 === 'object' ? obj0 : null
          const snapshot = {}
          if (obj && obj[STORAGE_KEY] != null) snapshot[STORAGE_KEY] = obj[STORAGE_KEY]
          if (Object.keys(snapshot).length) {
            await writeJson(`_backup-migrate-${nowId()}.json`, snapshot).catch(() => {})
            await writeJson(shardPath, snapshot[STORAGE_KEY])
            await writeJson(STORAGE_META_PATH, { schemaVersion: STORAGE_SCHEMA_VERSION, migratedAt: Date.now(), source })
            storageReady = true
            return
          }
          if (!obj) source.fileReadable = false

          await writeJson(STORAGE_META_PATH, { schemaVersion: STORAGE_SCHEMA_VERSION, createdAt: Date.now(), freshInstall: true, source }).catch(
            () => {},
          )
          storageReady = true
        })
        .finally(() => {
          storageReadyPromise = null
        })

      return storageReadyPromise
    }

    return {
      ...base,
      tauri,
      ui: {
        ...(base.ui || {}),
        showToast: (message) => toast(message),
        startDragging: async () => {
          try {
            await tauri.invoke({ command: 'plugin:window|start_dragging', payload: {} })
          } catch (e) {
            toast(String((e && e.message) || e || '无法拖拽'))
          }
        },
      },
      storage: {
        ...(base.storage || {}),
        get: async (key) => {
          await ensureStorageReady()
          const p = keyToPath(key)
          return readJson(p)
        },
        set: async (key, value) => {
          await ensureStorageReady()
          const p = keyToPath(key)
          await writeJson(p, value)
        },
        remove: async (key) => {
          await ensureStorageReady()
          const p = keyToPath(key)
          await filesDelete(p).catch((e) => {
            const msg = String(e?.message || e || '')
            if (msg.includes('文件不存在')) return
            throw e
          })
        },
      },
    }
  }

  const api = createCompatApi(window.fastWindow)
  window.fastWindow = api

  async function startDragging() {
    await api.ui.startDragging()
  }

  const state = {
    memos: [],
    input: '',
    loading: true,
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
    .content { flex: 1; overflow: auto; padding: 10px; }
    .editor {
      background: var(--surface);
      border: 1px solid var(--outline);
      border-radius: 12px;
      padding: 10px;
      box-shadow: var(--shadow);
      margin-bottom: 10px;
    }
    .textarea {
      width: 100%;
      min-height: 64px;
      border: 1px solid var(--outline);
      border-radius: 10px;
      padding: 10px;
      font-size: 13px;
      line-height: 1.5;
      outline: none;
      resize: vertical;
      background: white;
      color: var(--text);
    }
    .hint { margin-top: 8px; font-size: 12px; color: var(--muted); display: flex; justify-content: space-between; }
    .list { display: flex; flex-direction: column; gap: 10px; }
    .card {
      background: var(--surface);
      border: 1px solid var(--outline);
      border-radius: 12px;
      padding: 10px;
      box-shadow: var(--shadow);
    }
    .cardTop { display: flex; align-items: center; gap: 8px; }
    .time { font-size: 11px; color: var(--muted); }
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
    .text { margin-top: 8px; white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.55; }
    .empty { color: var(--muted); text-align: center; padding: 24px 0; font-size: 13px; }
  `

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
      return new Date(ts).toLocaleString()
    } catch {
      return ''
    }
  }

  async function load() {
    try {
      const saved = await api.storage.get(STORAGE_KEY)
      if (Array.isArray(saved)) state.memos = saved
    } catch (e) {}
    state.loading = false
  }

  async function save() {
    try {
      await api.storage.set(STORAGE_KEY, state.memos)
    } catch (e) {}
  }

  async function addMemo() {
    const content = (state.input || '').trim()
    if (!content) return
    const memo = { id: String(Date.now()), content, createdAt: Date.now() }
    state.memos = [memo, ...state.memos]
    state.input = ''
    await save()
    toast('已保存')
    render()
  }

  async function deleteMemo(id) {
    state.memos = state.memos.filter((m) => m.id !== id)
    await save()
    render()
  }

  function mount() {
    const root = document.getElementById('app') || document.body
    root.innerHTML = `
        <style>${styles}</style>
        <div class="wrap">
          <div class="topbar">
          <button class="btn" data-act="back" aria-label="返回主页" title="返回主页">←</button>
            <div class="title">快捷备忘录</div>
            <button class="btn primary" data-act="save">保存</button>
          </div>
          <div class="content">
            <div class="editor">
            <textarea class="textarea" placeholder="输入备忘内容，Enter 保存，Shift+Enter 换行" data-act="input"></textarea>
            <div class="hint">
              <span>共 <span data-role="count">0</span> 条</span>
              <span>删除不会进回收站</span>
            </div>
          </div>
          <div class="list" data-area="list"></div>
          <div class="empty" data-area="empty" style="display:none">暂无备忘</div>
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
        startDragging().catch(() => {})
      })
    }

    root.addEventListener('click', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const act = t.getAttribute('data-act')
      if (act === 'back') {
        api.host?.back ? api.host.back() : toast('无法返回')
        return
      }
      if (act === 'save') {
        addMemo()
        return
      }
      if (act === 'del') {
        const id = t.getAttribute('data-id')
        if (id) deleteMemo(id)
        return
      }
    })

    root.addEventListener('keydown', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (t.getAttribute('data-act') !== 'input') return
      if (!(t instanceof HTMLTextAreaElement)) return

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        addMemo()
      }
    })

    root.addEventListener('input', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (t.getAttribute('data-act') !== 'input') return
      if (!(t instanceof HTMLTextAreaElement)) return
      state.input = t.value
    })
  }

  function render() {
    const textarea = document.querySelector('textarea[data-act="input"]')
    if (textarea instanceof HTMLTextAreaElement) {
      textarea.value = state.input
    }

    const count = document.querySelector('[data-role="count"]')
    if (count instanceof HTMLElement) {
      count.textContent = String(state.memos.length)
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

    if (!state.memos.length) {
      listEl.innerHTML = ''
      emptyEl.style.display = 'block'
      emptyEl.textContent = '暂无备忘'
      return
    }

    emptyEl.style.display = 'none'
    listEl.innerHTML = state.memos
      .map((m) => {
        return `
          <div class="card">
            <div class="cardTop">
              <div class="time">${escapeHtml(formatTime(m.createdAt))}</div>
              <div class="spacer"></div>
              <button class="iconBtn" data-act="del" data-id="${escapeHtml(m.id)}" title="删除">🗑</button>
            </div>
            <div class="text">${escapeHtml(m.content || '')}</div>
          </div>
        `
      })
      .join('')
  }

  async function init() {
    await load()
    mount()
    render()
  }

  init()
})()
