// memo (iframe sandbox)
;(function () {
  const api = window.fastWindow
  const STORAGE_KEY = 'items'

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
      if (Array.isArray(saved)) {
        state.memos = saved
      }
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
    api.ui?.showToast?.('已保存')
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
          <button class="btn" data-act="back">返回</button>
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

    root.addEventListener('click', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const act = t.getAttribute('data-act')
      if (act === 'back') {
        api.ui?.back ? api.ui.back() : api.ui?.showToast?.('无法返回')
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

