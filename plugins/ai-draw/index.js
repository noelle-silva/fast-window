// ai-draw (iframe sandbox)
;(function () {
  const api = window.fastWindow
  const runtime = String((api && api.__meta && api.__meta.runtime) || 'ui')

  if (runtime === 'background') {
    const SETTINGS_KEY = 'settings'
    const SAVED_RESULTS_KEY = 'bgSavedResults'
    const POLL_INTERVAL = 1200
    const MAX_SAVED_RESULTS = 200
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

    async function readSavedResults() {
      const raw = await api.storage.get(SAVED_RESULTS_KEY).catch(() => null)
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
  const VERSION = 1
  const DEFAULT_PROMPT_HISTORY_LIMIT = 50
  const MAX_PROMPT_HISTORY_LIMIT = 200
  const TASK_KIND_HTTP_REQUEST = 'http.request'
  const TASK_POLL_INTERVAL = 1200

  const state = {
    loading: true,
    busy: false,
    modal: '',
    menuOpen: false,
    prompt: '',
    promptHistory: [],
    promptHistoryIndex: -1,
    promptHistoryDraft: '',
    imageDataUrl: '',
    imageHistory: [],
    imageHistoryIndex: -1,
    savedPath: '',
    currentTaskId: '',
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
    .title{ font-weight:900; font-size:13px; letter-spacing:0.3px; margin-right:auto; }
    .btn{ height:32px; padding:0 10px; border-radius:10px; border:1px solid var(--line); background:#ffffff; color:var(--text); cursor:pointer; font-size:12px; }
    .btn.pri{ border-color:rgba(37,99,235,0.25); background:rgba(37,99,235,0.08); color:var(--pri); }
    .btn.ok{ border-color:rgba(22,163,74,0.25); background:rgba(22,163,74,0.08); color:var(--ok); }
    .btn.bad{ border-color:rgba(220,38,38,0.25); background:rgba(220,38,38,0.06); color:var(--bad); }
    .btn:disabled{ opacity:0.6; cursor:not-allowed; }
    .content{ flex:1; overflow:auto; padding:12px; }
    .split{ display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; }
    @media (max-width:860px){ .split{ grid-template-columns:1fr; } }
    .card{ background:var(--card); border:1px solid var(--line); border-radius:var(--r); padding:12px; box-shadow: 0 8px 24px rgba(17,24,39,0.06); }
    .row{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .sp{ margin-left:auto; }
    .meta{ font-size:12px; color:var(--muted); margin-top:6px; }
    .field{ width:100%; border:1px solid var(--line); background:#ffffff; color:var(--text); border-radius:10px; padding:9px 10px; font-size:12px; outline:none; }
    .field.sm{ width:auto; min-width: 180px; }
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

  async function takeBackgroundSavedPath(taskId) {
    const tid = String(taskId || '').trim()
    if (!tid) return ''
    const raw = await api.storage.get(BG_SAVED_RESULTS_KEY).catch(() => null)
    const map = raw && typeof raw === 'object' ? { ...raw } : {}
    const hit = map[tid]
    const path = hit && typeof hit.savedPath === 'string' ? String(hit.savedPath).trim() : ''
    if (!path) return ''
    delete map[tid]
    await api.storage.set(BG_SAVED_RESULTS_KEY, map).catch(() => {})
    return path
  }

  async function markBackgroundSavedPath(taskId, savedPath, by = 'ui') {
    const tid = String(taskId || '').trim()
    const path = String(savedPath || '').trim()
    if (!tid || !path) return
    const raw = await api.storage.get(BG_SAVED_RESULTS_KEY).catch(() => null)
    const map = raw && typeof raw === 'object' ? { ...raw } : {}
    map[tid] = {
      savedPath: path,
      at: Date.now(),
      by,
    }
    await api.storage.set(BG_SAVED_RESULTS_KEY, map).catch(() => {})
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

    let resumedTask = null
    const savedPendingTaskId = String(state.data && state.data.pendingTaskId ? state.data.pendingTaskId : '').trim()
    if (savedPendingTaskId) {
      resumedTask = await api.task.get(savedPendingTaskId).catch(() => null)
      if (!resumedTask && state.data) {
        state.data.pendingTaskId = ''
        await save().catch(() => {})
      }
    }

    if (!resumedTask) {
      const pending = await api.task.list(20).catch(() => [])
      resumedTask = Array.isArray(pending)
        ? pending.find((t) => {
            const status = String(t && t.status ? t.status : '')
            return !isTaskDone(status)
          }) || null
        : null
    }

    if (resumedTask) {
      const resumeTaskId = String(resumedTask.id || '').trim()
      const resumeStatus = String(resumedTask.status || '')
      if (resumeTaskId && !isTaskDone(resumeStatus)) {
        state.currentTaskId = resumeTaskId
        state.busy = true
        if (state.data) {
          state.data.pendingTaskId = resumeTaskId
          await save().catch(() => {})
        }
      } else if (resumeTaskId && isTaskDone(resumeStatus)) {
        state.currentTaskId = ''
        state.busy = false
        await applyTaskCompletion(resumedTask)
        if (state.data) {
          state.data.pendingTaskId = ''
          await save().catch(() => {})
        }
      } else {
        state.currentTaskId = ''
        state.busy = false
      }
    } else {
      state.currentTaskId = ''
      state.busy = false
    }

    state.loading = false
    render()
    await refreshImageHistoryFromOutputDir()
    if (state.currentTaskId) pollTask(state.currentTaskId)
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

  async function applyTaskCompletion(task) {
    const status = String(task?.status || '')
    if (status === 'succeeded') {
      try {
        const taskId = String(task && task.id ? task.id : '').trim()
        const bgSavedPath = state.data && state.data.autoSave ? await takeBackgroundSavedPath(taskId) : ''
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
          const savedPath = await api.files.saveImageBase64(generatedDataUrl)
          state.savedPath = String(savedPath || '')
          await markBackgroundSavedPath(taskId, state.savedPath, 'ui')
          await refreshImageHistoryFromOutputDir(state.savedPath)
          api.ui.showToast('已生成并保存')
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
      setError('任务已取消')
      return
    }

    const err = String(task?.error || '').trim()
    setError(err || '生成失败')
  }

  async function pollTask(taskId) {
    if (!taskId || state.currentTaskId !== taskId) return
    if (state.taskPolling) return
    state.taskPolling = true
    try {
      const task = await api.task.get(taskId).catch(() => null)
      if (!task || state.currentTaskId !== taskId) return
      const status = String(task.status || '')
      if (!isTaskDone(status)) {
        state.taskPollTimer = setTimeout(() => {
          state.taskPolling = false
          pollTask(taskId)
        }, TASK_POLL_INTERVAL)
        return
      }

      state.currentTaskId = ''
      state.busy = false
      stopTaskPolling()
      await applyTaskCompletion(task)
      if (state.data) {
        state.data.pendingTaskId = ''
        await save().catch(() => {})
      }
      render()
    } finally {
      state.taskPolling = false
    }
  }

  function openSettings() {
    const p = activeProvider()
    if (!p) return
    state.modal = 'settings'
    state.draft.providerName = String(p.name || '')
    state.draft.baseUrl = String(p.baseUrl || '')
    state.draft.apiKey = String(p.apiKey || '')
    state.draft.protocol = String(p.protocol || 'images') === 'chat' ? 'chat' : 'images'
    state.draft.modelsText = Array.isArray(p.models) ? p.models.join('\n') : ''
    state.draft.size = String(p.size || '1024x1024')
    state.draft.chatSystemPrompt = typeof p.chatSystemPrompt === 'string' ? p.chatSystemPrompt : ''
    state.draft.promptHistoryLimit = String(
      normalizePromptHistoryLimit(state.data && state.data.promptHistoryLimit),
    )
    state.draft.autoSave = !!(state.data && state.data.autoSave)
    render()
  }

  function parseModelsText(text) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((x) => String(x || '').trim())
      .filter((x) => !!x)
    return normalizeModels(lines)
  }

  function applyDraftToActiveProvider() {
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

  async function saveImageNow() {
    if (!state.imageDataUrl) return
    const p = await api.files.saveImageBase64(state.imageDataUrl).catch((e) => {
      api.ui.showToast(`保存失败：${String(e?.message || e)}`)
      return ''
    })
    if (p) {
      state.savedPath = p
      await refreshImageHistoryFromOutputDir(state.savedPath)
      api.ui.showToast('已保存图片')
    }
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

    state.busy = true
    state.error = ''
    state.savedPath = ''
    addPromptHistory(prompt)
    render()

    const protocol = String(p?.protocol || 'images') === 'chat' ? 'chat' : 'images'

    try {
      const task = await api.task.create({
        kind: TASK_KIND_HTTP_REQUEST,
        payload: {
          method: 'POST',
          url:
            protocol === 'chat'
              ? `${baseUrl}/chat/completions`
              : `${baseUrl}/images/generations`,
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
        },
      })

      const taskId = String(task && task.id ? task.id : '').trim()
      if (!taskId) throw new Error('创建后台任务失败')
      state.currentTaskId = taskId
      if (state.data) {
        state.data.pendingTaskId = taskId
        await save().catch(() => {})
      }
      render()
      pollTask(taskId)
    } catch (e) {
      state.busy = false
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
    const topMeta = state.outputDir ? `<span class="kbd mono" title="${esc(state.outputDir)}">输出：${esc(state.outputDir)}</span>` : ''
    const canPromptPrev = canSwitchPromptPrev() && !state.busy
    const canPromptNext = canSwitchPromptNext() && !state.busy
    const canImagePrev = canSwitchImagePrev() && !state.busy
    const canImageNext = canSwitchImageNext() && !state.busy
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
        <div class="modal" role="dialog" aria-modal="true" aria-label="连接设置">
          <div class="row">
            <div class="title" style="margin:0">连接设置（OpenAI 兼容）</div>
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
          <input class="field mono" type="password" data-bind="apiKey" placeholder="sk-..." value="${esc(state.draft.apiKey)}" />

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

          <label style="margin-top:12px">
            <input type="checkbox" data-bind="autoSave" ${state.draft.autoSave ? 'checked' : ''} />
            <span style="margin-left:8px">生成后自动保存到输出目录</span>
          </label>

          <label>提示词历史条数（1-${MAX_PROMPT_HISTORY_LIMIT}）</label>
          <input class="field sm" data-bind="promptHistoryLimit" type="number" min="1" max="${MAX_PROMPT_HISTORY_LIMIT}" step="1" value="${esc(state.draft.promptHistoryLimit)}" />

          <div class="hr"></div>
          <div class="row">
            <button class="btn pri" data-act="save-settings">保存设置</button>
            <div class="sp"></div>
            <button class="btn" data-act="pick-output-dir">选择输出目录</button>
            <button class="btn" data-act="open-output-dir">打开输出目录</button>
          </div>
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
          ${topMeta}
          <select class="field sm" data-bind="activeProviderId" aria-label="供应商">${providerOptions}</select>
          <button class="btn" data-act="open-settings">设置</button>
          <button class="btn" data-act="pick-output-dir">输出目录</button>
          <button class="btn bad" data-act="clear-all" ${state.busy ? 'disabled' : ''}>清空</button>
        </div>

        <div class="content">
          ${state.loading ? `<div class="empty">加载中…</div>` : `
          <div class="split">
            <div class="card">
              <div class="row">
                <div class="meta">提示词（一次性，无上下文）</div>
                <div class="sp"></div>
                <span class="meta">模型：</span>
                <select class="field sm" data-bind="activeModel" aria-label="模型" ${state.busy ? 'disabled' : ''}>
                  ${modelOptions}
                  <option value="__custom__" ${String(p?.model || '') === '__custom__' ? 'selected' : ''}>自定义…</option>
                </select>
              </div>
              ${
                showCustom
                  ? `<input class="field mono" data-bind="activeCustomModel" placeholder="输入模型 ID…" value="${esc(
                      String(p?.customModel || model || ''),
                    )}" ${state.busy ? 'disabled' : ''} />`
                  : ''
              }
              <textarea class="field ta" data-bind="prompt" placeholder="例如：赛博朋克城市夜景，雨，霓虹灯，电影感，高细节…" ${state.busy ? 'disabled' : ''}>${esc(state.prompt)}</textarea>
              <div class="row" style="margin-top:8px">
                <span class="meta">提示词历史</span>
                <button class="btn" data-act="prompt-prev" ${canPromptPrev ? '' : 'disabled'} aria-label="上一条提示词">←</button>
                <button class="btn" data-act="prompt-next" ${canPromptNext ? '' : 'disabled'} aria-label="下一条提示词">→</button>
              </div>
              <div class="row" style="margin-top:10px">
                <button class="btn pri" data-act="generate" ${state.busy ? 'disabled' : ''}>${state.busy ? '生成中…' : '生成'}</button>
                <button class="btn bad" data-act="cancel-generate" ${state.currentTaskId ? '' : 'disabled'}>取消任务</button>
                <button class="btn" data-act="open-output-dir">打开输出目录</button>
                <div class="sp"></div>
                <span class="meta">自动保存：${d && d.autoSave ? '开' : '关'}</span>
              </div>
              <div style="margin-top:10px">${err}</div>
            </div>

            <div class="card" style="display:flex; flex-direction:column; gap:10px; min-height:420px;">
              <div class="row">
                <div class="meta">输出</div>
                <div class="sp"></div>
                <span class="meta" aria-label="图片历史计数">${imageIndexText}</span>
                <button class="btn" data-act="image-prev" ${canImagePrev ? '' : 'disabled'} aria-label="上一张图片">←</button>
                <button class="btn" data-act="image-next" ${canImageNext ? '' : 'disabled'} aria-label="下一张图片">→</button>
                <button class="btn ok" data-act="save-image" ${state.imageDataUrl && !state.busy ? '' : 'disabled'}>保存</button>
                <button class="btn" data-act="copy-image" ${state.imageDataUrl && !state.busy ? '' : 'disabled'}>复制图片</button>
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

      // 关键：在 modal 内部点击时，不要“穿透”到 overlay 的 data-act
      const el = node.closest('.modal') ? node.closest('.modal [data-act]') : node.closest('[data-act]')
      if (!el) return

      const act = el.getAttribute('data-act')
      if (!act) return

      if (act === 'open-settings') {
        openSettings()
      } else if (act === 'close-modal') {
        state.modal = ''
        render()
      } else if (act === 'generate') {
        generate()
      } else if (act === 'cancel-generate') {
        const tid = String(state.currentTaskId || '').trim()
        if (!tid) return
        api.task
          .cancel(tid)
          .then(() => {
            api.ui.showToast('已请求取消')
          })
          .catch((e) => api.ui.showToast(`取消失败：${String(e?.message || e)}`))
      } else if (act === 'prompt-prev') {
        switchPromptHistory(-1)
      } else if (act === 'prompt-next') {
        switchPromptHistory(1)
      } else if (act === 'clear-all') {
        state.prompt = ''
        clearPromptHistory()
        clearResult()
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
        const r = applyDraftToActiveProvider()
        if (!r.ok) return api.ui.showToast(r.error || '保存失败')
        save()
          .then(() => api.ui.showToast('设置已保存'))
          .then(() => render())
          .catch((e) => api.ui.showToast(`保存失败：${String(e?.message || e)}`))
      } else if (act === 'add-provider') {
        if (!state.data) return
        const p = defaultProvider()
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

      if (state.modal === 'settings') {
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
    })
  }

  bindEvents()
  load()
})()
