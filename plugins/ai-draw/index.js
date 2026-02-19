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
  const MAX_REF_IMAGES = 8
  const TASK_KIND_HTTP_REQUEST = 'http.request'
  const TASK_POLL_INTERVAL = 1200
  const MAX_TASK_JSON_BODY_CHARS = 10 * 1024 * 1024 // 约 10MB，给后端留余量
  const REF_SHRINK_MAX_DIMENSION = 960
  const REF_SHRINK_IF_OVER_BYTES = 900 * 1024
  const UI_MODE_NORMAL = 'normal'
  const UI_MODE_LOCAL_EDIT = 'local-edit'

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
    refImages: [],
    edit: {
      baseName: '',
      baseDataUrl: '',
      baseW: 0,
      baseH: 0,
      sel: null, // { x, y, w, h }：0..1 的相对坐标
      drag: null, // { pointerId, startX, startY }
    },
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
    refLibraryLoading: false,
    refLibraryBusy: false,
    refLibraryItems: [],
    refLibrarySelected: {},
    refLibraryPaths: [],
    refLibraryCursor: 0,
    refLibraryLoadingMore: false,
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
      deleteProviderId: '',
      deleteProviderReturnModal: '',
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
    .field.xs{ width: 48px; min-width: 48px; }
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
    .editArea{
      border:1px solid var(--line);
      border-radius:12px;
      background:#fafafa;
      padding:8px;
      display:flex;
      justify-content:center;
      align-items:center;
      min-height: 260px;
      overflow:hidden;
    }
    .editWrap{ position:relative; display:inline-block; max-width:100%; cursor:crosshair; user-select:none; }
    .editWrap img{ display:block; max-width:100%; max-height:360px; border-radius:10px; }
    .selRect{
      position:absolute;
      border:2px solid rgba(37,99,235,0.95);
      background: rgba(37,99,235,0.12);
      border-radius:8px;
      pointer-events:none;
    }
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
    .refTop{ margin-top:6px; }
    .refStrip{
      display:flex;
      gap:8px;
      overflow-x:auto;
      padding:6px 2px;
      scrollbar-gutter: stable;
    }
    .thumb{
      width:44px;
      height:44px;
      border:1px solid var(--line);
      border-radius:12px;
      background:#fafafa;
      overflow:hidden;
      position:relative;
      flex:0 0 auto;
    }
    .thumb img{ width:100%; height:100%; object-fit:cover; display:block; }
    .thumbDel{
      position:absolute;
      top:2px;
      right:2px;
      width:18px;
      height:18px;
      border-radius:999px;
      border:1px solid rgba(0,0,0,0.08);
      background:rgba(255,255,255,0.9);
      cursor:pointer;
      font-size:12px;
      line-height:16px;
      padding:0;
      display:flex;
      align-items:center;
      justify-content:center;
    }
    .thumbDel:hover{ background:#fff; }
    .libTop{ margin: 6px 0 8px; }
    .libGrid{
      display:grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 8px;
    }
    @media (max-width: 860px){
      .libGrid{ grid-template-columns: repeat(4, minmax(0, 1fr)); }
    }
    @media (max-width: 520px){
      .libGrid{ grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    .libItem{
      border:1px solid var(--line);
      background:#fff;
      border-radius:12px;
      overflow:hidden;
      padding:0;
      cursor:pointer;
      position:relative;
      aspect-ratio: 1 / 1;
      display:flex;
      align-items:stretch;
      justify-content:stretch;
    }
    .libItem:hover{ border-color: rgba(37,99,235,0.45); }
    .libItem.sel{ outline:2px solid rgba(37,99,235,0.55); outline-offset:1px; }
    .libItem img{ width:100%; height:100%; object-fit:cover; display:block; }
    .libCheck{
      position:absolute;
      top:6px;
      right:6px;
      width:18px;
      height:18px;
      border-radius:999px;
      background: rgba(37,99,235,0.92);
      color:#fff;
      font-size:12px;
      line-height:18px;
      display:flex;
      align-items:center;
      justify-content:center;
      box-shadow: 0 6px 16px rgba(17,24,39,0.18);
    }
    .libItem:not(.sel) .libCheck{ display:none; }
    .refLibModal{
      width:min(860px,100%);
      display:flex;
      flex-direction:column;
      overflow:hidden;
    }
    .refLibHead{ flex:0 0 auto; }
    .refLibBody{
      flex:1 1 auto;
      min-height:0;
      overflow:auto;
      padding-right:2px;
    }
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

  function estimateBytesFromBase64(b64) {
    const s = String(b64 || '').trim()
    if (!s) return 0
    const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0
    return Math.floor((s.length * 3) / 4) - pad
  }

  function dataUrlToBase64(dataUrl) {
    const s = String(dataUrl || '')
    const i = s.indexOf('base64,')
    if (i === -1) return ''
    return s.slice(i + 'base64,'.length)
  }

  function formatBytes(n) {
    const v = Number(n)
    if (!Number.isFinite(v) || v <= 0) return '0B'
    if (v < 1024) return `${Math.floor(v)}B`
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)}KB`
    return `${(v / 1024 / 1024).toFixed(2)}MB`
  }

  async function loadImageFromDataUrl(dataUrl) {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('解析图片失败'))
      img.src = String(dataUrl || '')
    })
  }

  async function shrinkRefImageDataUrl(dataUrl) {
    const rawUrl = String(dataUrl || '').trim()
    if (!rawUrl.startsWith('data:image/')) return rawUrl

    const b64 = dataUrlToBase64(rawUrl)
    const bytes = estimateBytesFromBase64(b64)
    const img = await loadImageFromDataUrl(rawUrl)
    const w0 = img.naturalWidth || img.width
    const h0 = img.naturalHeight || img.height
    if (!w0 || !h0) return rawUrl

    const scale = Math.min(1, REF_SHRINK_MAX_DIMENSION / Math.max(w0, h0))
    if (scale === 1 && bytes > 0 && bytes <= REF_SHRINK_IF_OVER_BYTES) return rawUrl

    const w = Math.max(1, Math.round(w0 * scale))
    const h = Math.max(1, Math.round(h0 * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return rawUrl

    // JPEG 不支持透明：填白底，避免默认黑底。
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)

    let q = 0.86
    let out = canvas.toDataURL('image/jpeg', q)
    for (let i = 0; i < 3; i++) {
      const outBytes = estimateBytesFromBase64(dataUrlToBase64(out))
      if (outBytes > 0 && outBytes <= REF_SHRINK_IF_OVER_BYTES) return out
      q = Math.max(0.6, q - 0.1)
      out = canvas.toDataURL('image/jpeg', q)
    }
    return out
  }

  function clamp01(n) {
    const v = Number(n)
    if (!Number.isFinite(v)) return 0
    if (v < 0) return 0
    if (v > 1) return 1
    return v
  }

  function normalizeSelRect(sel) {
    if (!sel || typeof sel !== 'object') return null
    const x = clamp01(sel.x)
    const y = clamp01(sel.y)
    const w = clamp01(sel.w)
    const h = clamp01(sel.h)
    if (!(w > 0 && h > 0)) return null
    if (x + w <= 0 || y + h <= 0) return null
    return { x, y, w: Math.min(1 - x, w), h: Math.min(1 - y, h) }
  }

  function selRectToPixels(sel, imgW, imgH) {
    const s = normalizeSelRect(sel)
    const w0 = Number(imgW) || 0
    const h0 = Number(imgH) || 0
    if (!s || !w0 || !h0) return null

    const x = Math.max(0, Math.floor(s.x * w0))
    const y = Math.max(0, Math.floor(s.y * h0))
    const w = Math.max(1, Math.floor(s.w * w0))
    const h = Math.max(1, Math.floor(s.h * h0))
    const w1 = Math.min(w0 - x, w)
    const h1 = Math.min(h0 - y, h)
    if (!(w1 > 0 && h1 > 0)) return null
    return { x, y, w: w1, h: h1 }
  }

  async function cropDataUrlByPixels(dataUrl, rect) {
    const srcUrl = String(dataUrl || '').trim()
    if (!srcUrl.startsWith('data:image/')) return ''
    const r = rect && typeof rect === 'object' ? rect : null
    const x = Math.max(0, Math.floor(Number(r?.x) || 0))
    const y = Math.max(0, Math.floor(Number(r?.y) || 0))
    const w = Math.max(1, Math.floor(Number(r?.w) || 0))
    const h = Math.max(1, Math.floor(Number(r?.h) || 0))

    const img = await loadImageFromDataUrl(srcUrl)
    const w0 = img.naturalWidth || img.width
    const h0 = img.naturalHeight || img.height
    if (!w0 || !h0) return ''
    const w1 = Math.min(w0 - x, w)
    const h1 = Math.min(h0 - y, h)
    if (!(w1 > 0 && h1 > 0)) return ''

    const canvas = document.createElement('canvas')
    canvas.width = w1
    canvas.height = h1
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    ctx.drawImage(img, x, y, w1, h1, 0, 0, w1, h1)
    return canvas.toDataURL('image/png')
  }

  async function compositePatchToBase(baseDataUrl, patchDataUrl, rect) {
    const baseUrl = String(baseDataUrl || '').trim()
    const patchUrl = String(patchDataUrl || '').trim()
    if (!baseUrl.startsWith('data:image/')) return ''
    if (!patchUrl.startsWith('data:image/')) return ''

    const b = rect && typeof rect === 'object' ? rect : null
    const x = Math.max(0, Math.floor(Number(b?.x) || 0))
    const y = Math.max(0, Math.floor(Number(b?.y) || 0))
    const w = Math.max(1, Math.floor(Number(b?.w) || 0))
    const h = Math.max(1, Math.floor(Number(b?.h) || 0))

    const baseImg = await loadImageFromDataUrl(baseUrl)
    const patchImg = await loadImageFromDataUrl(patchUrl)
    const bw = baseImg.naturalWidth || baseImg.width
    const bh = baseImg.naturalHeight || baseImg.height
    if (!bw || !bh) return ''

    const canvas = document.createElement('canvas')
    canvas.width = bw
    canvas.height = bh
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''

    ctx.drawImage(baseImg, 0, 0, bw, bh)
    const w1 = Math.min(bw - x, w)
    const h1 = Math.min(bh - y, h)
    if (w1 > 0 && h1 > 0) ctx.drawImage(patchImg, 0, 0, patchImg.naturalWidth || patchImg.width, patchImg.naturalHeight || patchImg.height, x, y, w1, h1)
    return canvas.toDataURL('image/png')
  }

  function normalizePickedImages(raw) {
    const list = Array.isArray(raw) ? raw : []
    const out = []
    for (const it of list) {
      const name = typeof it?.name === 'string' ? it.name : ''
      const dataUrl = typeof it?.dataUrl === 'string' ? it.dataUrl : typeof it?.data_url === 'string' ? it.data_url : ''
      const u = String(dataUrl || '').trim()
      if (!u.startsWith('data:image/')) continue
      out.push({ id: id('ref'), name: String(name || ''), dataUrl: u })
      if (out.length >= MAX_REF_IMAGES) break
    }
    return out
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
      uiMode: UI_MODE_NORMAL,
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
    out.uiMode = UI_MODE_NORMAL
    out.promptHistoryLimit = normalizePromptHistoryLimit(s.promptHistoryLimit)
    out.promptHistory = normalizePromptHistory(s.promptHistory, out.promptHistoryLimit)
    return out
  }

  function normalizeUiMode(raw) {
    const v = String(raw || '').trim()
    return v === UI_MODE_LOCAL_EDIT ? UI_MODE_LOCAL_EDIT : UI_MODE_NORMAL
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
    out.uiMode = normalizeUiMode(d.uiMode)
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

  function parseImageDataUrlFromHttpBodyText(bodyText) {
    const raw = String(bodyText || '')
    try {
      const j = JSON.parse(raw)
      const item = (Array.isArray(j?.data) && j.data[0]) || (Array.isArray(j?.images) && j.images[0]) || null
      const b64 = item?.b64_json || item?.b64 || item?.base64 || ''
      const direct = typeof item?.data_url === 'string' ? item.data_url : typeof item?.dataUrl === 'string' ? item.dataUrl : ''
      const content = (Array.isArray(j?.choices) && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || ''
      return (
        (direct && String(direct).trim()) ||
        (b64 && `data:image/png;base64,${String(b64).trim()}`) ||
        extractImageFromText(content) ||
        extractImageFromText(raw)
      )
    } catch {
      return extractImageFromText(raw)
    }
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
    if (!id) return false

    const list = Array.isArray(state.tasks) ? state.tasks : []
    const idx = list.findIndex((x) => x && x.id === id)
    const prev = idx >= 0 ? list[idx] : null

    const hasStatus = Object.prototype.hasOwnProperty.call(t, 'status')
    const status = hasStatus ? String(t.status || '').trim() || 'pending' : String(prev && prev.status ? prev.status : 'pending')
    const hasPrompt = Object.prototype.hasOwnProperty.call(t, 'prompt') && typeof t.prompt === 'string'
    const hasAt = Object.prototype.hasOwnProperty.call(t, 'at') && typeof t.at === 'number' && Number.isFinite(t.at)

    const next = { id, status }
    if (hasPrompt) next.prompt = t.prompt
    else if (!prev) next.prompt = ''

    if (hasAt) next.at = t.at
    else if (!prev) next.at = Date.now()

    const merged = prev ? { ...prev, ...next } : next
    const changed =
      !prev ||
      String(prev.status || '') !== String(merged.status || '') ||
      (hasPrompt && String(prev.prompt || '') !== String(merged.prompt || '')) ||
      (hasAt && Number(prev.at) !== Number(merged.at))

    if (idx >= 0) list[idx] = merged
    else list.unshift(merged)
    state.tasks = list.slice(0, 50)
    return changed
  }

  function removeTask(taskId) {
    const tid = String(taskId || '').trim()
    if (!tid) return false
    const list = Array.isArray(state.tasks) ? state.tasks : []
    const next = list.filter((x) => x && x.id !== tid)
    state.tasks = next
    return next.length !== list.length
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

      let changed = false
      for (const info of infos) {
        if (!info) continue
        const tid = String(info.id || '').trim()
        if (!tid) continue
        const st = String(info.status || '')
        if (upsertTask({ id: tid, status: st })) changed = true
        if (isTaskDone(st)) {
          await applyTaskCompletion(info)
          removeTask(tid)
          changed = true
        }
      }

      if (changed) render()
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

  function openDeleteProviderConfirm(providerId, returnModal) {
    if (!state.data) return
    const pid = String(providerId || '')
    if (!pid) return
    if (state.data.providers.length <= 1) return api.ui.showToast('至少保留一个供应商')
    const p = state.data.providers.find((x) => x && x.id === pid)
    if (!p) return
    state.draft.deleteProviderId = pid
    state.draft.deleteProviderReturnModal = String(returnModal || '')
    state.modal = 'confirm-delete-provider'
    render()
  }

  function cancelDeleteProviderConfirm() {
    const back = String(state.draft.deleteProviderReturnModal || '')
    state.draft.deleteProviderId = ''
    state.draft.deleteProviderReturnModal = ''
    state.modal = back
    render()
  }

  function confirmDeleteProvider() {
    if (!state.data) return
    const pid = String(state.draft.deleteProviderId || '')
    const back = String(state.draft.deleteProviderReturnModal || '')
    state.draft.deleteProviderId = ''
    state.draft.deleteProviderReturnModal = ''
    state.modal = back
    if (!pid) return render()
    if (state.data.providers.length <= 1) {
      api.ui.showToast('至少保留一个供应商')
      return render()
    }
    state.data.providers = state.data.providers.filter((x) => x.id !== pid)
    state.data.activeProviderId = String(state.data.providers[0].id)
    openSettings()
    save().catch(() => {})
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

  async function pickEditImage() {
    const picked = await api.files.pickImages(1).catch((e) => {
      api.ui.showToast(`选择图片失败：${String(e?.message || e)}`)
      return []
    })
    const it = Array.isArray(picked) && picked[0] ? picked[0] : null
    const name = typeof it?.name === 'string' ? it.name : ''
    const dataUrl = typeof it?.dataUrl === 'string' ? it.dataUrl : typeof it?.data_url === 'string' ? it.data_url : ''
    const u = String(dataUrl || '').trim()
    if (!u.startsWith('data:image/')) return api.ui.showToast('图片数据无效')

    try {
      const img = await loadImageFromDataUrl(u)
      const w = img.naturalWidth || img.width
      const h = img.naturalHeight || img.height
      state.edit.baseName = String(name || '图片')
      state.edit.baseDataUrl = u
      state.edit.baseW = Number(w) || 0
      state.edit.baseH = Number(h) || 0
      state.edit.sel = null
      state.edit.drag = null
      state.error = ''
      render()
    } catch (e) {
      api.ui.showToast(`解析图片失败：${String(e?.message || e)}`)
    }
  }

  function clearEditImage() {
    state.edit.baseName = ''
    state.edit.baseDataUrl = ''
    state.edit.baseW = 0
    state.edit.baseH = 0
    state.edit.sel = null
    state.edit.drag = null
    state.error = ''
    render()
  }

  function clearEditSelection() {
    state.edit.sel = null
    state.edit.drag = null
    const el = document.getElementById('edit-sel-rect')
    if (el) el.setAttribute('style', 'display:none;')
    render()
  }

  function basename(p) {
    const s = String(p || '').trim()
    if (!s) return ''
    const parts = s.split(/[\\/]/g).filter((x) => !!x)
    return parts.length ? parts[parts.length - 1] : s
  }

  async function openRefLibrary() {
    state.modal = 'ref-library'
    state.refLibraryBusy = false
    state.refLibraryItems = []
    state.refLibrarySelected = {}
    state.refLibraryPaths = []
    state.refLibraryCursor = 0
    state.refLibraryLoading = true
    state.refLibraryLoadingMore = false
    render()
    await initRefLibrary()
  }

  async function initRefLibrary() {
    state.refLibraryLoading = true
    render()

    const paths = await api.files.listRefImages().catch(() => [])
    const list = (Array.isArray(paths) ? paths : [])
      .map((x) => String(x || '').trim())
      .filter((x) => !!x)
      .slice(0, 120)

    state.refLibraryPaths = list
    state.refLibraryItems = []
    state.refLibraryCursor = 0
    state.refLibraryLoading = false
    render()

    await loadMoreRefLibrary()
  }

  async function loadMoreRefLibrary() {
    if (state.modal !== 'ref-library') return
    if (state.refLibraryLoadingMore) return
    const paths = Array.isArray(state.refLibraryPaths) ? state.refLibraryPaths : []
    const start = Number(state.refLibraryCursor) || 0
    if (start >= paths.length) return

    state.refLibraryLoadingMore = true
    render()
    try {
      const batch = 24
      const end = Math.min(paths.length, start + batch)
      const items = Array.isArray(state.refLibraryItems) ? state.refLibraryItems.slice() : []
      for (let i = start; i < end; i++) {
        if (state.modal !== 'ref-library') return
        const p = String(paths[i] || '').trim()
        if (!p) continue
        const dataUrl = await api.files.readRefImage(p).catch(() => '')
        items.push({ path: p, name: basename(p), dataUrl: String(dataUrl || '').trim() })
        if (items.length % 12 === 0) {
          state.refLibraryItems = items.slice()
          state.refLibraryCursor = i + 1
          render()
        }
      }

      state.refLibraryItems = items
      state.refLibraryCursor = end
      render()
    } finally {
      state.refLibraryLoadingMore = false
      render()
    }
  }

  function toggleRefLibrarySelect(path) {
    const p = String(path || '').trim()
    if (!p) return
    const sel = state.refLibrarySelected && typeof state.refLibrarySelected === 'object' ? { ...state.refLibrarySelected } : {}
    if (sel[p]) delete sel[p]
    else sel[p] = true
    state.refLibrarySelected = sel
    render()
  }

  async function uploadRefLibraryImages() {
    if (state.refLibraryBusy) return
    state.refLibraryBusy = true
    render()
    try {
      const picked = await api.files.pickImages(50).catch((e) => {
        api.ui.showToast(`选择图片失败：${String(e?.message || e)}`)
        return []
      })
      const list = Array.isArray(picked) ? picked : []
      if (!list.length) return

      api.ui.showToast('正在上传到参考图库…')
      let ok = 0
      for (const it of list) {
        const u = String(it?.dataUrl || it?.data_url || '').trim()
        if (!u.startsWith('data:image/')) continue
        const safeUrl = await shrinkRefImageDataUrl(u).catch(() => u)
        const saved = await api.files.saveRefImageBase64(safeUrl).catch(() => '')
        if (saved) ok++
      }
      api.ui.showToast(ok ? `已加入参考图库：${ok} 张` : '加入失败')
      await initRefLibrary()
    } finally {
      state.refLibraryBusy = false
      render()
    }
  }

  async function confirmRefLibrarySelection() {
    const keys = state.refLibrarySelected && typeof state.refLibrarySelected === 'object' ? Object.keys(state.refLibrarySelected) : []
    const chosen = keys.map((x) => String(x || '').trim()).filter((x) => !!x)
    if (!chosen.length) {
      state.modal = ''
      render()
      return
    }

    const remaining = MAX_REF_IMAGES - (Array.isArray(state.refImages) ? state.refImages.length : 0)
    if (remaining <= 0) {
      api.ui.showToast(`参考图最多 ${MAX_REF_IMAGES} 张`)
      state.modal = ''
      render()
      return
    }

    api.ui.showToast('正在载入参考图…')
    const out = []
    for (const p of chosen.slice(0, remaining)) {
      const dataUrl = await api.files.readRefImage(p).catch(() => '')
      const u = String(dataUrl || '').trim()
      if (!u.startsWith('data:image/')) continue
      out.push({ id: id('ref'), name: basename(p), dataUrl: u })
    }
    if (!out.length) {
      api.ui.showToast('载入失败')
      return
    }

    state.refImages = (Array.isArray(state.refImages) ? state.refImages : []).concat(out).slice(0, MAX_REF_IMAGES)
    state.modal = ''
    render()
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

  async function generateLocalEdit() {
    const prompt = String(state.prompt || '').trim()
    if (!prompt) {
      setError('请输入提示词')
      return
    }

    const baseUrl = String(state.edit?.baseDataUrl || '').trim()
    if (!baseUrl.startsWith('data:image/')) {
      setError('请先选择一张图片')
      return
    }

    const selPx = selRectToPixels(state.edit?.sel, state.edit?.baseW, state.edit?.baseH)
    if (!selPx) {
      setError('请在图片上拖拽选择矩形区域')
      return
    }

    const p = activeProvider()
    const base = trimSlash(String(p?.baseUrl || ''))
    const apiKey = String(p?.apiKey || '').trim()
    if (!isHttpBaseUrl(base)) {
      openSettings()
      setError('请先在设置里配置 Base URL（http:// 或 https://）')
      return
    }
    if (!apiKey) {
      openSettings()
      setError('请先在设置里填写 API Key')
      return
    }
    if (String(p?.protocol || 'images') !== 'chat') {
      openSettings()
      setError('局部修改需要 chat 协议（/chat/completions）')
      return
    }

    const model = resolveModel(p)
    if (!model) {
      openSettings()
      setError('请先配置模型')
      return
    }

    state.submitting = true
    state.error = ''
    addPromptHistory(prompt)
    render()

    try {
      const cropPng = await cropDataUrlByPixels(baseUrl, selPx)
      if (!cropPng) throw new Error('裁剪失败：无法生成选区图片')
      const cropForSend = await shrinkRefImageDataUrl(cropPng).catch(() => cropPng)

      const refUrls = (Array.isArray(state.refImages) ? state.refImages : [])
        .map((x) => String(x && x.dataUrl ? x.dataUrl : '').trim())
        .filter((x) => x.startsWith('data:image/'))
        .slice(0, MAX_REF_IMAGES)

      const instruction =
        `请根据要求修改图片：${prompt}\n` +
        `图 1 是需要修改的“选区图片”；后续图片（如果有）是参考图（风格/细节参考）。\n` +
        `只输出一张最终图片（PNG），尺寸必须与输入图片一致。\n` +
        `输出格式必须是 data URL（data:image/png;base64,...）或 JSON（{"data_url":"..."} / {"b64_png":"..."} / {"b64_json":"..."}），不要输出其它文字。`

      const refForSend = []
      for (const u of refUrls) {
        const safeUrl = await shrinkRefImageDataUrl(u).catch(() => u)
        if (String(safeUrl || '').startsWith('data:image/')) refForSend.push(safeUrl)
      }

      const body = JSON.stringify({
        model,
        messages: [
          ...(String(p?.chatSystemPrompt || '').trim()
            ? [{ role: 'system', content: String(p?.chatSystemPrompt || '').trim() }]
            : []),
          {
            role: 'user',
            content: [
              { type: 'text', text: instruction },
              { type: 'image_url', image_url: { url: cropForSend } },
              ...refForSend.map((url) => ({ type: 'image_url', image_url: { url } })),
            ],
          },
        ],
        temperature: 0.2,
      })

      if (body.length > MAX_TASK_JSON_BODY_CHARS) {
        throw new Error(`请求体过大（约 ${formatBytes(body.length)}）。请缩小选区/减少参考图/换更小图片。`)
      }

      const res = await api.net.request({
        method: 'POST',
        url: `${base}/chat/completions`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body,
        timeoutMs: 120000,
      })

      const httpStatus = Number(res?.status)
      const bodyText = typeof res?.body === 'string' ? res.body : ''
      if (!Number.isFinite(httpStatus)) throw new Error('请求失败：无响应')
      if (httpStatus < 200 || httpStatus >= 300) throw new Error(`HTTP ${httpStatus}：${parseErrorBody(bodyText)}`)

      const patch = parseImageDataUrlFromHttpBodyText(bodyText)
      if (!patch) throw new Error('未拿到图片数据（请确保服务端返回 base64 图片）')

      const finalDataUrl = await compositePatchToBase(baseUrl, String(patch || '').trim(), selPx)
      if (!finalDataUrl) throw new Error('合成失败：无法把结果贴回原图')

      state.imageDataUrl = finalDataUrl
      state.savedPath = ''
      // 便于多轮局部修改：把输出回填为新的编辑图，并清空选区。
      state.edit.baseDataUrl = finalDataUrl
      state.edit.baseW = Number(state.edit.baseW) || 0
      state.edit.baseH = Number(state.edit.baseH) || 0
      state.edit.sel = null
      state.edit.drag = null
      render()

      if (state.data && state.data.autoSave) {
        const rid = await enqueueBackgroundSave(finalDataUrl).catch(() => '')
        if (!rid) throw new Error('保存失败：无法发起后台保存')
        api.ui.showToast('已生成（保存中…）')
        const savedPath = await waitBackgroundSaveResponse(rid).catch(() => '')
        if (savedPath) {
          state.savedPath = savedPath
          await refreshImageHistoryFromOutputDir(state.savedPath)
          api.ui.showToast('已生成并保存')
        }
      } else {
        api.ui.showToast('已生成（已贴回选区）')
      }
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      state.submitting = false
      render()
    }
  }

  async function generate() {
    if (state.data && normalizeUiMode(state.data.uiMode) === UI_MODE_LOCAL_EDIT) {
      await generateLocalEdit()
      return
    }

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
    const refUrls = (Array.isArray(state.refImages) ? state.refImages : [])
      .map((x) => String(x && x.dataUrl ? x.dataUrl : '').trim())
      .filter((x) => x.startsWith('data:image/'))
      .slice(0, MAX_REF_IMAGES)

    if (refUrls.length && protocol !== 'chat') {
      api.ui.showToast('参考图当前仅对 chat 协议生效（建议切到聊天补全）')
    }
    const chatUserContent = refUrls.length
      ? [{ type: 'text', text: prompt }, ...refUrls.map((url) => ({ type: 'image_url', image_url: { url } }))]
      : prompt

    const body = JSON.stringify(
      protocol === 'chat'
        ? {
            model,
            messages: [
              ...(String(p?.chatSystemPrompt || '').trim()
                ? [{ role: 'system', content: String(p?.chatSystemPrompt || '').trim() }]
                : []),
              { role: 'user', content: chatUserContent },
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
    )

    if (body.length > MAX_TASK_JSON_BODY_CHARS) {
      state.submitting = false
      api.ui.showToast('请求体过大：请减少参考图/换更小图片')
      setError(
        `请求体过大（约 ${formatBytes(body.length)}）。请减少参考图数量/换更小图片（建议裁剪或压缩），再试一次。`,
      )
      render()
      return
    }

    const req = {
      mode: 'task',
      method: 'POST',
      url: protocol === 'chat' ? `${baseUrl}/chat/completions` : `${baseUrl}/images/generations`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body,
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
    const delPid = String(state.draft.deleteProviderId || '')
    const delP = delPid ? ps.find((x) => x && String(x.id || '') === delPid) : null
    const uiMode = normalizeUiMode(d && d.uiMode)
    const modeBtnText = uiMode === UI_MODE_LOCAL_EDIT ? '模式：局部' : '模式：普通'

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

    const edit = state.edit && typeof state.edit === 'object' ? state.edit : {}
    const editHasBase = !!String(edit.baseDataUrl || '').trim()
    const editSel = normalizeSelRect(edit.sel)
    const editSelPx = editSel ? selRectToPixels(editSel, edit.baseW, edit.baseH) : null
    const editRectStyle = editSel
      ? `left:${(editSel.x * 100).toFixed(3)}%; top:${(editSel.y * 100).toFixed(3)}%; width:${(editSel.w * 100).toFixed(
          3,
        )}%; height:${(editSel.h * 100).toFixed(3)}%;`
      : 'display:none;'
    const editBaseText = editHasBase
      ? `已选：${String(edit.baseName || '图片')} (${String(edit.baseW || 0)}x${String(edit.baseH || 0)})`
      : '未选择图片'
    const editSelText = editSelPx ? `选区：${editSelPx.x},${editSelPx.y} ${editSelPx.w}x${editSelPx.h}` : '未选择区域'

    const img =
      state.imageDataUrl
        ? `<div class="imgBox" aria-label="生成结果"><img alt="AI 绘图结果" src="${esc(state.imageDataUrl)}" /></div>`
        : `<div class="imgBox" aria-label="空结果"><div class="empty">等待出图…<div style="margin-top:10px">提示：结果默认会保存到 <span class="mono">data/ai-draw/output-images</span></div></div></div>`

    const saved = state.savedPath
      ? `<div class="meta mono" title="${esc(state.savedPath)}">已保存：${esc(state.savedPath)}</div>`
      : `<div class="meta">未保存（或尚未生成）</div>`

    const err = state.error ? `<div class="err" role="alert">${esc(state.error)}</div>` : ''

    const modal =
      state.modal === 'confirm-delete-provider'
        ? `
      <div class="overlay" data-act="close-modal">
        <div class="modal" role="dialog" aria-modal="true" aria-label="确认删除供应商">
          <div class="row">
            <div class="title" style="margin:0">确认删除供应商</div>
            <div class="sp"></div>
            <button class="btn" data-act="cancel-delete-provider">取消</button>
          </div>
          <div class="hr"></div>
          <div class="meta">删除后不可恢复，将移除供应商「${esc(delP ? delP.name : '')}」的连接配置。</div>
          <div class="hr"></div>
          <div class="row">
            <button class="btn bad" data-act="confirm-delete-provider">确认删除</button>
            <button class="btn" data-act="cancel-delete-provider">取消</button>
          </div>
        </div>
      </div>`
        : state.modal === 'settings'
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
          : state.modal === 'ref-library'
            ? `
      <div class="overlay" data-act="close-modal">
        <div class="modal refLibModal" role="dialog" aria-modal="true" aria-label="参考图库">
          <div class="refLibHead">
            <div class="row nowrap">
              <div class="title" style="margin:0">参考图库</div>
              <div class="sp"></div>
              <button class="btn" data-act="ref-lib-upload" ${state.refLibraryBusy ? 'disabled' : ''}>上传</button>
              <button class="btn pri stable" data-act="ref-lib-confirm" ${state.refLibraryBusy ? 'disabled' : ''}>确定</button>
              <button class="btn" data-act="close-modal">关闭</button>
            </div>
            <div class="meta libTop">存放在 <span class="mono">data/&lt;pluginId&gt;/ref-images</span>（和输出图片目录并列）</div>
            <div class="hr"></div>
          </div>

          <div id="ref-lib-scroll" class="refLibBody" aria-label="参考图库滚动区">
            ${
              state.refLibraryLoading
                ? `<div class="meta">加载中…</div>`
                : state.refLibraryItems.length
                  ? `<div class="libGrid" aria-label="参考图库图片列表">
                      ${state.refLibraryItems
                        .map((it) => {
                          const p = String(it?.path || '').trim()
                          const u = String(it?.dataUrl || '').trim()
                          const sel = !!(state.refLibrarySelected && state.refLibrarySelected[p])
                          return `<button class="libItem ${sel ? 'sel' : ''}" data-act="ref-lib-toggle" data-path="${esc(p)}" aria-label="参考图库图片">
                            ${u ? `<img alt="${esc(String(it?.name || ''))}" src="${esc(u)}" />` : `<div class="empty" style="width:100%">加载中…</div>`}
                            <div class="libCheck" aria-hidden="true">✓</div>
                          </button>`
                        })
                        .join('')}
                    </div>`
                  : `<div class="meta">图库为空，点击“上传”添加图片。</div>`
            }
            ${
              !state.refLibraryLoading && (Number(state.refLibraryCursor) || 0) < (Array.isArray(state.refLibraryPaths) ? state.refLibraryPaths.length : 0)
                ? `<div class="meta" style="margin-top:10px">${state.refLibraryLoadingMore ? '加载更多…' : '继续向下滚动以加载更多'}</div>`
                : ''
            }
          </div>
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
          <button class="btn icon" data-act="back" aria-label="返回主页" title="返回主页">←</button>
          <div class="title">AI 绘图</div>
          <button class="btn" data-act="toggle-ui-mode" title="切换普通/局部修改">${esc(modeBtnText)}</button>
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
                ${
                  uiMode === UI_MODE_LOCAL_EDIT
                    ? ''
                    : `<input class="field xs" data-bind="batchCount" type="number" min="1" max="${MAX_BATCH_COUNT}" step="1" value="${esc(state.batchCount)}" aria-label="批量次数" title="批量次数（并行提交）" />`
                }
                <button class="btn" data-act="prompt-prev" ${canPromptPrev ? '' : 'disabled'} aria-label="上一条提示词">←</button>
                <button class="btn" data-act="prompt-next" ${canPromptNext ? '' : 'disabled'} aria-label="下一条提示词">→</button>
                <div class="sp"></div>
                <select class="field sm" data-bind="activeModel" aria-label="模型">
                  ${modelOptions}
                  <option value="__custom__" ${String(p?.model || '') === '__custom__' ? 'selected' : ''}>自定义…</option>
                </select>
              </div>
              ${
                uiMode === UI_MODE_LOCAL_EDIT
                  ? `
              <div class="row refTop">
                <span class="meta" style="margin-top:0">局部修改</span>
                <button class="btn" data-act="pick-edit-image">选择图片</button>
                <button class="btn" data-act="clear-edit-image" ${editHasBase ? '' : 'disabled'}>清除</button>
                <button class="btn" data-act="clear-edit-selection" ${editSel ? '' : 'disabled'}>清空选区</button>
                <span class="kbd mono" aria-label="局部修改状态">${esc(editBaseText)}${editHasBase ? ` | ${esc(editSelText)}` : ''}</span>
              </div>
              ${
                editHasBase
                  ? `<div class="editArea" aria-label="局部修改选区">
                      <div id="edit-img-wrap" class="editWrap" aria-label="拖拽选择矩形区域">
                        <img id="edit-base-img" alt="待局部修改的图片" src="${esc(edit.baseDataUrl)}" draggable="false" />
                        <div id="edit-sel-rect" class="selRect" style="${esc(editRectStyle)}"></div>
                      </div>
                    </div>
                    <div class="meta">在图片上拖拽选择矩形区域；会把返回结果贴回该区域。</div>`
                  : `<div class="editArea" aria-label="未选择图片"><div class="empty">未选择图片，点击“选择图片”。</div></div>`
              }
              <div class="row refTop" style="margin-top:10px">
                <span class="meta" style="margin-top:0">参考图</span>
                <button class="btn" data-act="pick-ref-images">外部参考图</button>
                <button class="btn" data-act="open-ref-library">参考图库</button>
                <span class="kbd mono" aria-label="参考图数量">${state.refImages.length}/${MAX_REF_IMAGES}</span>
              </div>
              <div id="ref-strip" class="refStrip" aria-label="参考图列表">
                ${
                  state.refImages.length
                    ? state.refImages
                        .map(
                          (it) => `<div class="thumb" title="${esc(it.name || '')}">
                            <img alt="参考图" src="${esc(it.dataUrl)}" />
                            <button class="thumbDel" data-act="remove-ref-image" data-ref-id="${esc(it.id)}" aria-label="删除参考图">×</button>
                          </div>`,
                        )
                        .join('')
                    : `<div class="meta" style="margin:2px 0">未选择参考图（可选）</div>`
                }
              </div>
              `
                  : `
              <div class="row refTop">
                <span class="meta" style="margin-top:0">参考图</span>
                <button class="btn" data-act="pick-ref-images">外部参考图</button>
                <button class="btn" data-act="open-ref-library">参考图库</button>
                <span class="kbd mono" aria-label="参考图数量">${state.refImages.length}/${MAX_REF_IMAGES}</span>
              </div>
              <div id="ref-strip" class="refStrip" aria-label="参考图列表">
                ${
                  state.refImages.length
                    ? state.refImages
                        .map(
                          (it) => `<div class="thumb" title="${esc(it.name || '')}">
                            <img alt="参考图" src="${esc(it.dataUrl)}" />
                            <button class="thumbDel" data-act="remove-ref-image" data-ref-id="${esc(it.id)}" aria-label="删除参考图">×</button>
                          </div>`,
                        )
                        .join('')
                    : `<div class="meta" style="margin:2px 0">未选择参考图（可选）</div>`
                }
              </div>
              `
              }
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
    if (render._scheduled) return
    render._scheduled = true
    requestAnimationFrame(() => {
      render._scheduled = false
      const html = view()
      if (html === render._lastHtml) return
      render._lastHtml = html
      root.innerHTML = html
    })
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

      if (act === 'back') {
        api.ui?.back ? api.ui.back() : api.ui?.showToast?.('无法返回')
        return
      }

      if (act === 'toggle-ui-mode') {
        if (!state.data) return
        const cur = normalizeUiMode(state.data.uiMode)
        state.data.uiMode = cur === UI_MODE_LOCAL_EDIT ? UI_MODE_NORMAL : UI_MODE_LOCAL_EDIT
        state.error = ''
        save().catch(() => {})
        render()
        return
      }

      if (act === 'open-settings') {
        openSettings()
      } else if (act === 'close-modal') {
        if (state.modal === 'confirm-delete-provider') return cancelDeleteProviderConfirm()
        state.modal = ''
        state.revealApiKey = false
        render()
      } else if (act === 'cancel-delete-provider') {
        cancelDeleteProviderConfirm()
      } else if (act === 'confirm-delete-provider') {
        confirmDeleteProvider()
      } else if (act === 'open-ref-library') {
        openRefLibrary()
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
      } else if (act === 'pick-edit-image') {
        pickEditImage()
      } else if (act === 'clear-edit-image') {
        clearEditImage()
      } else if (act === 'clear-edit-selection') {
        clearEditSelection()
      } else if (act === 'pick-ref-images') {
        api.files
          .pickImages(MAX_REF_IMAGES)
          .then(async (picked) => {
            const items = normalizePickedImages(picked)
            if (!items.length) return

            api.ui.showToast('正在处理参考图…')
            let shrunk = 0
            const processed = []
            for (const it of items) {
              const nextUrl = await shrinkRefImageDataUrl(it.dataUrl).catch(() => it.dataUrl)
              if (nextUrl && String(nextUrl).length < String(it.dataUrl).length) shrunk++
              processed.push({ ...it, dataUrl: nextUrl })
            }
            if (shrunk) api.ui.showToast(`已压缩 ${shrunk} 张参考图`)

            const merged = state.refImages.concat(processed).slice(0, MAX_REF_IMAGES)
            if (merged.length < state.refImages.length + processed.length) api.ui.showToast(`参考图最多 ${MAX_REF_IMAGES} 张`)
            state.refImages = merged
            render()
          })
          .catch((e) => api.ui.showToast(`选择图片失败：${String(e?.message || e)}`))
      } else if (act === 'ref-lib-upload') {
        uploadRefLibraryImages()
      } else if (act === 'ref-lib-toggle') {
        const p = String(el.getAttribute('data-path') || '').trim()
        if (!p) return
        toggleRefLibrarySelect(p)
      } else if (act === 'ref-lib-confirm') {
        confirmRefLibrarySelection()
      } else if (act === 'remove-ref-image') {
        const rid = String(el.getAttribute('data-ref-id') || '').trim()
        if (!rid) return
        state.refImages = (Array.isArray(state.refImages) ? state.refImages : []).filter((x) => x && x.id !== rid)
        render()
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
        openDeleteProviderConfirm(String(p.id || ''), state.modal || 'settings')
      }
    })

    // 懒加载：参考图库滚动到接近底部时自动加载下一批
    root.addEventListener(
      'scroll',
      (e) => {
        if (state.modal !== 'ref-library') return
        const t = e && e.target
        if (!t || !t.getAttribute) return
        if (String(t.getAttribute('id') || '') !== 'ref-lib-scroll') return

        const top = Number(t.scrollTop) || 0
        const h = Number(t.clientHeight) || 0
        const sh = Number(t.scrollHeight) || 0
        if (top + h >= sh - 240) loadMoreRefLibrary()
      },
      true,
    )

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

    function isLocalEditMode() {
      return !!(state.data && normalizeUiMode(state.data.uiMode) === UI_MODE_LOCAL_EDIT)
    }

    function pointToFrac(e) {
      const img = document.getElementById('edit-base-img')
      if (!img || !(img instanceof HTMLImageElement)) return null
      const r = img.getBoundingClientRect()
      if (!r || !r.width || !r.height) return null
      const x = clamp01((Number(e?.clientX) - r.left) / r.width)
      const y = clamp01((Number(e?.clientY) - r.top) / r.height)
      return { x, y }
    }

    function applyOverlayStyle(sel) {
      const el = document.getElementById('edit-sel-rect')
      if (!el) return
      const s = normalizeSelRect(sel)
      if (!s) {
        el.setAttribute('style', 'display:none;')
        return
      }
      el.setAttribute(
        'style',
        `left:${(s.x * 100).toFixed(3)}%; top:${(s.y * 100).toFixed(3)}%; width:${(s.w * 100).toFixed(3)}%; height:${(s.h * 100).toFixed(3)}%;`,
      )
    }

    root.addEventListener('pointerdown', (e) => {
      if (!isLocalEditMode()) return
      if (!String(state.edit?.baseDataUrl || '').trim()) return

      const raw = e.target
      const node = raw && raw.nodeType === 3 ? raw.parentElement : raw
      if (!node || !node.closest) return
      const wrap = node.closest('#edit-img-wrap')
      if (!wrap) return

      const pt = pointToFrac(e)
      if (!pt) return

      state.edit.drag = { pointerId: e.pointerId, startX: pt.x, startY: pt.y }
      state.edit.sel = { x: pt.x, y: pt.y, w: 0, h: 0 }
      applyOverlayStyle(state.edit.sel)
      try {
        wrap.setPointerCapture(e.pointerId)
      } catch {}
      e.preventDefault()
    })

    root.addEventListener('pointermove', (e) => {
      if (!isLocalEditMode()) return
      const d = state.edit && state.edit.drag ? state.edit.drag : null
      if (!d || d.pointerId !== e.pointerId) return

      const pt = pointToFrac(e)
      if (!pt) return

      const x0 = clamp01(d.startX)
      const y0 = clamp01(d.startY)
      const x1 = pt.x
      const y1 = pt.y
      const x = Math.min(x0, x1)
      const y = Math.min(y0, y1)
      const w = Math.abs(x1 - x0)
      const h = Math.abs(y1 - y0)
      state.edit.sel = { x, y, w, h }
      applyOverlayStyle(state.edit.sel)
      e.preventDefault()
    })

    function endPointerDrag(e) {
      if (!isLocalEditMode()) return
      const d = state.edit && state.edit.drag ? state.edit.drag : null
      if (!d || d.pointerId !== e.pointerId) return
      state.edit.drag = null
      state.edit.sel = normalizeSelRect(state.edit.sel)
      applyOverlayStyle(state.edit.sel)
      render()
    }

    root.addEventListener('pointerup', endPointerDrag)
    root.addEventListener('pointercancel', endPointerDrag)
  }

  bindEvents()
  load()
})()
