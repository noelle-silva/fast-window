// ai-draw (iframe sandbox)
;(function () {
  const api = window.fastWindow
  const runtime = String((api && api.__meta && api.__meta.runtime) || 'ui')

  if (runtime === 'background') {
    const SETTINGS_KEY = 'settings'
    const SAVED_RESULTS_KEY = 'bgSavedResults'
    const SAVE_REQUESTS_KEY = 'bgSaveRequests'
    const SAVE_RESPONSES_KEY = 'bgSaveResponses'
    const POLL_INTERVAL = 1200
    const MAX_SAVED_RESULTS = 200
    const MAX_SAVE_ITEMS = 50
    const MAX_SAVE_PER_TICK = 3
    let ticking = false

    function stripCodeFences(s) {
      const raw = String(s || '').trim()
      if (!raw) return ''
      if (raw.startsWith('```')) {
        const i = raw.indexOf('\n')
        const j = raw.lastIndexOf('```')
        if (i >= 0 && j > i) return raw.slice(i + 1, j).trim()
      }
      return raw
    }

    function extractImageFromText(text) {
      const s = String(text || '').trim()
      if (!s) return ''

      const dataUrlMatch = s.match(/data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\r\n]+/i)
      if (dataUrlMatch && dataUrlMatch[0]) return dataUrlMatch[0]

      const maybeJson = stripCodeFences(s)
      try {
        const j = JSON.parse(maybeJson)
        const dataUrl = j?.data_url || j?.dataUrl || j?.image || j?.image_data_url
        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) return dataUrl.trim()
        const b64 = j?.b64_png || j?.b64_json || j?.b64 || j?.base64 || j?.image_base64 || j?.png_base64
        if (typeof b64 === 'string' && b64.trim()) return `data:image/png;base64,${b64.trim()}`
      } catch {}

      if (/^[A-Za-z0-9+/=\r\n]+$/.test(s) && s.length > 200) {
        return `data:image/png;base64,${s.replace(/\s+/g, '')}`
      }

      return ''
    }

    function parseTaskImageData(task) {
      const result = task && task.result && typeof task.result === 'object' ? task.result : {}
      const httpStatus = Number(result.status)
      if (!Number.isFinite(httpStatus) || httpStatus < 200 || httpStatus >= 300) return ''

      const bodyText = typeof result.body === 'string' ? result.body : ''
      let parsed = null
      try {
        parsed = JSON.parse(String(bodyText || '{}'))
      } catch {
        parsed = null
      }

      if (!parsed || typeof parsed !== 'object') {
        return extractImageFromText(bodyText)
      }

      const item = (Array.isArray(parsed?.data) && parsed.data[0]) || (Array.isArray(parsed?.images) && parsed.images[0]) || null
      const b64 = item?.b64_json || item?.b64 || item?.base64 || ''
      const direct = typeof item?.data_url === 'string' ? item.data_url : typeof item?.dataUrl === 'string' ? item.dataUrl : ''
      const content =
        (Array.isArray(parsed?.choices) && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content) || ''

      return (
        (direct && String(direct).trim()) ||
        (b64 && `data:image/png;base64,${String(b64).trim()}`) ||
        extractImageFromText(content)
      )
    }

    function trimSavedResults(map) {
      const entries = Object.entries(map || {})
        .filter(([k, v]) => k && v && typeof v === 'object')
        .sort((a, b) => Number((b[1] && b[1].at) || 0) - Number((a[1] && a[1].at) || 0))
        .slice(0, MAX_SAVED_RESULTS)
      const out = {}
      for (const [k, v] of entries) out[k] = v
      return out
    }

    function trimSaveMap(map) {
      const entries = Object.entries(map || {})
        .filter(([k, v]) => k && v && typeof v === 'object')
        .sort((a, b) => Number((b[1] && b[1].at) || 0) - Number((a[1] && a[1].at) || 0))
        .slice(0, MAX_SAVE_ITEMS)
      const out = {}
      for (const [k, v] of entries) out[k] = v
      return out
    }

    async function readSavedResults() {
      const raw = await api.storage.get(SAVED_RESULTS_KEY).catch(() => null)
      return raw && typeof raw === 'object' ? { ...raw } : {}
    }

    async function readSaveRequests() {
      const raw = await api.storage.get(SAVE_REQUESTS_KEY).catch(() => null)
      return raw && typeof raw === 'object' ? { ...raw } : {}
    }

    async function readSaveResponses() {
      const raw = await api.storage.get(SAVE_RESPONSES_KEY).catch(() => null)
      return raw && typeof raw === 'object' ? { ...raw } : {}
    }

    async function isAutoSaveEnabled() {
      const raw = await api.storage.get(SETTINGS_KEY).catch(() => null)
      return !!(raw && typeof raw === 'object' ? raw.autoSave !== false : true)
    }

    async function tick() {
      if (ticking) return
      ticking = true
      try {
        const autoSave = await isAutoSaveEnabled()
        // 手动保存请求始终由 background 处理（autoSave 开关不影响手动保存）。
        const reqMap = await readSaveRequests()
        const resMap = await readSaveResponses()
        const reqEntries = Object.entries(reqMap)
          .filter(([k, v]) => k && v && typeof v === 'object' && typeof v.dataUrl === 'string' && String(v.dataUrl).trim())
          .sort((a, b) => Number((a[1] && a[1].at) || 0) - Number((b[1] && b[1].at) || 0))

        let saveChanged = false
        let processed = 0
        for (const [rid, req] of reqEntries) {
          if (processed >= MAX_SAVE_PER_TICK) break

          if (resMap[rid] && resMap[rid].savedPath) {
            delete reqMap[rid]
            saveChanged = true
            continue
          }

          const dataUrl = String(req && req.dataUrl ? req.dataUrl : '').trim()
          if (!dataUrl) {
            delete reqMap[rid]
            saveChanged = true
            continue
          }

          const savedPath = await api.files.saveImageBase64(dataUrl).catch(() => '')
          if (!savedPath) continue

          resMap[rid] = { savedPath: String(savedPath), at: Date.now(), by: 'background' }
          delete reqMap[rid]
          saveChanged = true
          processed++
        }

        if (saveChanged) {
          await api.storage.set(SAVE_REQUESTS_KEY, trimSaveMap(reqMap)).catch(() => {})
          await api.storage.set(SAVE_RESPONSES_KEY, trimSaveMap(resMap)).catch(() => {})
        }

        if (!autoSave) return

        const tasks = await api.task.list(40).catch(() => [])
        if (!Array.isArray(tasks) || !tasks.length) return

        const saved = await readSavedResults()
        let changed = false

        for (const task of tasks) {
          const taskId = String(task && task.id ? task.id : '').trim()
          if (!taskId) continue
          if (saved[taskId] && saved[taskId].savedPath) continue

          const status = String(task && task.status ? task.status : '')
          if (status !== 'succeeded') continue

          const kind = String(task && task.kind ? task.kind : '')
          if (kind !== 'http.request') continue

          const dataUrl = parseTaskImageData(task)
          if (!dataUrl) continue

          const savedPath = await api.files.saveImageBase64(dataUrl).catch(() => '')
          if (!savedPath) continue

          saved[taskId] = {
            savedPath: String(savedPath),
            at: Date.now(),
            by: 'background',
          }
          changed = true
        }

        if (changed) {
          await api.storage.set(SAVED_RESULTS_KEY, trimSavedResults(saved)).catch(() => {})
        }
      } finally {
        ticking = false
      }
    }

    setInterval(() => {
      void tick()
    }, POLL_INTERVAL)
    void tick()
    return
  }

  const STORAGE_KEY = 'settings'
  const BG_SAVED_RESULTS_KEY = 'bgSavedResults'
  const BG_SAVE_REQUESTS_KEY = 'bgSaveRequests'
  const BG_SAVE_RESPONSES_KEY = 'bgSaveResponses'
  const VERSION = 1
  const DEFAULT_PROMPT_HISTORY_LIMIT = 50
  const MAX_PROMPT_HISTORY_LIMIT = 200
  const MAX_BATCH_COUNT = 20
  const TASK_KIND_HTTP_REQUEST = 'http.request'
  const TASK_POLL_INTERVAL = 1200

  const state = {
    loading: true,
    busy: false,
    submitting: false,
    modal: '',
    menuOpen: false,
    taskMenuOpen: false,
    cancelAllArmedUntil: 0,
    revealApiKey: false,
    prompt: '',
    batchCount: '1',
    promptHistory: [],
    promptHistoryIndex: -1,
    promptHistoryDraft: '',
    imageDataUrl: '',
    imageHistory: [],
    imageHistoryIndex: -1,
    savedPath: '',
    currentTaskId: '',
    tasks: [],
    taskPollTimer: null,
    taskPolling: false,
    outputDir: '',
    error: '',
    data: null,
    draft: {
      providerName: '',
      baseUrl: '',
      apiKey: '',
      protocol: 'images',
      modelsText: '',
      size: '1024x1024',
      chatSystemPrompt: '',
      promptHistoryLimit: String(DEFAULT_PROMPT_HISTORY_LIMIT),
      autoSave: true,
    },
  }

  const css = `
    :root{
      --bg:#ffffff; --card:#ffffff; --muted:#6b7280;
      --text:#111827; --line:#e5e7eb; --pri:#2563eb; --bad:#dc2626; --ok:#16a34a;
      --r:12px;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    }
    *{ box-sizing:border-box; }
    html,body{ height:100%; }
    body{ margin:0; background:var(--bg); color:var(--text); }
    .wrap{ height:100vh; display:flex; flex-direction:column; }
    .top{ height:48px; display:flex; align-items:center; gap:8px; padding:0 10px; border-bottom:1px solid var(--line); background:#ffffff; }
    .title{ font-weight:900; font-size:13px; letter-spacing:0.3px; }
    .btn{ height:32px; padding:0 10px; border-radius:10px; border:1px solid var(--line); background:#ffffff; color:var(--text); cursor:pointer; font-size:12px; }
    .btn.stable{ min-width:76px; }
    .btn.pri{ border-color:rgba(37,99,235,0.25); background:rgba(37,99,235,0.08); color:var(--pri); }
    .btn.ok{ border-color:rgba(22,163,74,0.25); background:rgba(22,163,74,0.08); color:var(--ok); }
    .btn.bad{ border-color:rgba(220,38,38,0.25); background:rgba(220,38,38,0.06); color:var(--bad); }
    .btn:disabled{ opacity:0.6; cursor:not-allowed; }
    .btn.icon{ width:32px; padding:0; display:inline-flex; align-items:center; justify-content:center; }
    .btn.icon svg{ width:16px; height:16px; display:block; }
    .content{ flex:1; overflow:auto; padding:12px; }
    .split{ display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; }
    @media (max-width:860px){ .split{ grid-template-columns:1fr; } }
    .card{ background:var(--card); border:1px solid var(--line); border-radius:var(--r); padding:12px; box-shadow: 0 8px 24px rgba(17,24,39,0.06); }
    .row{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .row.nowrap{ flex-wrap:nowrap; }
    .sp{ margin-left:auto; }
    .meta{ font-size:12px; color:var(--muted); margin-top:6px; }
    .field{ width:100%; border:1px solid var(--line); background:#ffffff; color:var(--text); border-radius:10px; padding:9px 10px; font-size:12px; outline:none; }
    .field.sm{ width:auto; min-width: 180px; }
    .row.nowrap .field.sm{ min-width: 140px; }
    .row.nowrap .meta{ white-space:nowrap; }
    .field.xs{ width: 84px; min-width: 84px; }
    .ta{ resize:none; min-height: 180px; }
    .mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .imgBox{
      border:1px dashed var(--line);
      border-radius:12px;
      background:#fafafa;
      height: 100%;
      min-height: 320px;
      display:flex;
      align-items:center;
      justify-content:center;
      overflow:hidden;
      position:relative;
    }
    .imgBox img{ max-width:100%; max-height:100%; display:block; }
    .empty{ color:var(--muted); font-size:12px; padding:18px; text-align:center; }
    .err{ color:var(--bad); font-size:12px; }
    .promptCard{ display:flex; flex-direction:column; gap:10px; min-height:420px; }
    .promptCard .ta{ flex:1; }
    .switch{ position:relative; display:inline-block; width:44px; height:24px; flex:0 0 auto; }
    .switch input{ opacity:0; width:0; height:0; }
    .slider{
      position:absolute; inset:0; cursor:pointer;
      background:#e5e7eb; border-radius:999px; transition: background 0.15s ease;
    }
    .slider:before{
      content:""; position:absolute; left:3px; top:3px;
      width:18px; height:18px; border-radius:999px; background:#fff;
      box-shadow: 0 1px 2px rgba(17,24,39,0.18);
      transition: transform 0.15s ease;
    }
    .switch input:checked + .slider{ background: rgba(22,163,74,0.55); }
    .switch input:checked + .slider:before{ transform: translateX(20px); }
    .switch input:focus-visible + .slider{ outline:2px solid rgba(37,99,235,0.55); outline-offset:2px; }
    .outMenuWrap{ position:relative; }
    .taskMenuWrap{ position:relative; }
    .menu{
      position:absolute;
      top: 36px;
      right: 0;
      min-width: 160px;
      padding: 6px;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 12px;
      box-shadow: 0 10px 24px rgba(17,24,39,0.12);
      z-index: 5;
    }
    .menu .btn{ width:100%; justify-content:flex-start; }
    .menuItem{ display:flex; align-items:center; gap:8px; padding:6px; border-radius:10px; }
    .menuItem:hover{ background:#f9fafb; }
    .overlay{ position:fixed; inset:0; background:rgba(17,24,39,0.18); display:flex; align-items:center; justify-content:center; padding:12px; }
    .modal{ width:min(720px,100%); max-height: calc(100vh - 24px); overflow:auto; background:var(--card); border:1px solid var(--line); border-radius:14px; padding:12px; box-shadow: 0 10px 30px rgba(17,24,39,0.12); }
    .hr{ height:1px; background:var(--line); margin:10px 0; }
    label{ font-size:12px; color:var(--muted); display:block; margin:10px 0 6px; }
    .kbd{ font-size:11px; padding:2px 6px; border:1px solid var(--line); border-bottom-width:2px; border-radius:8px; background:#fff; color:var(--muted); }
  `

  function esc(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
  }

  function trimSlash(s) {
    const v = String(s || '').trim()
    return v.endsWith('/') ? v.slice(0, -1) : v
  }

  function isHttpBaseUrl(s) {
    const raw = String(s || '').trim()
    if (!raw) return false
    try {
      const u = new URL(raw)
      return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.host
    } catch (_) {
      return false
    }
  }

  function parseErrorBody(body) {
    try {
      const j = JSON.parse(String(body || ''))
      const msg = j?.error?.message || j?.message || ''
      if (msg) return String(msg)
    } catch {}
    return String(body || '')
  }

  function now() {
    return Date.now()
  }

  function normalizeBatchCount(raw) {
    const n = Number(raw)
    if (!Number.isFinite(n)) return 1
    const v = Math.floor(n)
    if (v < 1) return 1
    if (v > MAX_BATCH_COUNT) return MAX_BATCH_COUNT
    return v
  }

  function id(prefix) {
    return `${prefix}-${now()}-${Math.random().toString(16).slice(2)}`
  }

  function defaultProvider() {
    return {
      id: id('prov'),
      name: '默认供应商',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      protocol: 'images', // 'images' | 'chat'
      models: ['gpt-image-1'],
      model: 'gpt-image-1',
      customModel: '',
      size: '1024x1024',
      chatSystemPrompt: '',
    }
  }

  function defaultData() {
    const p = defaultProvider()
    return {
      version: VERSION,
      autoSave: true,
      promptHistoryLimit: DEFAULT_PROMPT_HISTORY_LIMIT,
      promptHistory: [],
      pendingTaskId: '',
      activeProviderId: p.id,
      providers: [p],
    }
  }

  function normalizePromptHistoryLimit(raw) {
    const n = Number(raw)
    if (!Number.isFinite(n)) return DEFAULT_PROMPT_HISTORY_LIMIT
    const v = Math.floor(n)
    if (v < 1) return 1
    if (v > MAX_PROMPT_HISTORY_LIMIT) return MAX_PROMPT_HISTORY_LIMIT
    return v
  }

  function normalizePromptHistory(list, limitRaw) {
    const limit = normalizePromptHistoryLimit(limitRaw)
    const raw = Array.isArray(list) ? list : []
    const out = []
    for (const item of raw) {
      const text = String(item || '').trim()
      if (!text) continue
      const existed = out.indexOf(text)
      if (existed >= 0) out.splice(existed, 1)
      out.push(text)
      if (out.length > limit) out.shift()
    }
    return out
  }

  function normalizeModels(list) {
    const raw = Array.isArray(list) ? list : []
    const out = []
    for (const x of raw) {
      const s = String(x || '').trim()
      if (!s) continue
      if (!out.includes(s)) out.push(s)
      if (out.length >= 200) break
    }
    return out
  }

  function normalizeProvider(p) {
    const out = p && typeof p === 'object' ? p : {}
    out.id = String(out.id || id('prov'))
    out.name = String(out.name || '供应商')
    out.baseUrl = trimSlash(String(out.baseUrl || 'https://api.openai.com/v1'))
    out.apiKey = String(out.apiKey || '')
    out.protocol = String(out.protocol || 'images') === 'chat' ? 'chat' : 'images'
    out.models = normalizeModels(out.models)
    out.model = String(out.model || out.models[0] || '')
    out.customModel = String(out.customModel || '')
    out.size = String(out.size || '1024x1024')
    // 空字符串也算用户显式设置：不要用默认值覆盖
    out.chatSystemPrompt = typeof out.chatSystemPrompt === 'string' ? out.chatSystemPrompt : ''
    return out
  }

  function migrateLegacySettingsToData(s) {
    const p = defaultProvider()
    p.name = String(s.providerName || p.name)
    p.baseUrl = trimSlash(String(s.baseUrl || p.baseUrl))
    p.apiKey = String(s.apiKey || '')
    p.protocol = String(s.protocol || 'images') === 'chat' ? 'chat' : 'images'
    p.size = String(s.size || p.size)
    p.chatSystemPrompt = typeof s.chatSystemPrompt === 'string' ? s.chatSystemPrompt : ''
    const m = String(s.model || '').trim()
    if (m) {
      p.models = normalizeModels([m])
      p.model = m
    }
    const out = defaultData()
    out.providers = [p]
    out.activeProviderId = p.id
    out.autoSave = typeof s.autoSave === 'boolean' ? s.autoSave : true
    out.promptHistoryLimit = normalizePromptHistoryLimit(s.promptHistoryLimit)
    out.promptHistory = normalizePromptHistory(s.promptHistory, out.promptHistoryLimit)
    return out
  }

  function normalizeData(raw) {
    if (!raw || typeof raw !== 'object') return defaultData()

    // legacy: 旧版把所有配置直接平铺在 settings 里
    if (!Array.isArray(raw.providers)) {
      return migrateLegacySettingsToData(raw)
    }

    const d = raw
    const out = defaultData()
    out.version = VERSION
    out.autoSave = typeof d.autoSave === 'boolean' ? d.autoSave : true
    out.promptHistoryLimit = normalizePromptHistoryLimit(d.promptHistoryLimit)
    out.promptHistory = normalizePromptHistory(d.promptHistory, out.promptHistoryLimit)
    out.pendingTaskId = String(d.pendingTaskId || '').trim()

    out.providers = Array.isArray(d.providers) ? d.providers.map(normalizeProvider) : defaultData().providers
    if (!out.providers.length) out.providers = defaultData().providers

    const pid = String(d.activeProviderId || '')
    out.activeProviderId = out.providers.some((x) => x.id === pid) ? pid : out.providers[0].id
    return out
  }

  function activeProvider() {
    const d = state.data
    if (!d) return null
    const pid = String(d.activeProviderId || '')
    const ps = Array.isArray(d.providers) ? d.providers : []
    return ps.find((p) => p && p.id === pid) || ps[0] || null
  }

  function resolveModel(p) {
    if (!p) return ''
    const pick = String(p.model || '').trim()
    if (pick === '__custom__') return String(p.customModel || '').trim()
    return pick
  }

  async function save() {
    if (!state.data) return
    await api.storage.set(STORAGE_KEY, state.data)
  }

  async function getBackgroundSavedPath(taskId) {
    const tid = String(taskId || '').trim()
    if (!tid) return ''
    const raw = await api.storage.get(BG_SAVED_RESULTS_KEY).catch(() => null)
    const map = raw && typeof raw === 'object' ? { ...raw } : {}
    const hit = map[tid]
    const path = hit && typeof hit.savedPath === 'string' ? String(hit.savedPath).trim() : ''
    if (!path) return ''
    return path
  }

  function sleepMs(ms) {
    const t = Number(ms)
    const safe = Number.isFinite(t) && t > 0 ? t : 0
    return new Promise((resolve) => setTimeout(resolve, safe))
  }

  async function waitBackgroundSavedPath(taskId, timeoutMs = 4500, intervalMs = 250) {
    const tid = String(taskId || '').trim()
    if (!tid) return ''
    const timeout = Number(timeoutMs)
    const interval = Number(intervalMs)
    const startedAt = Date.now()
    while (Date.now() - startedAt < (Number.isFinite(timeout) && timeout > 0 ? timeout : 0)) {
      const hit = await getBackgroundSavedPath(tid)
      if (hit) return hit
      await sleepMs(Number.isFinite(interval) && interval > 0 ? interval : 250)
    }
    return ''
  }

  async function waitBackgroundSaveResponse(reqId, timeoutMs = 6000, intervalMs = 250) {
    const rid = String(reqId || '').trim()
    if (!rid) return ''
    const timeout = Number(timeoutMs)
    const interval = Number(intervalMs)
    const startedAt = Date.now()
    while (Date.now() - startedAt < (Number.isFinite(timeout) && timeout > 0 ? timeout : 0)) {
      const raw = await api.storage.get(BG_SAVE_RESPONSES_KEY).catch(() => null)
      const map = raw && typeof raw === 'object' ? raw : null
      const hit = map && map[rid] ? map[rid] : null
      const p = hit && typeof hit.savedPath === 'string' ? String(hit.savedPath).trim() : ''
      if (p) return p
      await sleepMs(Number.isFinite(interval) && interval > 0 ? interval : 250)
    }
    return ''
  }

  async function enqueueBackgroundSave(dataUrl) {
    const data = String(dataUrl || '').trim()
    if (!data) return ''
    const rid = `save-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const raw = await api.storage.get(BG_SAVE_REQUESTS_KEY).catch(() => null)
    const map = raw && typeof raw === 'object' ? { ...raw } : {}
    map[rid] = { dataUrl: data, at: Date.now(), by: 'ui' }
    await api.storage.set(BG_SAVE_REQUESTS_KEY, map).catch(() => {})
    return rid
  }

  function syncPromptHistoryToData(persist = false) {
    if (!state.data) return
    state.data.promptHistory = state.promptHistory.slice()
    if (!persist) return
    save().catch(() => {})
  }

  async function load() {
    state.loading = true
    render()

    const saved = await api.storage.get(STORAGE_KEY).catch(() => null)
    state.data = normalizeData(saved)
    state.promptHistory = normalizePromptHistory(state.data && state.data.promptHistory, state.data && state.data.promptHistoryLimit)
    state.promptHistoryIndex = -1
    state.promptHistoryDraft = ''
    // 迁移后立即落盘一次（只改结构，不改变用户意图）
    await save().catch(() => {})

    state.outputDir = await api.files.getOutputDir().catch(() => '')

    state.currentTaskId = ''
    state.busy = false
    state.submitting = false
    state.tasks = []

    const pending = await api.task.list(50).catch(() => [])
    const running = Array.isArray(pending)
      ? pending.filter((t) => {
          const status = String(t && t.status ? t.status : '')
          return !isTaskDone(status)
        })
      : []
    for (const t of running) {
      const tid = String(t && t.id ? t.id : '').trim()
      if (!tid) continue
      upsertTask({ id: tid, status: String(t.status || '') })
    }

    const savedPendingTaskId = String(state.data && state.data.pendingTaskId ? state.data.pendingTaskId : '').trim()
    if (savedPendingTaskId && !running.some((t) => String(t && t.id ? t.id : '').trim() === savedPendingTaskId)) {
      if (state.data) {
        state.data.pendingTaskId = ''
        await save().catch(() => {})
      }
    }

    state.loading = false
    render()
    await refreshImageHistoryFromOutputDir()
    if (getActiveTasks().length) pollTasks()
  }

  function stripCodeFences(s) {
    const raw = String(s || '').trim()
    if (!raw) return ''
    if (raw.startsWith('```')) {
      const i = raw.indexOf('\n')
      const j = raw.lastIndexOf('```')
      if (i >= 0 && j > i) return raw.slice(i + 1, j).trim()
    }
    return raw
  }

  function extractImageFromText(text) {
    const s = String(text || '').trim()
    if (!s) return ''

    const dataUrlMatch = s.match(/data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\r\n]+/i)
    if (dataUrlMatch && dataUrlMatch[0]) return dataUrlMatch[0]

    const maybeJson = stripCodeFences(s)
    try {
      const j = JSON.parse(maybeJson)
      const dataUrl = j?.data_url || j?.dataUrl || j?.image || j?.image_data_url
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) return dataUrl.trim()
      const b64 = j?.b64_png || j?.b64_json || j?.b64 || j?.base64 || j?.image_base64 || j?.png_base64
      if (typeof b64 === 'string' && b64.trim()) return `data:image/png;base64,${b64.trim()}`
    } catch {}

    if (/^[A-Za-z0-9+/=\r\n]+$/.test(s) && s.length > 200) {
      return `data:image/png;base64,${s.replace(/\s+/g, '')}`
    }

    return ''
  }

  function isTaskDone(status) {
    return status === 'succeeded' || status === 'failed' || status === 'canceled'
  }

  function stopTaskPolling() {
    if (state.taskPollTimer) {
      clearTimeout(state.taskPollTimer)
      state.taskPollTimer = null
    }
    state.taskPolling = false
  }

  function upsertTask(item) {
    const t = item && typeof item === 'object' ? item : {}
    const id = String(t.id || '').trim()
    if (!id) return
    const status = String(t.status || '').trim() || 'pending'
    const prompt = typeof t.prompt === 'string' ? t.prompt : ''
    const at = typeof t.at === 'number' ? t.at : Date.now()

    const list = Array.isArray(state.tasks) ? state.tasks : []
    const idx = list.findIndex((x) => x && x.id === id)
    const next = { id, status, prompt, at }
    if (idx >= 0) list[idx] = { ...list[idx], ...next }
    else list.unshift(next)
    state.tasks = list.slice(0, 50)
  }

  function removeTask(taskId) {
    const tid = String(taskId || '').trim()
    if (!tid) return
    state.tasks = (Array.isArray(state.tasks) ? state.tasks : []).filter((x) => x && x.id !== tid)
  }

  function getActiveTasks() {
    const list = Array.isArray(state.tasks) ? state.tasks : []
    return list.filter((t) => t && !isTaskDone(String(t.status || '')))
  }

  function markTaskCanceling(taskId) {
    const tid = String(taskId || '').trim()
    if (!tid) return
    upsertTask({ id: tid, status: 'canceling' })
  }

  async function pollTasks() {
    if (state.taskPolling) return
    const active = getActiveTasks()
    if (!active.length) {
      stopTaskPolling()
      return
    }

    state.taskPolling = true
    try {
      const infos = await Promise.all(
        active.map((t) => api.task.get(String(t.id || '')).catch(() => null)),
      )

      for (const info of infos) {
        if (!info) continue
        const tid = String(info.id || '').trim()
        if (!tid) continue
        upsertTask({ id: tid, status: String(info.status || '') })
        const st = String(info.status || '')
        if (isTaskDone(st)) {
          await applyTaskCompletion(info)
          removeTask(tid)
        }
      }

      render()
    } finally {
      state.taskPolling = false
      if (getActiveTasks().length) {
        state.taskPollTimer = setTimeout(() => {
          pollTasks()
        }, TASK_POLL_INTERVAL)
      }
    }
  }

  async function applyTaskCompletion(task) {
    const status = String(task?.status || '')
    if (status === 'succeeded') {
      try {
        const taskId = String(task && task.id ? task.id : '').trim()

        const bgSavedPath = state.data && state.data.autoSave ? await getBackgroundSavedPath(taskId) : ''
        if (bgSavedPath) {
          state.savedPath = bgSavedPath
          await refreshImageHistoryFromOutputDir(state.savedPath)
          api.ui.showToast('已生成并保存')
          return
        }

        const r = task && task.result && typeof task.result === 'object' ? task.result : {}
        const httpStatus = Number(r.status)
        const bodyText = typeof r.body === 'string' ? r.body : ''
        if (!Number.isFinite(httpStatus)) {
          throw new Error('请求失败：无响应')
        }
        if (httpStatus < 200 || httpStatus >= 300) {
          throw new Error(`HTTP ${httpStatus}：${parseErrorBody(bodyText)}`)
        }

        const j = JSON.parse(String(bodyText || '{}'))
        const item = (Array.isArray(j?.data) && j.data[0]) || (Array.isArray(j?.images) && j.images[0]) || null
        const b64 = item?.b64_json || item?.b64 || item?.base64 || ''
        const direct =
          typeof item?.data_url === 'string'
            ? item.data_url
            : typeof item?.dataUrl === 'string'
              ? item.dataUrl
              : ''
        const content =
          (Array.isArray(j?.choices) && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || ''
        const dataUrl =
          (direct && String(direct).trim()) ||
          (b64 && `data:image/png;base64,${String(b64).trim()}`) ||
          extractImageFromText(content)

        if (!dataUrl) {
          if (item?.url) {
            throw new Error('服务端返回 url（宿主无法下载二进制）。请配置为返回 base64（b64_json / b64_png / data_url）。')
          }
          throw new Error('未拿到图片数据（b64_json）')
        }

        const generatedDataUrl = String(dataUrl).trim()
        if (state.data && state.data.autoSave) {
          // 让 background 成为单一写入者：UI 只展示图片，并等待 background 写入完成后刷新 savedPath。
          state.imageDataUrl = generatedDataUrl
          state.savedPath = ''
          render()

          const waited = await waitBackgroundSavedPath(taskId, 6000, 250)
          if (waited) {
            state.savedPath = String(waited || '')
            await refreshImageHistoryFromOutputDir(state.savedPath)
            api.ui.showToast('已生成并保存')
            return
          }

          api.ui.showToast('已生成（后台保存中…）')
        } else {
          state.imageDataUrl = generatedDataUrl
          render()
          api.ui.showToast('已生成')
        }
        return
      } catch (e) {
        setError(String(e?.message || e))
        return
      }
    }

    if (status === 'canceled') {
      api.ui.showToast('任务已取消')
      return
    }

    const err = String(task?.error || '').trim()
    setError(err || '生成失败')
  }

  function openSettings() {
    const p = activeProvider()
    if (!p) return
    state.modal = 'settings'
    state.revealApiKey = false
    state.draft.providerName = String(p.name || '')
    state.draft.baseUrl = String(p.baseUrl || '')
    state.draft.apiKey = String(p.apiKey || '')
    state.draft.protocol = String(p.protocol || 'images') === 'chat' ? 'chat' : 'images'
    state.draft.modelsText = Array.isArray(p.models) ? p.models.join('\n') : ''
    state.draft.size = String(p.size || '1024x1024')
    state.draft.chatSystemPrompt = typeof p.chatSystemPrompt === 'string' ? p.chatSystemPrompt : ''
    // 插件本体设置请走单独入口
    render()
  }

  function openPluginSettings() {
    if (!state.data) return
    state.modal = 'plugin-settings'
    state.revealApiKey = false
    state.draft.promptHistoryLimit = String(normalizePromptHistoryLimit(state.data.promptHistoryLimit))
    state.draft.autoSave = !!state.data.autoSave
    render()
  }

  function parseModelsText(text) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((x) => String(x || '').trim())
      .filter((x) => !!x)
    return normalizeModels(lines)
  }

  function applyDraftProviderToActiveProvider() {
    if (!state.data) return { ok: false, error: '内部状态缺失' }
    const p = activeProvider()
    if (!p) return { ok: false, error: '未选择供应商' }

    const name = String(state.draft.providerName || '').trim() || '供应商'
    const baseUrl = trimSlash(String(state.draft.baseUrl || ''))
    const apiKey = String(state.draft.apiKey || '').trim()
    const protocol = String(state.draft.protocol || 'images') === 'chat' ? 'chat' : 'images'
    const models = parseModelsText(state.draft.modelsText)

    if (baseUrl && !isHttpBaseUrl(baseUrl)) return { ok: false, error: `Base URL 无效：${baseUrl}` }

    p.name = name
    p.baseUrl = baseUrl || p.baseUrl
    p.apiKey = apiKey
    p.protocol = protocol
    p.models = models
    p.size = String(state.draft.size || p.size || '1024x1024')
    // 允许空字符串：用户可能希望完全不加 system prompt
    p.chatSystemPrompt = typeof state.draft.chatSystemPrompt === 'string' ? state.draft.chatSystemPrompt : ''

    // 如果当前选中的 model 不在 models 里，则回退到第一个；为空则切到自定义
    const cur = String(p.model || '').trim()
    const resolved = cur === '__custom__' ? String(p.customModel || '').trim() : cur
    if (resolved && models.includes(resolved)) {
      p.model = resolved
      p.customModel = ''
    } else if (models.length) {
      p.model = models[0]
      p.customModel = ''
    } else {
      p.model = '__custom__'
      if (!String(p.customModel || '').trim()) p.customModel = resolved || ''
    }

    return { ok: true, error: '' }
  }

  function applyDraftPluginSettings() {
    if (!state.data) return { ok: false, error: '内部状态缺失' }
    state.data.autoSave = !!state.draft.autoSave
    state.data.promptHistoryLimit = normalizePromptHistoryLimit(state.draft.promptHistoryLimit)
    trimPromptHistoryToLimit()
    syncPromptHistoryToData(false)
    return { ok: true, error: '' }
  }

  function setError(msg) {
    state.error = String(msg || '')
    render()
  }

  function clearResult() {
    state.imageDataUrl = ''
    state.imageHistoryIndex = -1
    state.savedPath = ''
    state.error = ''
    render()
  }

  function clearPromptHistory() {
    state.promptHistory = []
    state.promptHistoryIndex = -1
    state.promptHistoryDraft = ''
    syncPromptHistoryToData(true)
  }

  function addPromptHistory(prompt) {
    const text = String(prompt || '').trim()
    if (!text) return

    const existed = state.promptHistory.indexOf(text)
    if (existed >= 0) state.promptHistory.splice(existed, 1)

    state.promptHistory.push(text)
    trimPromptHistoryToLimit()
    state.promptHistoryIndex = -1
    state.promptHistoryDraft = ''
    syncPromptHistoryToData(true)
  }

  function trimPromptHistoryToLimit() {
    const limit = normalizePromptHistoryLimit(state.data && state.data.promptHistoryLimit)
    if (state.promptHistory.length <= limit) return
    state.promptHistory = state.promptHistory.slice(state.promptHistory.length - limit)
    state.promptHistoryIndex = -1
    state.promptHistoryDraft = ''
    syncPromptHistoryToData(false)
  }

  function canSwitchPromptPrev() {
    if (!state.promptHistory.length) return false
    return state.promptHistoryIndex === -1 || state.promptHistoryIndex > 0
  }

  function canSwitchPromptNext() {
    if (!state.promptHistory.length) return false
    if (state.promptHistoryIndex === -1) return false
    if (state.promptHistoryIndex < state.promptHistory.length - 1) return true
    const draft = String(state.promptHistoryDraft || '').trim()
    const latest = String(state.promptHistory[state.promptHistory.length - 1] || '').trim()
    return draft !== latest
  }

  function switchPromptHistory(direction) {
    if (!state.promptHistory.length) return
    const step = direction < 0 ? -1 : 1

    if (step < 0 && state.promptHistoryIndex === -1) {
      state.promptHistoryDraft = String(state.prompt || '')
      state.promptHistoryIndex = state.promptHistory.length - 1
      state.prompt = String(state.promptHistory[state.promptHistoryIndex] || '')
      render()
      return
    }

    if (step > 0 && state.promptHistoryIndex === -1) return

    const next = state.promptHistoryIndex + step
    if (next < 0) return
    if (next >= state.promptHistory.length) {
      const draft = String(state.promptHistoryDraft || '').trim()
      const latest = String(state.promptHistory[state.promptHistory.length - 1] || '').trim()
      if (draft === latest) {
        state.promptHistoryIndex = state.promptHistory.length - 1
        state.prompt = String(state.promptHistory[state.promptHistoryIndex] || '')
        render()
        return
      }
      state.promptHistoryIndex = -1
      state.prompt = state.promptHistoryDraft
      state.promptHistoryDraft = ''
      render()
      return
    }

    state.promptHistoryIndex = next
    state.prompt = String(state.promptHistory[next] || '')
    render()
  }

  function syncPromptNavigationWithCurrentInput() {
    const current = String(state.prompt || '')
    if (!state.promptHistory.length) {
      state.promptHistoryIndex = -1
      state.promptHistoryDraft = current
      return
    }

    const latestIndex = state.promptHistory.length - 1
    const latest = String(state.promptHistory[latestIndex] || '')
    if (current.trim() && current.trim() === latest.trim()) {
      state.promptHistoryIndex = latestIndex
      state.promptHistoryDraft = latest
      return
    }

    state.promptHistoryIndex = -1
    state.promptHistoryDraft = current
  }

  async function applyImageHistoryIndex(index) {
    if (index < 0 || index >= state.imageHistory.length) return
    const item = state.imageHistory[index]
    if (!item) return
    state.imageHistoryIndex = index
    state.imageDataUrl = String(item.dataUrl || '')
    state.savedPath = String(item.savedPath || '')
    if (state.imageDataUrl) {
      render()
      return
    }

    const loaded = await api.files.readOutputImage(state.savedPath).catch(() => '')
    if (!loaded) {
      render()
      return
    }

    if (state.imageHistoryIndex !== index) return
    item.dataUrl = String(loaded).trim()
    state.imageDataUrl = item.dataUrl
    render()
  }

  function canSwitchImagePrev() {
    if (!state.imageHistory.length) return false
    return state.imageHistoryIndex === -1 || state.imageHistoryIndex > 0
  }

  function canSwitchImageNext() {
    return state.imageHistory.length > 0 && state.imageHistoryIndex >= 0 && state.imageHistoryIndex < state.imageHistory.length - 1
  }

  async function switchImageHistory(direction) {
    if (!state.imageHistory.length) return
    const step = direction < 0 ? -1 : 1
    if (step < 0 && state.imageHistoryIndex === -1) {
      await applyImageHistoryIndex(state.imageHistory.length - 1)
      return
    }

    const next = state.imageHistoryIndex + step
    if (next < 0 || next >= state.imageHistory.length) return
    await applyImageHistoryIndex(next)
  }

  async function refreshImageHistoryFromOutputDir(preferPath = '') {
    const paths = await api.files.listOutputImages().catch(() => [])
    const list = (Array.isArray(paths) ? paths : []).map((x) => String(x || '').trim()).filter((x) => !!x)

    // listOutputImages 返回最新在前，这里翻转成“最旧 -> 最新”，与左右切换习惯保持一致。
    state.imageHistory = list.reverse().map((savedPath) => ({ dataUrl: '', savedPath }))

    if (!state.imageHistory.length) {
      state.imageHistoryIndex = -1
      state.imageDataUrl = ''
      state.savedPath = ''
      render()
      return
    }

    let target = String(preferPath || '').trim()
    if (!target) target = String(state.savedPath || '').trim()

    let index = state.imageHistory.length - 1
    if (target) {
      const found = state.imageHistory.findIndex((it) => String(it.savedPath || '') === target)
      if (found >= 0) index = found
    }

    await applyImageHistoryIndex(index)
  }

  async function pickOutputDir() {
    const picked = await api.files.pickOutputDir().catch((e) => {
      api.ui.showToast(`选择目录失败：${String(e?.message || e)}`)
      return null
    })
    if (!picked) return
    state.outputDir = picked
    api.ui.showToast('输出目录已更新')
    await refreshImageHistoryFromOutputDir()
  }

  async function openOutputDir() {
    await api.files.openOutputDir().catch((e) => api.ui.showToast(`打开目录失败：${String(e?.message || e)}`))
  }

  async function deleteCurrentImage() {
    const path = String(state.savedPath || '').trim()
    if (!path) {
      state.menuOpen = false
      render()
      api.ui.showToast('未保存，无法删除')
      return
    }

    state.menuOpen = false
    render()

    await api.files
      .deleteOutputImage(path)
      .then(async () => {
        api.ui.showToast('已删除图片')
        state.savedPath = ''
        await refreshImageHistoryFromOutputDir()
      })
      .catch((e) => api.ui.showToast(`删除失败：${String(e?.message || e)}`))
  }

  async function saveImageNow() {
    if (!state.imageDataUrl) return
    if (state.data && state.data.autoSave) {
      api.ui.showToast('已开启自动保存，无需手动保存')
      return
    }
    const rid = await enqueueBackgroundSave(state.imageDataUrl).catch(() => '')
    if (!rid) return api.ui.showToast('保存失败：无法发起后台保存')
    api.ui.showToast('已请求后台保存…')
    const p = await waitBackgroundSaveResponse(rid).catch(() => '')
    if (!p) return
    state.savedPath = p
    await refreshImageHistoryFromOutputDir(state.savedPath)
    api.ui.showToast('已保存图片')
  }

  async function copyImage() {
    if (!state.imageDataUrl) return
    await api.clipboard.writeImage(state.imageDataUrl).then(
      () => api.ui.showToast('已复制图片到剪贴板'),
      (e) => api.ui.showToast(`复制失败：${String(e?.message || e)}`),
    )
  }

  async function generate() {
    const prompt = String(state.prompt || '').trim()
    if (!prompt) {
      setError('请输入提示词')
      return
    }

    const p = activeProvider()
    const baseUrl = trimSlash(String(p?.baseUrl || ''))
    const apiKey = String(p?.apiKey || '').trim()
    if (!isHttpBaseUrl(baseUrl)) {
      openSettings()
      setError('请先在设置里配置 Base URL（http:// 或 https://）')
      return
    }
    if (!apiKey) {
      openSettings()
      setError('请先在设置里填写 API Key')
      return
    }
    const model = resolveModel(p)
    if (!model) {
      openSettings()
      setError('请先配置模型')
      return
    }

    const rawBatch = String(state.batchCount || '')
    const batch = normalizeBatchCount(rawBatch)
    if (String(batch) !== rawBatch.trim()) state.batchCount = String(batch)

    state.submitting = true
    state.error = ''
    addPromptHistory(prompt)
    render()

    const protocol = String(p?.protocol || 'images') === 'chat' ? 'chat' : 'images'
    const req = {
      mode: 'task',
      method: 'POST',
      url: protocol === 'chat' ? `${baseUrl}/chat/completions` : `${baseUrl}/images/generations`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(
        protocol === 'chat'
          ? {
              model,
              messages: [
                ...(String(p?.chatSystemPrompt || '').trim()
                  ? [{ role: 'system', content: String(p?.chatSystemPrompt || '').trim() }]
                  : []),
                { role: 'user', content: prompt },
              ],
              temperature: 0.2,
            }
          : {
              model,
              prompt,
              size: String(p?.size || '').trim() || '1024x1024',
              n: 1,
              response_format: 'b64_json',
            },
      ),
      timeoutMs: 120000,
    }

    try {
      const results = await Promise.allSettled(
        Array.from({ length: batch }, () => api.net.request({ ...req })),
      )

      const ids = []
      let failed = 0
      for (const r of results) {
        if (r.status !== 'fulfilled') {
          failed++
          continue
        }
        const taskId = String(r.value && r.value.id ? r.value.id : '').trim()
        if (!taskId) {
          failed++
          continue
        }
        ids.push(taskId)
        upsertTask({ id: taskId, status: 'pending', prompt, at: Date.now() })
      }

      if (!ids.length) throw new Error('创建后台任务失败')
      if (failed) api.ui.showToast(`部分任务创建失败：${failed} 个`)

      if (state.data) {
        state.data.pendingTaskId = ids[ids.length - 1]
        await save().catch(() => {})
      }
      state.submitting = false
      render()
      pollTasks()
    } catch (e) {
      state.submitting = false
      setError(String(e?.message || e))
      render()
    }
  }

  function view() {
    const d = state.data
    const p = activeProvider()
    const ps = d && Array.isArray(d.providers) ? d.providers : []
    const pid = d ? String(d.activeProviderId || '') : ''
    const providerOptions = ps
      .map((x) => `<option value="${esc(x.id)}" ${x.id === pid ? 'selected' : ''}>${esc(x.name)}</option>`)
      .join('')

    const isChat = String(p?.protocol || 'images') === 'chat'
    const activeTasks = getActiveTasks()
    const activeTaskCount = activeTasks.length
    const canPromptPrev = canSwitchPromptPrev()
    const canPromptNext = canSwitchPromptNext()
    const canImagePrev = canSwitchImagePrev()
    const canImageNext = canSwitchImageNext()
    const imageCount = state.imageHistory.length
    const currentImageIndex = state.imageHistoryIndex >= 0 ? state.imageHistoryIndex + 1 : 0
    const imageIndexText = `${currentImageIndex}/${imageCount}`

    const img =
      state.imageDataUrl
        ? `<div class="imgBox" aria-label="生成结果"><img alt="AI 绘图结果" src="${esc(state.imageDataUrl)}" /></div>`
        : `<div class="imgBox" aria-label="空结果"><div class="empty">等待出图…<div style="margin-top:10px">提示：结果默认会保存到 <span class="mono">data/ai-draw/output-images</span></div></div></div>`

    const saved = state.savedPath
      ? `<div class="meta mono" title="${esc(state.savedPath)}">已保存：${esc(state.savedPath)}</div>`
      : `<div class="meta">未保存（或尚未生成）</div>`

    const err = state.error ? `<div class="err" role="alert">${esc(state.error)}</div>` : ''

    const modal =
      state.modal === 'settings'
        ? `
      <div class="overlay" data-act="close-modal">
        <div class="modal" role="dialog" aria-modal="true" aria-label="供应商设置">
          <div class="row">
            <div class="title" style="margin:0">供应商设置（OpenAI 兼容）</div>
            <div class="sp"></div>
            <select class="field sm" data-bind="activeProviderId" aria-label="生效供应商">${providerOptions}</select>
            <button class="btn" data-act="add-provider">新增</button>
            <button class="btn bad" data-act="delete-provider" ${ps.length <= 1 ? 'disabled' : ''}>删除</button>
            <button class="btn" data-act="close-modal">关闭</button>
          </div>
          <div class="hr"></div>

          <label>供应商名称（可选）</label>
          <input class="field" data-bind="providerName" placeholder="例如：OpenAI / DeepSeek / 本地网关" value="${esc(state.draft.providerName)}" />

          <label>Base URL</label>
          <input class="field mono" data-bind="baseUrl" placeholder="https://api.openai.com/v1" value="${esc(state.draft.baseUrl)}" />

          <label>API Key</label>
          <div class="row">
            <input class="field mono" style="flex:1; min-width:240px" type="${state.revealApiKey ? 'text' : 'password'}" data-bind="apiKey" placeholder="sk-..." value="${esc(state.draft.apiKey)}" />
            <button class="btn icon" data-act="toggle-api-key" aria-label="${state.revealApiKey ? '隐藏 API Key' : '查看 API Key'}" aria-pressed="${state.revealApiKey ? 'true' : 'false'}">
              ${
                state.revealApiKey
                  ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                      <path d="M2 2l20 20"></path>
                    </svg>`
                  : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>`
              }
            </button>
          </div>

          <label>协议</label>
          <select class="field" data-bind="protocol" aria-label="协议">
            <option value="images" ${String(state.draft.protocol) === 'chat' ? '' : 'selected'}>图片生成（/images/generations）</option>
            <option value="chat" ${String(state.draft.protocol) === 'chat' ? 'selected' : ''}>聊天补全（/chat/completions）</option>
          </select>

          <label>模型列表（每行一个）</label>
          <textarea class="field ta mono" data-bind="modelsText" placeholder="例如：\ngpt-image-1\ndall-e-3">${esc(state.draft.modelsText)}</textarea>

          ${
            String(state.draft.protocol) === 'chat'
              ? `
          <label>聊天系统提示词（chat 专用）</label>
          <textarea class="field ta mono" data-bind="chatSystemPrompt" placeholder="要求模型返回 base64 图片...">${esc(
            state.draft.chatSystemPrompt || '',
          )}</textarea>
          <div class="meta">建议让服务端只输出 JSON：{"b64_png":"..."} 或 data:image/png;base64,...（否则很难稳定解析）。</div>
          `
              : `
          <label>尺寸（images 专用）</label>
          <select class="field" data-bind="size" aria-label="尺寸">
            ${['1024x1024', '1024x1536', '1536x1024', '512x512'].map((x) => `<option value="${x}" ${String(state.draft.size) === x ? 'selected' : ''}>${x}</option>`).join('')}
          </select>
          `
          }

          <div class="hr"></div>
          <div class="row">
            <button class="btn pri" data-act="save-provider-settings">保存供应商设置</button>
            <div class="sp"></div>
          </div>
        </div>
      </div>`
        : state.modal === 'plugin-settings'
          ? `
      <div class="overlay" data-act="close-modal">
        <div class="modal" role="dialog" aria-modal="true" aria-label="插件设置">
          <div class="row">
            <div class="title" style="margin:0">插件设置</div>
            <div class="sp"></div>
            <button class="btn pri" data-act="save-plugin-settings">保存插件设置</button>
            <button class="btn" data-act="close-modal">关闭</button>
          </div>
          <div class="hr"></div>

          <div class="row" style="margin-top:10px">
            <label for="ai-draw-autoSaveSwitch" style="margin:0; color:var(--muted); font-size:12px">生成后自动保存到输出目录</label>
            <div class="sp"></div>
            <label class="switch" aria-label="自动保存开关">
              <input id="ai-draw-autoSaveSwitch" type="checkbox" data-bind="autoSave" ${state.draft.autoSave ? 'checked' : ''} />
              <span class="slider" aria-hidden="true"></span>
            </label>
          </div>

          <label>提示词历史条数（1-${MAX_PROMPT_HISTORY_LIMIT}）</label>
          <input class="field sm" data-bind="promptHistoryLimit" type="number" min="1" max="${MAX_PROMPT_HISTORY_LIMIT}" step="1" value="${esc(state.draft.promptHistoryLimit)}" />

          <div class="hr"></div>
          <div class="row">
            <button class="btn" data-act="pick-output-dir">选择输出目录</button>
            <button class="btn" data-act="open-output-dir">打开输出目录</button>
          </div>
          <div class="meta mono" title="${esc(state.outputDir || '')}">当前输出：${esc(state.outputDir || '未设置')}</div>
          <div class="meta">输出目录会保存在宿主配置里（不是插件可随意写文件）。</div>
        </div>
      </div>`
          : ''

    const model = resolveModel(p)
    const models = p && Array.isArray(p.models) ? p.models : []
    const modelOptions = models
      .map((m) => `<option value="${esc(m)}" ${m === String(p.model || '') ? 'selected' : ''}>${esc(m)}</option>`)
      .join('')
    const showCustom = String(p?.model || '') === '__custom__' || (!models.length && !String(p?.model || '').trim())

    return `
      <style>${css}</style>
      <div class="wrap">
        <div class="top">
          <div class="title">AI 绘图</div>
          <button class="btn" data-act="open-output-dir" ${state.outputDir ? '' : 'disabled'}>打开输出目录</button>
          <span class="kbd mono" aria-label="自动保存开关状态">自动保存：${d && d.autoSave ? '开' : '关'}</span>
          <div class="taskMenuWrap">
            <button class="btn" data-act="toggle-task-menu" aria-expanded="${state.taskMenuOpen ? 'true' : 'false'}">任务${activeTaskCount ? `(${activeTaskCount})` : ''}</button>
            <button class="btn bad" data-act="cancel-all-tasks" ${activeTaskCount ? '' : 'disabled'} title="取消所有进行中的任务">全部取消</button>
            ${
              state.taskMenuOpen
                ? `<div class="menu" role="menu" aria-label="任务列表">
                    ${
                      activeTasks.length
                        ? activeTasks
                            .map(
                              (t) => `<div class="menuItem">
                                <span class="meta mono" style="margin-top:0" title="${esc(String(t.id || ''))}">#${esc(String(t.id || '').slice(-6))} ${esc(String(t.status || ''))}</span>
                                <div class="sp"></div>
                                <button class="btn bad" data-act="cancel-task" data-task-id="${esc(String(t.id || ''))}">取消</button>
                              </div>`,
                            )
                            .join('')
                        : `<div class="meta" style="margin:6px 8px">无进行中任务</div>`
                    }
                  </div>`
                : ''
            }
          </div>
          <div class="sp"></div>
          <select class="field sm" data-bind="activeProviderId" aria-label="供应商">${providerOptions}</select>
          <button class="btn" data-act="open-settings">供应商设置</button>
          <button class="btn" data-act="open-plugin-settings">插件设置</button>
          <button class="btn" data-act="pick-output-dir">输出目录</button>
        </div>

        <div class="content">
          ${state.loading ? `<div class="empty">加载中…</div>` : `
          <div class="split">
            <div class="card promptCard">
              <div class="row nowrap">
                <button class="btn pri stable" data-act="generate" ${state.submitting ? 'disabled' : ''}>${state.submitting ? '提交中…' : '生成'}</button>
                <input class="field xs" data-bind="batchCount" type="number" min="1" max="${MAX_BATCH_COUNT}" step="1" value="${esc(state.batchCount)}" aria-label="批量次数" title="批量次数（并行提交）" />
                <button class="btn" data-act="prompt-prev" ${canPromptPrev ? '' : 'disabled'} aria-label="上一条提示词">←</button>
                <button class="btn" data-act="prompt-next" ${canPromptNext ? '' : 'disabled'} aria-label="下一条提示词">→</button>
                <div class="sp"></div>
                <span class="meta" style="margin-top:0">模型：</span>
                <select class="field sm" data-bind="activeModel" aria-label="模型">
                  ${modelOptions}
                  <option value="__custom__" ${String(p?.model || '') === '__custom__' ? 'selected' : ''}>自定义…</option>
                </select>
              </div>
              ${
                showCustom
                  ? `<input class="field mono" data-bind="activeCustomModel" placeholder="输入模型 ID…" value="${esc(
                      String(p?.customModel || model || ''),
                    )}" />`
                  : ''
              }
              <textarea class="field ta" data-bind="prompt" placeholder="例如：赛博朋克城市夜景，雨，霓虹灯，电影感，高细节…">${esc(state.prompt)}</textarea>
              <div>${err}</div>
            </div>

            <div class="card" style="display:flex; flex-direction:column; gap:10px; min-height:420px;">
              <div class="row">
                <div class="meta">输出</div>
                <div class="sp"></div>
                <span class="meta" aria-label="图片历史计数">${imageIndexText}</span>
                <button class="btn" data-act="image-prev" ${canImagePrev ? '' : 'disabled'} aria-label="上一张图片">←</button>
                <button class="btn" data-act="image-next" ${canImageNext ? '' : 'disabled'} aria-label="下一张图片">→</button>
                ${d && d.autoSave ? '' : `<button class="btn ok" data-act="save-image" ${state.imageDataUrl ? '' : 'disabled'}>保存</button>`}
                <button class="btn" data-act="copy-image" ${state.imageDataUrl ? '' : 'disabled'}>复制图片</button>
                <div class="outMenuWrap">
                  <button class="btn icon" data-act="toggle-output-menu" aria-label="更多操作" aria-expanded="${state.menuOpen ? 'true' : 'false'}">
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <circle cx="12" cy="5" r="2"></circle>
                      <circle cx="12" cy="12" r="2"></circle>
                      <circle cx="12" cy="19" r="2"></circle>
                    </svg>
                  </button>
                  ${
                    state.menuOpen
                      ? `<div class="menu" role="menu" aria-label="输出菜单">
                          <button class="btn bad" data-act="delete-current-image">删除当前图片</button>
                        </div>`
                      : ''
                  }
                </div>
              </div>
              <div style="flex:1; min-height:0;">${img}</div>
              ${saved}
            </div>
          </div>
          `}
        </div>
        ${modal}
      </div>
    `
  }

  function render() {
    const root = document.getElementById('app')
    if (!root) return
    root.innerHTML = view()
  }

  function bindEvents() {
    const root = document.getElementById('app') || document
    root.addEventListener('click', (e) => {
      const raw = e.target
      const node = raw && raw.nodeType === 3 ? raw.parentElement : raw
      if (!node || !node.closest) return

      let closedMenu = false
      if (state.menuOpen && !node.closest('.outMenuWrap')) {
        state.menuOpen = false
        closedMenu = true
      }
      if (state.taskMenuOpen && !node.closest('.taskMenuWrap')) {
        state.taskMenuOpen = false
        closedMenu = true
      }

      // 关键：在 modal 内部点击时，不要“穿透”到 overlay 的 data-act
      const el = node.closest('.modal') ? node.closest('.modal [data-act]') : node.closest('[data-act]')
      if (!el) {
        if (closedMenu) render()
        return
      }

      const act = el.getAttribute('data-act')
      if (!act) return

      if (act === 'open-settings') {
        openSettings()
      } else if (act === 'close-modal') {
        state.modal = ''
        state.revealApiKey = false
        render()
      } else if (act === 'open-plugin-settings') {
        openPluginSettings()
      } else if (act === 'toggle-api-key') {
        state.revealApiKey = !state.revealApiKey
        render()
      } else if (act === 'toggle-task-menu') {
        state.taskMenuOpen = !state.taskMenuOpen
        render()
      } else if (act === 'cancel-task') {
        const tid = String(el.getAttribute('data-task-id') || '').trim()
        if (!tid) return
        markTaskCanceling(tid)
        render()
        api.task
          .cancel(tid)
          .then((info) => {
            removeTask(String(info && info.id ? info.id : tid))
            render()
            api.ui.showToast('已取消')
          })
          .catch((e) => api.ui.showToast(`取消失败：${String(e?.message || e)}`))
      } else if (act === 'cancel-all-tasks') {
        const list = getActiveTasks()
        if (!list.length) return api.ui.showToast('没有进行中任务')
        const now = Date.now()
        if (!(Number.isFinite(state.cancelAllArmedUntil) && state.cancelAllArmedUntil > now)) {
          state.cancelAllArmedUntil = now + 4000
          api.ui.showToast('再次点击“全部取消”以确认')
          return
        }
        state.cancelAllArmedUntil = 0
        state.taskMenuOpen = false
        for (const t of list) markTaskCanceling(String(t.id || ''))
        render()
        Promise.allSettled(list.map((t) => api.task.cancel(String(t.id || '')))).then((results) => {
          let failed = 0
          for (const r of results) {
            if (r.status === 'fulfilled') removeTask(String(r.value && r.value.id ? r.value.id : ''))
            else failed++
          }
          render()
          api.ui.showToast(failed ? `已取消（失败 ${failed} 个）` : '已取消所有任务')
        })
      } else if (act === 'toggle-output-menu') {
        state.menuOpen = !state.menuOpen
        render()
      } else if (act === 'delete-current-image') {
        deleteCurrentImage()
      } else if (act === 'generate') {
        generate()
      } else if (act === 'prompt-prev') {
        switchPromptHistory(-1)
      } else if (act === 'prompt-next') {
        switchPromptHistory(1)
      } else if (act === 'pick-output-dir') {
        pickOutputDir()
      } else if (act === 'open-output-dir') {
        openOutputDir()
      } else if (act === 'image-prev') {
        switchImageHistory(-1)
      } else if (act === 'image-next') {
        switchImageHistory(1)
      } else if (act === 'save-image') {
        saveImageNow()
      } else if (act === 'copy-image') {
        copyImage()
      } else if (act === 'save-settings') {
        const r = applyDraftProviderToActiveProvider()
        if (!r.ok) return api.ui.showToast(r.error || '保存失败')
        save()
          .then(() => api.ui.showToast('设置已保存'))
          .then(() => render())
          .catch((e) => api.ui.showToast(`保存失败：${String(e?.message || e)}`))
      } else if (act === 'save-provider-settings') {
        const r = applyDraftProviderToActiveProvider()
        if (!r.ok) return api.ui.showToast(r.error || '保存失败')
        save()
          .then(() => api.ui.showToast('供应商设置已保存'))
          .then(() => render())
          .catch((e) => api.ui.showToast(`保存失败：${String(e?.message || e)}`))
      } else if (act === 'save-plugin-settings') {
        const r = applyDraftPluginSettings()
        if (!r.ok) return api.ui.showToast(r.error || '保存失败')
        save()
          .then(() => api.ui.showToast('插件设置已保存'))
          .then(() => render())
          .catch((e) => api.ui.showToast(`保存失败：${String(e?.message || e)}`))
      } else if (act === 'add-provider') {
        if (!state.data) return
        const p = defaultProvider()
        // 新增供应商默认使用聊天补全协议（更常见的网关/兼容实现）
        p.protocol = 'chat'
        // 避免把默认图片模型误用到 chat 协议：让用户显式填写模型
        p.models = []
        p.model = '__custom__'
        p.customModel = ''
        state.data.providers.unshift(p)
        state.data.activeProviderId = p.id
        openSettings()
        save().catch(() => {})
      } else if (act === 'delete-provider') {
        if (!state.data) return
        if (state.data.providers.length <= 1) return api.ui.showToast('至少保留一个供应商')
        const p = activeProvider()
        if (!p) return
        if (!confirm(`删除供应商「${p.name}」？`)) return
        state.data.providers = state.data.providers.filter((x) => x.id !== p.id)
        state.data.activeProviderId = String(state.data.providers[0].id)
        openSettings()
        save().catch(() => {})
      }
    })

    root.addEventListener('input', (e) => {
      const t = e.target
      if (!t || !t.getAttribute) return
      const bind = t.getAttribute('data-bind')
      if (!bind) return

      if (bind === 'prompt') {
        state.prompt = String(t.value || '')
        syncPromptNavigationWithCurrentInput()
        return
      }

      if (bind === 'batchCount') {
        state.batchCount = String(t.value || '')
        return
      }

      if (state.modal === 'settings') {
        if (bind in state.draft) {
          if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) {
            state.draft[bind] = String(t.value || '')
          }
        }
        return
      }

      if (state.modal === 'plugin-settings') {
        if (bind in state.draft) {
          if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) {
            state.draft[bind] = String(t.value || '')
          }
        }
        return
      }

      if (bind === 'activeCustomModel') {
        const p = activeProvider()
        if (!p) return
        p.customModel = String(t.value || '')
        save().catch(() => {})
        return
      }
    })

    root.addEventListener('change', (e) => {
      const t = e.target
      if (!t || !t.getAttribute) return
      const bind = t.getAttribute('data-bind')
      if (!bind) return

      if (bind === 'activeProviderId') {
        if (!state.data) return
        const pid = String(t.value || '')
        if (!pid) return
        if (!state.data.providers.some((x) => x.id === pid)) return
        state.data.activeProviderId = pid
        if (state.modal === 'settings') openSettings()
        save().catch(() => {})
        render()
        return
      }

      if (bind === 'activeModel') {
        const p = activeProvider()
        if (!p) return
        const v = String(t.value || '')
        p.model = v
        if (v !== '__custom__') p.customModel = ''
        save().catch(() => {})
        render()
        return
      }

      if (state.modal === 'settings') {
        if (bind in state.draft) {
          if (t instanceof HTMLSelectElement) state.draft[bind] = String(t.value || '')
          if (t instanceof HTMLInputElement && t.type === 'checkbox') state.draft[bind] = !!t.checked
          render()
        }
      }

      if (state.modal === 'plugin-settings') {
        if (bind in state.draft) {
          if (t instanceof HTMLSelectElement) state.draft[bind] = String(t.value || '')
          if (t instanceof HTMLInputElement && t.type === 'checkbox') state.draft[bind] = !!t.checked
          render()
        }
      }
    })
  }

  bindEvents()
  load()
})()
