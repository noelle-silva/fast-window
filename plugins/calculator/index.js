// calculator (iframe sandbox) (entry: index.js)
;(function () {
  const api = window.fastWindow
  const STORAGE_KEY = 'state'
  const MAX_HISTORY = 30

  const state = {
    expr: '',
    previewText: '',
    lastValueText: '',
    errorText: '',
    history: [],
    loading: true,
  }

  let persistTimer = 0
  let clearHistoryConfirmAt = 0

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
    user-select: none;
  }
  .btn.primary { border-color: transparent; background: var(--primary); color: white; }
  .btn.danger { border-color: transparent; background: var(--danger); color: white; }
  .title { font-weight: 700; font-size: 13px; margin-right: auto; }
  .content { flex: 1; overflow: auto; padding: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: start; }
  @media (max-width: 860px) {
    .content { grid-template-columns: 1fr; }
  }
  .panel {
    background: var(--surface);
    border: 1px solid var(--outline);
    border-radius: 12px;
    padding: 10px;
    box-shadow: var(--shadow);
    min-width: 0;
  }
  .exprRow { display: flex; gap: 8px; align-items: center; }
  .expr {
    width: 100%;
    height: 38px;
    border: 1px solid var(--outline);
    border-radius: 10px;
    padding: 0 10px;
    font-size: 16px;
    outline: none;
    background: white;
    color: var(--text);
  }
  .rightCol { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .subRow { margin-top: 8px; display: flex; justify-content: space-between; gap: 8px; }
  .hint { font-size: 12px; color: var(--muted); }
  .result {
    font-size: 28px;
    font-weight: 900;
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .error { color: var(--danger); }
  .keypad {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }
  .key {
    height: 42px;
    border: 1px solid var(--outline);
    border-radius: 12px;
    background: white;
    cursor: pointer;
    font-size: 14px;
    line-height: 40px;
    text-align: center;
    user-select: none;
  }
  .key.op { background: #F5F5F5; }
  .key.primary { border-color: transparent; background: var(--primary); color: white; font-weight: 700; }
  .key.danger { border-color: transparent; background: var(--danger); color: white; }
  .historyTop { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .historyList { display: flex; flex-direction: column; gap: 8px; }
  .histItem {
    border: 1px solid var(--outline);
    border-radius: 12px;
    padding: 8px 10px;
    background: white;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    align-items: center;
  }
  .histExpr { font-size: 13px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .histVal { font-size: 14px; font-weight: 800; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .histBtns { display: flex; gap: 6px; }
  .iconBtn {
    width: 30px;
    height: 30px;
    border: 1px solid var(--outline);
    border-radius: 10px;
    background: white;
    cursor: pointer;
    font-size: 14px;
    line-height: 28px;
    text-align: center;
    color: var(--muted);
    user-select: none;
  }
  .empty { color: var(--muted); text-align: center; padding: 10px 0; font-size: 13px; }
  `

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;')
  }

  function normalizeExpr(raw) {
    const s = String(raw || '')
    return s
      .replaceAll('×', '*')
      .replaceAll('x', '*')
      .replaceAll('X', '*')
      .replaceAll('÷', '/')
      .replaceAll('−', '-')
  }

  function formatNumber(n) {
    if (!Number.isFinite(n)) throw new Error('结果不是有限数值')
    const s = Number(n).toPrecision(15)
    return String(parseFloat(s))
  }

  function tokenize(input) {
    const s = normalizeExpr(input)
    const tokens = []
    let i = 0
    while (i < s.length) {
      const ch = s[i]
      if (/\s/.test(ch)) {
        i++
        continue
      }
      if (ch === '(' || ch === ')') {
        tokens.push({ type: 'paren', value: ch })
        i++
        continue
      }
      if ('+-*/^'.includes(ch)) {
        tokens.push({ type: 'op', value: ch })
        i++
        continue
      }
      if (/[0-9.]/.test(ch)) {
        let j = i
        let seenDot = false
        while (j < s.length) {
          const c = s[j]
          if (c === '.') {
            if (seenDot) break
            seenDot = true
            j++
            continue
          }
          if (/[0-9]/.test(c)) {
            j++
            continue
          }
          break
        }
        const raw = s.slice(i, j)
        if (raw === '.' || raw === '') throw new Error('无效数字')
        const num = Number(raw)
        if (!Number.isFinite(num)) throw new Error('无效数字')
        tokens.push({ type: 'num', value: num })
        i = j
        continue
      }
      throw new Error(`不支持的字符：${ch}`)
    }
    return tokens
  }

  function toRpn(tokens) {
    const out = []
    const stack = []
    const prec = { 'u+': 4, 'u-': 4, '^': 3, '*': 2, '/': 2, '+': 1, '-': 1 }
    const assoc = { 'u+': 'right', 'u-': 'right', '^': 'right', '*': 'left', '/': 'left', '+': 'left', '-': 'left' }

    let prev = 'start' // start | num | op | lparen | rparen
    for (const t of tokens) {
      if (t.type === 'num') {
        out.push(t)
        prev = 'num'
        continue
      }
      if (t.type === 'paren' && t.value === '(') {
        stack.push(t)
        prev = 'lparen'
        continue
      }
      if (t.type === 'paren' && t.value === ')') {
        let found = false
        while (stack.length) {
          const top = stack.pop()
          if (top.type === 'paren' && top.value === '(') {
            found = true
            break
          }
          out.push(top)
        }
        if (!found) throw new Error('括号不匹配')
        prev = 'rparen'
        continue
      }
      if (t.type === 'op') {
        let op = t.value
        if ((op === '+' || op === '-') && (prev === 'start' || prev === 'op' || prev === 'lparen')) {
          op = op === '+' ? 'u+' : 'u-'
        }
        const cur = { type: 'op', value: op }
        while (stack.length) {
          const top = stack[stack.length - 1]
          if (top.type !== 'op') break
          const a = assoc[op]
          const cp = prec[op]
          const tp = prec[top.value]
          if ((a === 'left' && cp <= tp) || (a === 'right' && cp < tp)) out.push(stack.pop())
          else break
        }
        stack.push(cur)
        prev = 'op'
        continue
      }
      throw new Error('未知 token')
    }
    while (stack.length) {
      const top = stack.pop()
      if (top.type === 'paren') throw new Error('括号不匹配')
      out.push(top)
    }
    return out
  }

  function evalRpn(rpn) {
    const st = []
    for (const t of rpn) {
      if (t.type === 'num') {
        st.push(t.value)
        continue
      }
      if (t.type === 'op') {
        const op = t.value
        if (op === 'u+' || op === 'u-') {
          if (st.length < 1) throw new Error('表达式不完整')
          const a = st.pop()
          st.push(op === 'u-' ? -a : +a)
          continue
        }
        if (st.length < 2) throw new Error('表达式不完整')
        const b = st.pop()
        const a = st.pop()
        if (op === '+') st.push(a + b)
        else if (op === '-') st.push(a - b)
        else if (op === '*') st.push(a * b)
        else if (op === '/') st.push(a / b)
        else if (op === '^') st.push(Math.pow(a, b))
        else throw new Error('未知运算符')
        continue
      }
      throw new Error('未知 token')
    }
    if (st.length !== 1) throw new Error('表达式不完整')
    return st[0]
  }

  function evalExpression(expr) {
    const text = String(expr || '').trim()
    if (!text) throw new Error('请输入表达式')
    const tokens = tokenize(text)
    const rpn = toRpn(tokens)
    const v = evalRpn(rpn)
    return formatNumber(v)
  }

  async function load() {
    try {
      const saved = await api.storage.get(STORAGE_KEY)
      if (saved && typeof saved === 'object') {
        const expr = typeof saved.expr === 'string' ? saved.expr : ''
        const lastValueText = typeof saved.lastValueText === 'string' ? saved.lastValueText : ''
        const rawHistory = Array.isArray(saved.history) ? saved.history : []
        const history = []
        for (const it of rawHistory) {
          if (!it || typeof it !== 'object') continue
          const exprText = typeof it.expr === 'string' ? it.expr : ''
          const valueText = typeof it.valueText === 'string' ? it.valueText : ''
          if (!exprText || !valueText) continue
          const id = typeof it.id === 'string' ? it.id : String(Date.now() + Math.random())
          history.push({ id, expr: exprText, valueText, at: typeof it.at === 'number' ? it.at : Date.now() })
          if (history.length >= MAX_HISTORY) break
        }
        state.expr = expr
        state.lastValueText = lastValueText
        state.history = history
      }
    } catch (e) {}
    state.loading = false
  }

  async function persist() {
    const payload = {
      expr: state.expr,
      lastValueText: state.lastValueText,
      history: state.history.slice(0, MAX_HISTORY),
    }
    try {
      await api.storage.set(STORAGE_KEY, payload)
    } catch (e) {}
  }

  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = 0
      void persist()
    }, 250)
  }

  function getExprInput() {
    const el = document.querySelector('input[data-act="expr"]')
    return el instanceof HTMLInputElement ? el : null
  }

  function setExpr(next, opts) {
    state.expr = String(next || '')
    const input = getExprInput()
    if (input) {
      input.value = state.expr
      if (opts && typeof opts.cursor === 'number') {
        const c = Math.max(0, Math.min(state.expr.length, opts.cursor))
        input.setSelectionRange(c, c)
      }
      input.focus()
    }
    updatePreview()
    schedulePersist()
    render()
  }

  function insertAtCursor(text) {
    const input = getExprInput()
    const s = String(text || '')
    if (!input) {
      setExpr(state.expr + s)
      return
    }
    const start = input.selectionStart ?? state.expr.length
    const end = input.selectionEnd ?? state.expr.length
    const cur = input.value
    const next = cur.slice(0, start) + s + cur.slice(end)
    setExpr(next, { cursor: start + s.length })
  }

  function backspace() {
    const input = getExprInput()
    if (!input) {
      setExpr(state.expr.slice(0, -1))
      return
    }
    const start = input.selectionStart ?? state.expr.length
    const end = input.selectionEnd ?? state.expr.length
    const cur = input.value
    if (start !== end) {
      const next = cur.slice(0, start) + cur.slice(end)
      setExpr(next, { cursor: start })
      return
    }
    if (start <= 0) return
    const next = cur.slice(0, start - 1) + cur.slice(start)
    setExpr(next, { cursor: start - 1 })
  }

  function clearAll() {
    setExpr('')
    state.previewText = ''
    state.errorText = ''
    render()
  }

  function updatePreview() {
    state.errorText = ''
    state.previewText = ''
    const text = String(state.expr || '').trim()
    if (!text) return
    try {
      state.previewText = evalExpression(text)
    } catch (e) {
      state.errorText = String(e?.message || e || '计算失败')
    }
  }

  async function pasteExpr() {
    try {
      const t = await api.clipboard.readText()
      const s = String(t || '').trim()
      if (!s) {
        api.ui?.showToast?.('剪贴板为空')
        return
      }
      setExpr(s)
    } catch (e) {
      api.ui?.showToast?.('粘贴失败')
    }
  }

  async function copyText(text) {
    const s = String(text || '').trim()
    if (!s) return
    try {
      await api.clipboard.writeText(s)
      api.ui?.showToast?.('已复制')
    } catch (e) {
      api.ui?.showToast?.('复制失败')
    }
  }

  function commitToHistory(expr, valueText) {
    const item = { id: String(Date.now()), expr: String(expr || ''), valueText: String(valueText || ''), at: Date.now() }
    state.history = [item, ...state.history].slice(0, MAX_HISTORY)
    state.lastValueText = item.valueText
    schedulePersist()
  }

  function evaluateNow() {
    const text = String(state.expr || '').trim()
    if (!text) return
    try {
      const valueText = evalExpression(text)
      state.previewText = valueText
      state.errorText = ''
      commitToHistory(text, valueText)
      render()
    } catch (e) {
      state.errorText = String(e?.message || e || '计算失败')
      state.previewText = ''
      render()
    }
  }

  function mount() {
    const root = document.getElementById('app') || document.body
    root.innerHTML = `
      <style>${styles}</style>
      <div class="wrap">
        <div class="topbar">
          <button class="btn" data-act="back" aria-label="返回主页" title="返回主页">←</button>
          <div class="title">计算器</div>
          <button class="btn" data-act="paste" aria-label="从剪贴板粘贴" title="粘贴">粘贴</button>
          <button class="btn primary" data-act="copy" aria-label="复制结果" title="复制">复制</button>
        </div>

        <div class="content">
          <div class="panel">
            <div class="keypad" aria-label="键盘">
              <div class="key op" data-insert="(">(</div>
              <div class="key op" data-insert=")">)</div>
              <div class="key op" data-insert="^">^</div>
              <div class="key danger" data-act="bs" aria-label="退格" title="退格">⌫</div>

              <div class="key" data-insert="7">7</div>
              <div class="key" data-insert="8">8</div>
              <div class="key" data-insert="9">9</div>
              <div class="key op" data-insert="/">÷</div>

              <div class="key" data-insert="4">4</div>
              <div class="key" data-insert="5">5</div>
              <div class="key" data-insert="6">6</div>
              <div class="key op" data-insert="*">×</div>

              <div class="key" data-insert="1">1</div>
              <div class="key" data-insert="2">2</div>
              <div class="key" data-insert="3">3</div>
              <div class="key op" data-insert="-">−</div>

              <div class="key op" data-act="ans" aria-label="插入上次结果" title="Ans">Ans</div>
              <div class="key" data-insert="0">0</div>
              <div class="key" data-insert=".">.</div>
              <div class="key op" data-insert="+">+</div>

              <div class="key op" data-act="clear" aria-label="清空">清空</div>
              <div class="key op" data-act="useLast" aria-label="使用上次结果">=Ans</div>
              <div class="key op" data-act="copyExpr" aria-label="复制表达式">复制式</div>
              <div class="key primary" data-act="eq" aria-label="计算">=</div>
            </div>
          </div>

          <div class="rightCol">
            <div class="panel">
              <div class="exprRow">
                <input class="expr" data-act="expr" spellcheck="false" autocomplete="off" placeholder="输入表达式，例如：(1+2)*3^2" />
              </div>
              <div class="subRow">
                <div class="hint">Enter 计算 · Esc 清空 · 支持 ^</div>
                <div class="result" data-role="result"></div>
              </div>
              <div class="hint error" data-role="error" style="display:none"></div>
            </div>

            <div class="panel">
              <div class="historyTop">
                <div class="title" style="margin-right:auto">历史</div>
                <button class="btn" data-act="clearHistory" aria-label="清空历史">清空历史</button>
              </div>
              <div class="historyList" data-area="history"></div>
              <div class="empty" data-area="empty" style="display:none">暂无历史</div>
            </div>
          </div>
        </div>
      </div>
    `

    root.addEventListener('click', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return

      const insert = t.getAttribute('data-insert')
      if (insert != null) {
        insertAtCursor(insert)
        return
      }

      const act = t.getAttribute('data-act')
      if (act === 'back') {
        api.ui?.back ? api.ui.back() : api.ui?.showToast?.('无法返回')
        return
      }
      if (act === 'paste') return void pasteExpr()
      if (act === 'copy') return void copyText(state.previewText || state.lastValueText || '')
      if (act === 'copyExpr') return void copyText(state.expr || '')
      if (act === 'eq') return evaluateNow()
      if (act === 'bs') return backspace()
      if (act === 'clear') return clearAll()
      if (act === 'ans') return insertAtCursor(state.lastValueText || '0')
      if (act === 'useLast') return setExpr(state.lastValueText || '')
      if (act === 'useHist') {
        const id = t.getAttribute('data-id')
        const item = state.history.find((x) => x && x.id === id)
        if (item) setExpr(item.expr || '')
        return
      }
      if (act === 'copyHist') {
        const id = t.getAttribute('data-id')
        const item = state.history.find((x) => x && x.id === id)
        if (item) return void copyText(item.valueText || '')
        return
      }
      if (act === 'clearHistory') {
        const now = Date.now()
        if (now - clearHistoryConfirmAt > 3000) {
          clearHistoryConfirmAt = now
          api.ui?.showToast?.('再点一次：清空历史（不可恢复）')
          return
        }
        clearHistoryConfirmAt = 0
        state.history = []
        schedulePersist()
        render()
        api.ui?.showToast?.('已清空历史')
        return
      }
    })

    root.addEventListener('keydown', (e) => {
      const input = getExprInput()
      if (!input) return
      if (e.target !== input) return
      if (e.key === 'Enter') {
        e.preventDefault()
        evaluateNow()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        clearAll()
      }
    })

    root.addEventListener('input', (e) => {
      const input = getExprInput()
      if (!input) return
      if (e.target !== input) return
      state.expr = input.value
      updatePreview()
      schedulePersist()
      render()
    })
  }

  function render() {
    const resultEl = document.querySelector('[data-role="result"]')
    if (resultEl instanceof HTMLElement) {
      resultEl.textContent = state.previewText ? `= ${state.previewText}` : (state.lastValueText ? `Ans = ${state.lastValueText}` : '')
    }
    const errEl = document.querySelector('[data-role="error"]')
    if (errEl instanceof HTMLElement) {
      const msg = String(state.errorText || '')
      errEl.textContent = msg
      errEl.style.display = msg ? 'block' : 'none'
    }
    const listEl = document.querySelector('[data-area="history"]')
    const emptyEl = document.querySelector('[data-area="empty"]')
    if (!(listEl instanceof HTMLElement) || !(emptyEl instanceof HTMLElement)) return

    if (state.loading) {
      listEl.innerHTML = ''
      emptyEl.style.display = 'block'
      emptyEl.textContent = '加载中...'
      return
    }
    if (!state.history.length) {
      listEl.innerHTML = ''
      emptyEl.style.display = 'block'
      emptyEl.textContent = '暂无历史'
      return
    }
    emptyEl.style.display = 'none'
    listEl.innerHTML = state.history
      .map((it) => {
        const expr = escapeHtml(it.expr || '')
        const val = escapeHtml(it.valueText || '')
        const id = escapeHtml(it.id || '')
        return `
          <div class="histItem">
            <div>
              <div class="histExpr">${expr}</div>
              <div class="histVal">= ${val}</div>
            </div>
            <div class="histBtns">
              <button class="iconBtn" data-act="useHist" data-id="${id}" aria-label="使用这条表达式" title="使用">↩</button>
              <button class="iconBtn" data-act="copyHist" data-id="${id}" aria-label="复制这条结果" title="复制">📋</button>
            </div>
          </div>
        `
      })
      .join('')
  }

  async function init() {
    await load()
    mount()
    const input = getExprInput()
    if (input) input.value = state.expr
    updatePreview()
    render()
    const i = getExprInput()
    if (i) i.focus()
  }

  init()
})()
