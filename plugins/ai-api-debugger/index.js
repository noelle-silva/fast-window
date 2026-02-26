// ai-api-debugger (iframe sandbox) (entry: index.js)
;(function () {
  const api = window.fastWindow
  const STORAGE_KEY = 'data'
  const VERSION = 1
  const MAX_TIMEOUT_MS = 120000

  const MODES = [
    { id: 'openai.chat', label: 'OpenAI Chat', endpoint: '/chat/completions' },
    { id: 'openai.responses', label: 'OpenAI Responses', endpoint: '/responses' },
    { id: 'anthropic.messages', label: 'Anthropic Messages', endpoint: '/messages' },
  ]

  const state = {
    loading: true,
    sending: false,
    data: null,
    resp: { status: 0, headers: null, body: '', ms: 0, error: '' },
  }

  const css = `
  :root{ --bg:#fff; --text:#111827; --muted:#6b7280; --line:#e5e7eb; --pri:#2563eb; --bad:#dc2626; --ok:#16a34a; --r:12px;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
  *{ box-sizing:border-box; } html,body{ height:100%; } body{ margin:0; background:var(--bg); color:var(--text); }
  .wrap{ height:100vh; display:flex; flex-direction:column; }
  .top{ height:48px; display:flex; align-items:center; gap:8px; padding:0 10px; border-bottom:1px solid var(--line); }
  .title{ font-weight:900; font-size:13px; letter-spacing:0.3px; margin-right:auto; }
  .btn{ height:32px; padding:0 10px; border-radius:10px; border:1px solid var(--line); background:#fff; cursor:pointer; font-size:12px; }
  .btn.pri{ border-color:rgba(37,99,235,0.25); background:rgba(37,99,235,0.08); color:var(--pri); }
  .btn.ok{ border-color:rgba(22,163,74,0.25); background:rgba(22,163,74,0.08); color:var(--ok); }
  .btn.bad{ border-color:rgba(220,38,38,0.25); background:rgba(220,38,38,0.06); color:var(--bad); }
  .btn:disabled{ opacity:.6; cursor:not-allowed; }
  .content{ flex:1; overflow:auto; padding:12px; }
  .grid{ display:grid; grid-template-columns: 1.05fr .95fr; gap:12px; align-items:start; }
  @media (max-width:900px){ .grid{ grid-template-columns:1fr; } }
  .card{ border:1px solid var(--line); border-radius:var(--r); padding:12px; box-shadow:0 8px 24px rgba(17,24,39,0.06); }
  .row{ display:flex; align-items:center; gap:8px; } .sp{ flex:1; } .meta{ font-size:12px; color:var(--muted); }
  .hr{ height:1px; background:var(--line); margin:10px 0; }
  .field{ width:100%; height:32px; padding:0 10px; border-radius:10px; border:1px solid var(--line); font-size:12px; outline:none; background:#fff; }
  textarea.field{ height:auto; min-height:92px; padding:8px 10px; line-height:1.45; resize:vertical; }
  .mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
  .tabs{ display:flex; gap:6px; flex-wrap:wrap; }
  .tab{ height:28px; padding:0 10px; border-radius:10px; border:1px solid var(--line); background:#fff; cursor:pointer; font-size:12px; }
  .tab[aria-pressed="true"]{ border-color:rgba(37,99,235,0.35); background:rgba(37,99,235,0.08); color:var(--pri); }
  .kv{ display:grid; grid-template-columns: 22px 1fr 1fr 28px; gap:8px; align-items:center; }
  .rm{ width:28px; height:28px; border-radius:10px; border:1px solid var(--line); background:#fff; cursor:pointer; }
  .code{ white-space:pre-wrap; word-break:break-word; background:#0b1220; color:#e5e7eb; border-radius:12px; padding:10px; font-size:12px; line-height:1.45; }
  .list{ display:flex; flex-direction:column; gap:8px; }
  `

  function now() {
    return Date.now()
  }

  function esc(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
  }

  function clampInt(value, min, max, fallback) {
    const n = Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.max(min, Math.min(max, Math.floor(n)))
  }

  function clampNum(value, min, max, fallback) {
    const n = Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.max(min, Math.min(max, n))
  }

  function defaultData() {
    return {
      version: VERSION,
      mode: 'openai.chat',
      settings: {
        openaiBaseUrl: 'https://api.openai.com/v1',
        openaiApiKey: '',
        anthropicBaseUrl: 'https://api.anthropic.com/v1',
        anthropicApiKey: '',
        anthropicVersion: '2023-06-01',
      },
      timeoutMs: 60000,
      autoAuth: true,
      headers: [{ enabled: true, key: 'Content-Type', value: 'application/json' }],
      extra: [{ enabled: false, key: '', value: '' }],
      drafts: {
        'openai.chat': {
          model: 'gpt-4.1-mini',
          temperature: 0.2,
          maxTokens: 1024,
          messages: [
            { role: 'system', content: '' },
            { role: 'user', content: '' },
          ],
        },
        'openai.responses': { model: 'gpt-4.1-mini', instructions: '', input: '', temperature: 0.2, maxOutputTokens: 1024 },
        'anthropic.messages': {
          model: 'claude-3-5-sonnet-latest',
          temperature: 0.2,
          maxTokens: 1024,
          messages: [
            { role: 'system', content: '' },
            { role: 'user', content: '' },
          ],
        },
      },
    }
  }

  function normalizeData(raw) {
    const base = defaultData()
    const d = raw && typeof raw === 'object' ? raw : {}
    const out = { ...base, ...d }
    if (!out.settings || typeof out.settings !== 'object') out.settings = base.settings
    if (!out.drafts || typeof out.drafts !== 'object') out.drafts = base.drafts
    for (const m of MODES) {
      if (!out.drafts[m.id]) out.drafts[m.id] = base.drafts[m.id]
    }
    // 迁移：旧版 openai.chat / anthropic.messages 只有 system/user 两个固定字段
    for (const id of ['openai.chat', 'anthropic.messages']) {
      const draft = out.drafts[id]
      if (!draft || typeof draft !== 'object') continue
      if (Array.isArray(draft.messages)) continue
      const system = String(draft.system || '').trim()
      const user = String(draft.user || '').trim()
      draft.messages = []
      if (system || 'system' in draft) draft.messages.push({ role: 'system', content: system })
      if (user || 'user' in draft) draft.messages.push({ role: 'user', content: user })
      if (!draft.messages.length) draft.messages.push({ role: 'user', content: '' })
      delete draft.system
      delete draft.user
    }
    if (!Array.isArray(out.headers)) out.headers = base.headers
    if (!Array.isArray(out.extra)) out.extra = base.extra
    if (typeof out.timeoutMs !== 'number') out.timeoutMs = base.timeoutMs
    if (typeof out.autoAuth !== 'boolean') out.autoAuth = base.autoAuth
    if (typeof out.mode !== 'string') out.mode = base.mode
    return out
  }

  async function load() {
    let raw = null
    try {
      raw = await api.storage.get(STORAGE_KEY)
    } catch {}
    state.data = normalizeData(raw)
    state.loading = false
    render()
  }

  async function save() {
    if (!state.data) return
    try {
      await api.storage.set(STORAGE_KEY, state.data)
    } catch {}
  }

  function activeDraft() {
    const d = state.data
    if (!d) return null
    return d.drafts[d.mode] || null
  }

  function getModeDef(modeId) {
    return MODES.find(m => m.id === modeId) || MODES[0]
  }

  function computeUrl() {
    const d = state.data
    if (!d) return ''
    const def = getModeDef(d.mode)
    const base =
      d.mode === 'anthropic.messages'
        ? String(d.settings.anthropicBaseUrl || '').trim()
        : String(d.settings.openaiBaseUrl || '').trim()
    return base.replace(/\/+$/, '') + def.endpoint
  }

  function toHeadersMap(rows) {
    const out = {}
    const list = Array.isArray(rows) ? rows : []
    for (const r of list) {
      if (!r || !r.enabled) continue
      const k = String(r.key || '').trim()
      if (!k) continue
      out[k] = String(r.value ?? '')
    }
    return out
  }

  function findHeaderKey(headers, name) {
    const target = String(name || '').toLowerCase()
    for (const k of Object.keys(headers || {})) {
      if (String(k).toLowerCase() === target) return k
    }
    return ''
  }

  function setHeaderIfMissingOrEmpty(headers, name, value) {
    const key = findHeaderKey(headers, name)
    if (!key) {
      headers[name] = value
      return
    }
    const cur = String(headers[key] ?? '').trim()
    if (!cur) headers[key] = value
  }

  function parseExtraValue(raw) {
    const s = String(raw ?? '').trim()
    if (!s) return undefined
    if (s === 'null') return null
    if (s === 'true') return true
    if (s === 'false') return false
    if (Number.isFinite(Number(s))) return Number(s)
    try {
      return JSON.parse(s)
    } catch {
      return s
    }
  }

  function applyExtra(obj, rows) {
    const list = Array.isArray(rows) ? rows : []
    for (const r of list) {
      if (!r || !r.enabled) continue
      const k = String(r.key || '').trim()
      if (!k) continue
      if (k in obj) continue
      const v = parseExtraValue(r.value)
      if (v === undefined) continue
      obj[k] = v
    }
    return obj
  }

  function buildRequest() {
    const d = state.data
    const draft = activeDraft()
    if (!d || !draft) return null

    const url = computeUrl()
    if (!(url.startsWith('http://') || url.startsWith('https://'))) {
      return { error: 'Base URL 必须以 http:// 或 https:// 开头' }
    }

    const timeoutMs = clampInt(d.timeoutMs, 1, MAX_TIMEOUT_MS, 60000)
    const headers = toHeadersMap(d.headers)

    if (d.autoAuth) {
      if (d.mode === 'anthropic.messages') {
        const key = String(d.settings.anthropicApiKey || '').trim()
        const ver = String(d.settings.anthropicVersion || '').trim()
        if (key) setHeaderIfMissingOrEmpty(headers, 'x-api-key', key)
        if (ver) setHeaderIfMissingOrEmpty(headers, 'anthropic-version', ver)
      } else {
        const key = String(d.settings.openaiApiKey || '').trim()
        if (key) setHeaderIfMissingOrEmpty(headers, 'Authorization', `Bearer ${key}`)
      }
    }

    if (d.mode === 'openai.chat') {
      const model = String(draft.model || '').trim()
      if (!model) return { error: 'model 不能为空' }

      const raw = Array.isArray(draft.messages) ? draft.messages : []
      const messages = []
      for (const item of raw) {
        const role = String(item?.role || '').trim()
        const content = String(item?.content || '').trim()
        if (!role || !content) continue
        if (role !== 'system' && role !== 'user' && role !== 'assistant') continue
        messages.push({ role, content })
      }
      if (!messages.some(m => m.role === 'user')) return { error: '至少需要一条 user 消息' }

      const body = applyExtra(
        {
          model,
          messages,
          temperature: clampNum(draft.temperature, 0, 2, 0.2),
          max_tokens: clampInt(draft.maxTokens, 1, 200000, 1024),
          stream: false,
        },
        d.extra,
      )
      return { url, headers, timeoutMs, bodyObj: body, bodyText: JSON.stringify(body) }
    }

    if (d.mode === 'openai.responses') {
      const model = String(draft.model || '').trim()
      const input = String(draft.input || '').trim()
      if (!model) return { error: 'model 不能为空' }
      if (!input) return { error: 'input 不能为空' }
      const instructions = String(draft.instructions || '').trim()
      const body = applyExtra(
        {
          model,
          input,
          instructions: instructions || undefined,
          temperature: clampNum(draft.temperature, 0, 2, 0.2),
          max_output_tokens: clampInt(draft.maxOutputTokens, 1, 200000, 1024),
        },
        d.extra,
      )
      if (!body.instructions) delete body.instructions
      return { url, headers, timeoutMs, bodyObj: body, bodyText: JSON.stringify(body) }
    }

    if (d.mode === 'anthropic.messages') {
      const model = String(draft.model || '').trim()
      if (!model) return { error: 'model 不能为空' }

      const raw = Array.isArray(draft.messages) ? draft.messages : []
      const systemParts = []
      const messages = []
      for (const item of raw) {
        const role = String(item?.role || '').trim()
        const content = String(item?.content || '').trim()
        if (!role || !content) continue
        if (role === 'system') systemParts.push(content)
        else if (role === 'user' || role === 'assistant') messages.push({ role, content })
      }
      if (!messages.some(m => m.role === 'user')) return { error: '至少需要一条 user 消息' }
      const system = systemParts.join('\n\n').trim()

      const body = applyExtra(
        {
          model,
          system: system || undefined,
          messages,
          temperature: clampNum(draft.temperature, 0, 2, 0.2),
          max_tokens: clampInt(draft.maxTokens, 1, 200000, 1024),
        },
        d.extra,
      )
      if (!body.system) delete body.system
      return { url, headers, timeoutMs, bodyObj: body, bodyText: JSON.stringify(body) }
    }

    return { error: '未知模式' }
  }

  async function send() {
    if (state.sending) return
    if (!api?.net?.request) return api.ui?.showToast?.('宿主未提供 net.request（需要升级应用）')

    const built = buildRequest()
    if (!built) return
    if (built.error) return api.ui?.showToast?.(built.error)

    state.sending = true
    state.resp = { status: 0, headers: null, body: '', ms: 0, error: '' }
    render()

    const started = now()
    try {
      const r = await api.net.request({
        method: 'POST',
        url: built.url,
        headers: built.headers,
        body: built.bodyText,
        timeoutMs: built.timeoutMs,
      })
      state.resp = {
        status: Number(r?.status || 0),
        headers: r?.headers && typeof r.headers === 'object' ? r.headers : null,
        body: String(r?.body || ''),
        ms: now() - started,
        error: '',
      }
      if (state.resp.status < 200 || state.resp.status >= 300) api.ui?.showToast?.(`HTTP ${state.resp.status}`)
    } catch (e) {
      state.resp = { status: 0, headers: null, body: '', ms: now() - started, error: String(e?.message || e || '请求失败') }
      api.ui?.showToast?.(state.resp.error || '请求失败')
    } finally {
      state.sending = false
      render()
    }
  }

  function copyText(text) {
    const t = String(text || '')
    if (!t) return
    api.clipboard
      .writeText(t)
      .then(() => api.ui?.showToast?.('已复制'))
      .catch(() => api.ui?.showToast?.('复制失败'))
  }

  function prettyJson(text) {
    const s = String(text || '').trim()
    if (!s) return ''
    try {
      return JSON.stringify(JSON.parse(s), null, 2)
    } catch {
      return ''
    }
  }

  function formatHeaders(h) {
    if (!h || typeof h !== 'object') return ''
    const entries = Object.entries(h).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    if (!entries.length) return ''
    return entries.map(([k, v]) => `${k}: ${String(v)}`).join('\n')
  }

  function renderMessagesEditor(draft, roles) {
    const list = Array.isArray(draft?.messages) ? draft.messages : []
    const roleList = Array.isArray(roles) && roles.length ? roles : ['system', 'user', 'assistant']

    const items = list
      .map((m, i) => {
        const role = String(m?.role || 'user')
        const content = String(m?.content || '')
        const upDisabled = i <= 0 ? 'disabled' : ''
        const downDisabled = i >= list.length - 1 ? 'disabled' : ''
        const delDisabled = list.length <= 1 ? 'disabled' : ''
        return `
          <div class="card" style="padding:10px">
            <div class="row" style="margin-bottom:8px">
              <div class="meta" style="margin:0">#${i + 1}</div>
              <select class="field mono" style="max-width:180px" data-bind="msgRole" data-i="${i}">
                ${roleList.map(r => `<option value="${esc(r)}" ${r === role ? 'selected' : ''}>${esc(r)}</option>`).join('')}
              </select>
              <div class="sp"></div>
              <button class="btn" data-act="mv-msg" data-dir="-1" data-i="${i}" ${upDisabled}>↑</button>
              <button class="btn" data-act="mv-msg" data-dir="1" data-i="${i}" ${downDisabled}>↓</button>
              <button class="btn" data-act="ins-msg" data-pos="above" data-i="${i}">上插</button>
              <button class="btn" data-act="ins-msg" data-pos="below" data-i="${i}">下插</button>
              <button class="btn bad" data-act="rm-msg" data-i="${i}" ${delDisabled}>删除</button>
            </div>
            <textarea class="field mono" data-bind="msgContent" data-i="${i}" placeholder="content...">${esc(content)}</textarea>
          </div>
        `
      })
      .join('')

    return `
      <div class="row">
        <button class="btn" data-act="add-msg" data-role="system">+ system</button>
        <button class="btn" data-act="add-msg" data-role="user">+ user</button>
        <button class="btn" data-act="add-msg" data-role="assistant">+ assistant</button>
        <div class="sp"></div>
      </div>
      <div class="list" style="margin-top:8px">${items || `<div class="meta">-</div>`}</div>
    `
  }

  function renderDraftFields(mode, draft) {
    if (!draft) return ''
    if (mode === 'openai.responses') {
      return `
        <div class="row">
          <div class="meta" style="margin:0">model</div>
          <input class="field mono" data-bind="model" value="${esc(draft.model)}" />
        </div>
        <div class="row">
          <div class="meta" style="margin:0">temperature</div>
          <input class="field mono" style="max-width:160px" data-bind="temperature" value="${esc(draft.temperature)}" />
          <div class="meta" style="margin:0">max_output_tokens</div>
          <input class="field mono" style="max-width:180px" data-bind="maxOutputTokens" value="${esc(draft.maxOutputTokens)}" />
          <div class="sp"></div>
        </div>
        <div class="meta">instructions（可选）</div>
        <textarea class="field mono" data-bind="instructions">${esc(draft.instructions || '')}</textarea>
        <div class="meta">input</div>
        <textarea class="field mono" data-bind="input">${esc(draft.input || '')}</textarea>
      `
    }

    const tip =
      mode === 'anthropic.messages'
        ? `<div class="meta">提示：Anthropic 的 system 是单独字段；这里的 system 块会合并到 system（顺序不影响 messages）。</div>`
        : `<div class="meta">提示：按顺序发送 messages；可用“上插/下插/↑↓”穿插 system 与 user。</div>`

    return `
      <div class="row">
        <div class="meta" style="margin:0">model</div>
        <input class="field mono" data-bind="model" value="${esc(draft.model)}" />
      </div>
      <div class="row">
        <div class="meta" style="margin:0">temperature</div>
        <input class="field mono" style="max-width:160px" data-bind="temperature" value="${esc(draft.temperature)}" />
        <div class="meta" style="margin:0">max_tokens</div>
        <input class="field mono" style="max-width:160px" data-bind="maxTokens" value="${esc(draft.maxTokens)}" />
        <div class="sp"></div>
      </div>
      ${tip}
      <div class="meta">messages</div>
      ${renderMessagesEditor(draft, ['system', 'user', 'assistant'])}
    `
  }

  function renderKvList(rows, kind) {
    const list = Array.isArray(rows) ? rows : []
    if (!list.length) return `<div class="meta">-</div>`
    return list
      .map((r, i) => {
        const enabled = !!r?.enabled
        return `
          <div class="kv">
            <input type="checkbox" data-bind="${kind}Enabled" data-i="${i}" ${enabled ? 'checked' : ''} />
            <input class="field mono" data-bind="${kind}Key" data-i="${i}" value="${esc(r?.key || '')}" placeholder="key" />
            <input class="field mono" data-bind="${kind}Value" data-i="${i}" value="${esc(r?.value ?? '')}" placeholder="value" />
            <button class="rm" data-act="rm-${kind}" data-i="${i}">×</button>
          </div>
        `
      })
      .join('')
  }

  function render() {
    const root = document.getElementById('app')
    if (!root) return
    if (!api) {
      root.innerHTML = `<div style="padding:12px" class="meta">fastWindow API 不可用</div>`
      return
    }
    if (state.loading || !state.data) {
      root.innerHTML = `<div style="padding:12px" class="meta">加载中…</div>`
      return
    }

    const d = state.data
    const draft = activeDraft()
    const modeDef = getModeDef(d.mode)
    const built = buildRequest()
    const preview = built && !built.error ? JSON.stringify(built.bodyObj || {}, null, 2) : ''
    const respHeadersText = formatHeaders(state.resp.headers)
    const tabs = MODES.map(m => {
      const pressed = m.id === d.mode ? 'true' : 'false'
      return `<button class="tab" data-act="set-mode" data-mode="${esc(m.id)}" aria-pressed="${pressed}">${esc(m.label)}</button>`
    }).join('')

    root.innerHTML = `
      <style>${css}</style>
      <div class="wrap">
        <div class="top">
          <div class="title">🧪 AI API 调试</div>
          <button class="btn pri" data-act="copy-body" ${built && !built.error ? '' : 'disabled'}>复制 Body</button>
          <button class="btn ok" data-act="send" ${state.sending ? 'disabled' : ''}>${state.sending ? '发送中…' : '发送'}</button>
        </div>

        <div class="content">
          <div class="grid">
            <div class="card">
              <div class="row" style="margin-bottom:8px">
                <div class="meta" style="margin:0">协议</div>
                <div class="tabs">${tabs}</div>
                <div class="sp"></div>
                <div class="meta" style="margin:0">端点：<span class="mono">${esc(modeDef.endpoint)}</span></div>
              </div>

              <div class="meta">URL</div>
              <input class="field mono" value="${esc(computeUrl())}" readonly />

              <div class="hr"></div>

              <div class="meta">连接（填空）</div>
              <div class="row">
                <div class="meta" style="margin:0">Base URL</div>
                <input class="field mono" data-bind="baseUrl" value="${esc(d.mode === 'anthropic.messages' ? d.settings.anthropicBaseUrl : d.settings.openaiBaseUrl)}" />
              </div>
              <div class="row">
                <div class="meta" style="margin:0">API Key</div>
                <input class="field mono" type="password" data-bind="apiKey" value="${esc(d.mode === 'anthropic.messages' ? d.settings.anthropicApiKey : d.settings.openaiApiKey)}" />
              </div>
              ${d.mode === 'anthropic.messages' ? `
                <div class="row">
                  <div class="meta" style="margin:0">anthropic-version</div>
                  <input class="field mono" data-bind="anthropicVersion" value="${esc(d.settings.anthropicVersion || '')}" />
                </div>
              ` : ''}
              <label class="row meta" style="margin:8px 0 0 0; gap:6px">
                <input type="checkbox" data-bind="autoAuth" ${d.autoAuth ? 'checked' : ''} />
                自动添加鉴权头（可在 Headers 里手动覆盖）
              </label>

              <div class="hr"></div>

              ${renderDraftFields(d.mode, draft)}

              <div class="hr"></div>

              <div class="row">
                <div class="meta" style="margin:0">timeoutMs（后端上限 120000）</div>
                <input class="field mono" style="max-width:180px" data-bind="timeoutMs" value="${esc(d.timeoutMs)}" />
                <div class="sp"></div>
                <button class="btn" data-act="add-header">+ Header</button>
                <button class="btn" data-act="add-extra">+ Extra</button>
              </div>

              <div class="hr"></div>

              <div class="meta">Headers</div>
              <div class="col">${renderKvList(d.headers, 'header')}</div>

              <div class="hr"></div>

              <div class="meta">Extra（仅追加，不覆盖已有字段；值会尝试 JSON 解析）</div>
              <div class="col">${renderKvList(d.extra, 'extra')}</div>

              <div class="hr"></div>

              <div class="meta">请求 Body 预览</div>
              <div class="code mono">${esc(preview || (built?.error ? `// ${built.error}` : ''))}</div>
            </div>

            <div class="card">
              <div class="row">
                <div class="title" style="margin:0">响应</div>
                <div class="sp"></div>
                <span class="meta">${esc(state.resp.ms)}ms</span>
                <button class="btn pri" data-act="copy-resp" ${state.resp.body ? '' : 'disabled'}>复制响应</button>
              </div>
              ${state.resp.error ? `<div class="meta" style="color:var(--bad); margin-top:8px">${esc(state.resp.error)}</div>` : ''}
              <div class="hr"></div>
              <div class="meta">status</div>
              <div class="field mono" style="display:flex;align-items:center">${esc(state.resp.status || '-')}</div>
              <div class="hr"></div>
              <div class="meta">headers</div>
              <div class="code mono">${esc(respHeadersText || '')}</div>
              <div class="hr"></div>
              <div class="meta">body（raw）</div>
              <div class="code mono">${esc(state.resp.body || '')}</div>
              <div class="hr"></div>
              <div class="meta">body（pretty JSON）</div>
              <div class="code mono">${esc(prettyJson(state.resp.body))}</div>
            </div>
          </div>
        </div>
      </div>
    `
  }

  function applyKvBind(list, bind, value, el) {
    const i = Number(el?.dataset?.i || 0)
    if (!Array.isArray(list) || !list[i]) return
    if (bind.endsWith('Enabled')) list[i].enabled = !!el?.checked
    if (bind.endsWith('Key')) list[i].key = String(value || '')
    if (bind.endsWith('Value')) list[i].value = String(value ?? '')
  }

  function ensureMessages(draft) {
    if (!draft || typeof draft !== 'object') return []
    if (!Array.isArray(draft.messages)) draft.messages = [{ role: 'user', content: '' }]
    if (!draft.messages.length) draft.messages.push({ role: 'user', content: '' })
    return draft.messages
  }

  function normalizeMsgRole(role) {
    const r = String(role || '').trim()
    if (r === 'system' || r === 'user' || r === 'assistant') return r
    return 'user'
  }

  function onInput(bind, value, el) {
    const d = state.data
    const draft = activeDraft()
    if (!d || !draft) return

    if (bind === 'mode') return
    if (bind === 'timeoutMs') d.timeoutMs = clampInt(value, 1, MAX_TIMEOUT_MS, 60000)
    if (bind === 'autoAuth') d.autoAuth = !!el?.checked

    if (bind === 'baseUrl') {
      if (d.mode === 'anthropic.messages') d.settings.anthropicBaseUrl = String(value || '')
      else d.settings.openaiBaseUrl = String(value || '')
    }
    if (bind === 'apiKey') {
      if (d.mode === 'anthropic.messages') d.settings.anthropicApiKey = String(value || '')
      else d.settings.openaiApiKey = String(value || '')
    }
    if (bind === 'anthropicVersion') d.settings.anthropicVersion = String(value || '')

    if (bind === 'msgRole' || bind === 'msgContent') {
      const i = Number(el?.dataset?.i || 0)
      const list = ensureMessages(draft)
      if (!list[i]) return
      if (bind === 'msgRole') list[i].role = normalizeMsgRole(value)
      else list[i].content = String(value ?? '')
      render()
      void save()
      return
    }

    if (bind === 'model') draft.model = String(value || '')
    if (bind === 'temperature') draft.temperature = clampNum(value, 0, 2, 0.2)
    if (bind === 'maxTokens') draft.maxTokens = clampInt(value, 1, 200000, 1024)

    if (bind === 'instructions') draft.instructions = String(value || '')
    if (bind === 'input') draft.input = String(value || '')
    if (bind === 'maxOutputTokens') draft.maxOutputTokens = clampInt(value, 1, 200000, 1024)

    if (bind.startsWith('header')) applyKvBind(d.headers, bind, value, el)
    if (bind.startsWith('extra')) applyKvBind(d.extra, bind, value, el)

    render()
    void save()
  }

  function onClick(act, el) {
    const d = state.data
    const draft = activeDraft()
    if (!d) return

    if (act === 'send') return void send()
    if (act === 'copy-resp') return copyText(state.resp.body || '')
    if (act === 'copy-body') {
      const built = buildRequest()
      if (!built || built.error) return
      return copyText(JSON.stringify(built.bodyObj || {}, null, 2))
    }

    if (act === 'set-mode') {
      const mode = String(el?.dataset?.mode || '').trim()
      if (!mode) return
      d.mode = mode
      state.resp = { status: 0, headers: null, body: '', ms: 0, error: '' }
      render()
      return void save()
    }

    if (act === 'add-msg' || act === 'ins-msg' || act === 'mv-msg' || act === 'rm-msg') {
      if (!draft) return
      const list = ensureMessages(draft)
      const i = Number(el?.dataset?.i || 0)

      if (act === 'add-msg') {
        const role = normalizeMsgRole(el?.dataset?.role || 'user')
        list.push({ role, content: '' })
      }
      if (act === 'ins-msg') {
        const pos = String(el?.dataset?.pos || 'below')
        const idx = pos === 'above' ? i : i + 1
        const at = Math.max(0, Math.min(list.length, idx))
        list.splice(at, 0, { role: 'user', content: '' })
      }
      if (act === 'mv-msg') {
        const dir = Number(el?.dataset?.dir || 0)
        const j = i + (dir < 0 ? -1 : 1)
        if (i >= 0 && i < list.length && j >= 0 && j < list.length) {
          const tmp = list[i]
          list[i] = list[j]
          list[j] = tmp
        }
      }
      if (act === 'rm-msg') {
        if (list.length > 1 && i >= 0 && i < list.length) list.splice(i, 1)
      }

      render()
      return void save()
    }

    if (act === 'add-header') {
      d.headers.push({ enabled: true, key: '', value: '' })
      render()
      return void save()
    }
    if (act === 'add-extra') {
      d.extra.push({ enabled: true, key: '', value: '' })
      render()
      return void save()
    }
    if (act === 'rm-header' || act === 'rm-extra') {
      const i = Number(el?.dataset?.i || 0)
      const list = act === 'rm-header' ? d.headers : d.extra
      if (!Array.isArray(list)) return
      list.splice(i, 1)
      render()
      return void save()
    }
  }

  document.addEventListener('click', e => {
    const el = e.target instanceof Element ? e.target.closest('[data-act]') : null
    const act = el ? String(el.getAttribute('data-act') || '') : ''
    if (!act) return
    e.preventDefault()
    onClick(act, el)
  })

  document.addEventListener('input', e => {
    const el = e.target instanceof HTMLElement ? e.target : null
    if (!el) return
    const bind = String(el.getAttribute('data-bind') || '')
    if (!bind) return
    const value = 'value' in el ? el.value : ''
    onInput(bind, value, el)
  })

  document.addEventListener('change', e => {
    const el = e.target instanceof HTMLElement ? e.target : null
    if (!el) return
    const bind = String(el.getAttribute('data-bind') || '')
    if (!bind) return
    const value = 'value' in el ? el.value : ''
    onInput(bind, value, el)
  })

  function mount() {
    document.body.innerHTML = '<div id="app"></div>'
    if (!api) return
    void load()
  }

  mount()
})()
