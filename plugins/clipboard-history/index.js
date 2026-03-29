// clipboard-history (iframe sandbox)
;(function () {
  const PLUGIN_ID = 'clipboard-history'
  const STORE_PATH = 'plugins/clipboard-history.json'

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
      const text = String(message || '').trim()
      if (!text) return
      d.textContent = text
      d.style.opacity = '1'
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (d && d.isConnected) d.style.opacity = '0'
      }, 1800)
    }
  }

  function createCompatApi(baseApi) {
    const base = baseApi || {}
    const tauri = base && base.tauri ? base.tauri : null
    if (!tauri || typeof tauri.invoke !== 'function') {
      throw new Error('tauri.invoke 不可用（请更新宿主网关）')
    }

    const toast = createToast()

    let storeRid = null
    let storeInitPromise = null

    async function ensureStore() {
      if (storeRid) return storeRid
      if (storeInitPromise) return storeInitPromise
      storeInitPromise = Promise.resolve()
        .then(async () => {
          const rid = await tauri.invoke({ command: 'plugin:store|load', payload: { path: STORE_PATH } })
          if (!rid) throw new Error('store rid 无效')
          storeRid = rid
          return rid
        })
        .finally(() => {
          storeInitPromise = null
        })
      return storeInitPromise
    }

    async function storeGetRaw(rid, key) {
      const r = await tauri.invoke({ command: 'plugin:store|get', payload: { rid, key: String(key || '') } })
      if (Array.isArray(r) && r[1]) return r[0]
      return null
    }

    async function storeSetRaw(rid, key, value) {
      await tauri.invoke({ command: 'plugin:store|set', payload: { rid, key: String(key || ''), value } })
    }

    async function storeSave(rid) {
      await tauri.invoke({ command: 'plugin:store|save', payload: { rid } })
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
      clipboard: {
        ...(base.clipboard || {}),
        writeText: async (text) => {
          await tauri.invoke({ command: 'plugin:clipboard-manager|write_text', payload: { text: String(text || '') } })
        },
        writeImage: async (dataUrl) => {
          const u = String(dataUrl || '').trim()
          if (!u || !u.startsWith('data:')) throw new Error('writeImage only supports data URL currently')
          await tauri.invoke({ command: 'clipboard_write_image_data_url', payload: { dataUrl: u } })
        },
      },
      storage: {
        get: async (key) => {
          const rid = await ensureStore()
          return storeGetRaw(rid, String(key || ''))
        },
        set: async (key, value) => {
          const rid = await ensureStore()
          await storeSetRaw(rid, String(key || ''), value)
          await storeSave(rid)
        },
        remove: async (key) => {
          const rid = await ensureStore()
          await tauri.invoke({ command: 'plugin:store|delete', payload: { rid, key: String(key || '') } })
          await storeSave(rid)
        },
        getAll: async () => {
          const rid = await ensureStore()
          const entries = await tauri.invoke({ command: 'plugin:store|entries', payload: { rid } })
          const out = {}
          if (Array.isArray(entries)) {
            for (const pair of entries) {
              if (!Array.isArray(pair) || pair.length < 2) continue
              out[String(pair[0] || '')] = pair[1]
            }
          }
          return out
        },
        setAll: async (data) => {
          const rid = await ensureStore()
          const m = data && typeof data === 'object' ? data : {}
          for (const k of Object.keys(m)) {
            await storeSetRaw(rid, k, m[k])
          }
          await storeSave(rid)
        },
      },
      files: {
        ...(base.files || {}),
        images: {
          ...((base.files && base.files.images) || {}),
          read: async (req) => {
            return tauri.invoke({ command: 'plugin_images_read', payload: { pluginId: PLUGIN_ID, req } })
          },
          delete: async (req) => {
            return tauri.invoke({ command: 'plugin_images_delete', payload: { pluginId: PLUGIN_ID, req } })
          },
        },
      },
      task: {
        create: async (req) => {
          const kind = String(req && req.kind ? req.kind : '').trim()
          if (!kind) throw new Error('task kind is required')
          return tauri.invoke({
            command: 'task_create',
            payload: { pluginId: PLUGIN_ID, req: { kind, payload: req && 'payload' in req ? req.payload : null } },
          })
        },
        get: async (taskId) => {
          const tid = String(taskId || '').trim()
          if (!tid) return null
          return tauri.invoke({ command: 'task_get', payload: { pluginId: PLUGIN_ID, taskId: tid } })
        },
        list: async (limit) => {
          const lim = typeof limit === 'number' && Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : null
          return tauri.invoke({ command: 'task_list', payload: { pluginId: PLUGIN_ID, limit: lim } })
        },
        cancel: async (taskId) => {
          const tid = String(taskId || '').trim()
          if (!tid) throw new Error('taskId is required')
          return tauri.invoke({ command: 'task_cancel', payload: { pluginId: PLUGIN_ID, taskId: tid } })
        },
      },
    }
  }

  const api = createCompatApi(window.fastWindow)
  window.fastWindow = api
  const runtime = String((api && api.__meta && api.__meta.runtime) || 'ui')

  const STORAGE_KEY = 'history'
  const SETTINGS_KEY = 'settings'
  const DELETED_KEY = 'deletedHistory'
  const COLLECTIONS_KEY = 'collections'
  const RECENT_FOLDERS_KEY = 'recentFolders'
  const TASK_KIND_CLIPBOARD_WATCH = 'clipboard.watch'
  const TASK_QUERY_INTERVAL = 250
  const CLIPBOARD_PAGE_SIZE = 40

  const DEFAULT_SETTINGS = {
    maxHistory: 50,
    autoMonitor: true,
    pollInterval: 1000,
    collapseLines: 6,
  }

  if (runtime === 'background') {
    const BG_TICK_INTERVAL = 600
    const bgState = {
      monitorTaskId: '',
      settings: { ...DEFAULT_SETTINGS },
      history: [],
      deleted: {},
      ticking: false,
    }

    function bgIsPlainObject(v) {
      return !!v && typeof v === 'object' && !Array.isArray(v)
    }

    function now() {
      return Date.now()
    }

    function historyUniqKey(item) {
      return `${item.type}\n${item.content}`
    }

    function bgNormalizeDeletedMap(raw) {
      const map = raw && typeof raw === 'object' ? raw : {}
      const out = {}
      const maxAgeMs = 30 * 24 * 60 * 60 * 1000
      const cutoff = now() - maxAgeMs
      for (const k of Object.keys(map)) {
        const v = Number(map[k])
        if (!Number.isFinite(v) || v <= 0) continue
        if (v < cutoff) continue
        out[String(k)] = Math.floor(v)
      }
      const items = Object.entries(out).sort((a, b) => Number(b[1]) - Number(a[1]))
      if (items.length <= 800) return out
      const pruned = {}
      for (const [k, v] of items.slice(0, 800)) pruned[k] = v
      return pruned
    }

    function bgIsDeleted(item) {
      const k = historyUniqKey(item)
      const deletedAt = Number(bgState.deleted && bgState.deleted[k] ? bgState.deleted[k] : 0)
      if (!deletedAt) return false
      const t = Number(item && item.time ? item.time : 0)
      return Number.isFinite(t) && t > 0 ? t <= deletedAt : true
    }

    function bgNormalizeSettings(raw) {
      const merged = raw && typeof raw === 'object' ? { ...DEFAULT_SETTINGS, ...raw } : { ...DEFAULT_SETTINGS }
      const pollRaw = Number(merged.pollInterval)
      const maxRaw = Number(merged.maxHistory)
      const collapseRaw = Number(merged.collapseLines)
      return {
        autoMonitor: merged.autoMonitor !== false,
        pollInterval: Math.min(15000, Math.max(200, Number.isFinite(pollRaw) ? Math.floor(pollRaw) : DEFAULT_SETTINGS.pollInterval)),
        maxHistory: Math.min(1000, Math.max(10, Number.isFinite(maxRaw) ? Math.floor(maxRaw) : DEFAULT_SETTINGS.maxHistory)),
        collapseLines: Math.min(50, Math.max(1, Number.isFinite(collapseRaw) ? Math.floor(collapseRaw) : DEFAULT_SETTINGS.collapseLines)),
      }
    }

    function bgNormalizeHistoryItem(raw) {
      const type = raw && raw.type === 'image' ? 'image' : 'text'
      const content = String(raw && raw.content ? raw.content : '').trim()
      if (!content) return null
      const timeRaw = Number(raw && raw.time)
      const path = type === 'image' && raw && typeof raw.path === 'string' ? String(raw.path).trim() : ''
      const out = {
        type,
        content,
        time: Number.isFinite(timeRaw) && timeRaw > 0 ? Math.floor(timeRaw) : now(),
      }
      if (type === 'image' && path) out.path = path
      return out
    }

    function bgNormalizeHistoryItems(raw, limit = bgState.settings.maxHistory) {
      const list = Array.isArray(raw) ? raw : []
      const out = []
      const seen = new Set()
      for (const item of list) {
        const normalized = bgNormalizeHistoryItem(item)
        if (!normalized) continue
        const key = historyUniqKey(normalized)
        if (seen.has(key)) continue
        seen.add(key)
        out.push(normalized)
        if (out.length >= limit) break
      }
      return out
    }

    function bgMergeHistoryItems(primary, secondary, limit = bgState.settings.maxHistory) {
      const map = new Map()
      const merged = [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])]
      for (const item of merged) {
        const normalized = bgNormalizeHistoryItem(item)
        if (!normalized) continue
        const key = historyUniqKey(normalized)
        const prev = map.get(key)
        if (!prev || normalized.time > prev.time) {
          map.set(key, normalized)
        }
      }
      return Array.from(map.values())
        .sort((a, b) => b.time - a.time)
        .slice(0, limit)
    }

    function bgIsSameHistory(a, b) {
      const listA = Array.isArray(a) ? a : []
      const listB = Array.isArray(b) ? b : []
      if (listA.length !== listB.length) return false
      for (let i = 0; i < listA.length; i++) {
        const left = listA[i]
        const right = listB[i]
        if (!left || !right) return false
        if (left.type !== right.type || left.content !== right.content || left.time !== right.time) return false
        if (left.type === 'image' && String(left.path || '') !== String(right.path || '')) return false
      }
      return true
    }

    function bgNormalizeHostSnapshotItems(result) {
      const latest = bgNormalizeHistoryItem(result && result.latest)
      const items = bgNormalizeHistoryItems(result && result.items, bgState.settings.maxHistory)
      if (latest) {
        return bgMergeHistoryItems([latest], items, bgState.settings.maxHistory)
      }
      return items
    }

    async function bgSaveHistoryIfChanged(next) {
      if (bgIsSameHistory(bgState.history, next)) return
      bgState.history = next
      await api.storage.set(STORAGE_KEY, bgState.history).catch(() => {})
    }

    async function bgLoadState() {
      const [savedHistory, savedSettings, savedDeleted] = await Promise.all([
        api.storage.get(STORAGE_KEY).catch(() => null),
        api.storage.get(SETTINGS_KEY).catch(() => null),
        api.storage.get(DELETED_KEY).catch(() => null),
      ])

      // 注意：storage.get 在失败时会返回 null；把 null 当成“设置变回默认”会导致误清理历史。
      // 这里仅在读到对象时才采用并回写（KISS：宁可不纠正，也别误删用户数据）。
      const settingsOk = bgIsPlainObject(savedSettings)
      if (settingsOk) bgState.settings = bgNormalizeSettings(savedSettings)

      const deletedOk = bgIsPlainObject(savedDeleted)
      if (deletedOk) bgState.deleted = bgNormalizeDeletedMap(savedDeleted)

      const limit = settingsOk ? bgState.settings.maxHistory : 1000
      bgState.history = bgNormalizeHistoryItems(savedHistory, limit).filter((it) => !bgIsDeleted(it))

      if (Array.isArray(savedHistory)) await api.storage.set(STORAGE_KEY, bgState.history).catch(() => {})
      if (settingsOk) await api.storage.set(SETTINGS_KEY, bgState.settings).catch(() => {})
      if (deletedOk) await api.storage.set(DELETED_KEY, bgState.deleted).catch(() => {})
    }

    function bgPickRunningMonitorTask(tasks) {
      if (!Array.isArray(tasks)) return null
      return (
        tasks.find((t) => {
          const status = String(t && t.status ? t.status : '')
          const kind = String(t && t.kind ? t.kind : '')
          return (status === 'queued' || status === 'running') && kind === TASK_KIND_CLIPBOARD_WATCH
        }) || null
      )
    }

    async function bgEnsureMonitorTaskRunning() {
      if (!bgState.settings.autoMonitor) {
        if (bgState.monitorTaskId) {
          await api.task.cancel(bgState.monitorTaskId).catch(() => {})
        }
        bgState.monitorTaskId = ''
        return
      }

      if (bgState.monitorTaskId) return

      const recentTasks = await api.task.list(40).catch(() => [])
      const runningTask = bgPickRunningMonitorTask(recentTasks)
      if (runningTask && runningTask.id) {
        bgState.monitorTaskId = String(runningTask.id)
        return
      }

      const task = await api.task
        .create({
          kind: TASK_KIND_CLIPBOARD_WATCH,
          payload: {
            intervalMs: bgState.settings.pollInterval,
            maxHistory: bgState.settings.maxHistory,
          },
        })
        .catch(() => null)
      const tid = String(task && task.id ? task.id : '').trim()
      if (tid) bgState.monitorTaskId = tid
    }

    async function bgPollMonitorTask() {
      const tid = String(bgState.monitorTaskId || '').trim()
      if (!tid) return

      const task = await api.task.get(tid).catch(() => null)
      if (!task) {
        bgState.monitorTaskId = ''
        return
      }

      const status = String(task.status || '')
      if (status === 'queued' || status === 'running' || status === 'succeeded') {
        const result = task && task.result && typeof task.result === 'object' ? task.result : {}
        const snapshotItems = bgNormalizeHostSnapshotItems(result).filter((it) => !bgIsDeleted(it))
        const base = (Array.isArray(bgState.history) ? bgState.history : []).filter((it) => !bgIsDeleted(it))
        const merged = bgMergeHistoryItems(base, snapshotItems, bgState.settings.maxHistory)
        await bgSaveHistoryIfChanged(merged)
      }

      if (status === 'succeeded' || status === 'failed' || status === 'canceled') {
        bgState.monitorTaskId = ''
      }
    }

    async function bgTick() {
      if (bgState.ticking) return
      bgState.ticking = true
      try {
        const savedSettings = await api.storage.get(SETTINGS_KEY).catch(() => null)
        if (bgIsPlainObject(savedSettings)) {
          const nextSettings = bgNormalizeSettings(savedSettings)
          const settingsChanged = JSON.stringify(nextSettings) !== JSON.stringify(bgState.settings)
          if (settingsChanged) {
            bgState.settings = nextSettings
            const normalized = bgNormalizeHistoryItems(bgState.history, bgState.settings.maxHistory)
            await bgSaveHistoryIfChanged(normalized)
            bgState.monitorTaskId = ''
          }
        }

        const savedDeleted = await api.storage.get(DELETED_KEY).catch(() => null)
        if (bgIsPlainObject(savedDeleted)) bgState.deleted = bgNormalizeDeletedMap(savedDeleted)
        const filtered = (Array.isArray(bgState.history) ? bgState.history : []).filter((it) => !bgIsDeleted(it))
        await bgSaveHistoryIfChanged(filtered)

        await bgEnsureMonitorTaskRunning()
        await bgPollMonitorTask()
      } finally {
        bgState.ticking = false
      }
    }

    void bgLoadState().finally(() => {
      void bgTick()
      setInterval(() => {
        void bgTick()
      }, BG_TICK_INTERVAL)
    })

    return
  }

  const state = {
    history: [],
    settings: { ...DEFAULT_SETTINGS },
    deleted: {},
    showSettings: false,

    view: 'clipboard', // 'clipboard' | 'folders'

    clipboardSearchQuery: '',
    clipboardLimit: CLIPBOARD_PAGE_SIZE,
    clipboardExpanded: {},
    clipboardImageCache: {},
    clipboardImageLoading: {},

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

    ctxMenu: { open: false, x: 0, y: 0, nodeId: '' },
    movePicker: { open: false, movingId: '', query: '', action: 'move' }, // action: 'move' | 'copy'
    editDialog: { open: false, nodeId: '', folderName: '', itemTitle: '', itemContent: '' },

    monitorTaskId: '',
    monitorQueryTimer: null,
    monitorQuerying: false,
    persistTimer: null,
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
    .meta { font-size: 11px; color: var(--muted); white-space: nowrap; }
    .clipTools { display: flex; align-items: center; gap: 8px; }
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
    .text.clamp {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: var(--clamp-lines, 6);
      overflow: hidden;
    }
    .textWrap { display: flex; flex-direction: column; gap: 6px; }
    .textWrap.clipTextWrap {
      display: grid;
      grid-template-columns: 1fr auto;
      column-gap: 10px;
      row-gap: 6px;
      align-items: start;
    }
    .textWrap.clipTextWrap [data-role="clipText"] { grid-column: 1; grid-row: 1; min-width: 0; }
    .textWrap.clipTextWrap .clipTools { grid-column: 2; grid-row: 1; justify-self: end; }
    .textWrap.clipTextWrap button[data-role="foldBtn"] { grid-column: 1 / -1; grid-row: 2; }
    .foldBtn { border: none; background: transparent; color: var(--primary); cursor: pointer; font-size: 12px; padding: 0; }
    .foldBtn.hidden { display: none; }
    .imgPlaceholder {
      width: 100%;
      max-height: 220px;
      min-height: 120px;
      border: 1px dashed var(--outline);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--muted);
      background: rgba(0,0,0,0.02);
    }
    .loadMoreRow { padding: 10px 12px; border-top: 1px solid var(--outline); display: flex; justify-content: center; background: var(--surface); }
    .imgWrap { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; position: relative; }
    .imgWrap .clipTools { position: absolute; top: 0; right: 0; }
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

    .overlay { position: fixed; inset: 0; z-index: 80; display: none; }
    .overlay.open { display: block; }
    .backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.10); }
    .ctxMenu {
      position: absolute;
      background: var(--surface);
      border: 1px solid var(--outline);
      border-radius: 12px;
      box-shadow: var(--shadow);
      overflow: hidden;
      min-width: 220px;
      z-index: 90;
    }
    .dialog {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: min(560px, 92vw);
      max-height: 80vh;
      background: var(--surface);
      border: 1px solid var(--outline);
      border-radius: 12px;
      box-shadow: var(--shadow);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      z-index: 90;
    }
    .dialogHeader { padding: 10px 12px; border-bottom: 1px solid var(--outline); display: flex; align-items: center; gap: 8px; }
    .dialogTitle { font-weight: 700; font-size: 13px; }
    .dialogBody { padding: 10px; overflow: auto; }
    .dialogList { margin-top: 10px; border: 1px solid var(--outline); border-radius: 12px; overflow: hidden; }

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

  function historyUniqKey(item) {
    return `${item.type}\n${item.content}`
  }

  function normalizeDeletedMap(raw) {
    const map = raw && typeof raw === 'object' ? raw : {}
    const out = {}
    const maxAgeMs = 30 * 24 * 60 * 60 * 1000
    const cutoff = now() - maxAgeMs
    for (const k of Object.keys(map)) {
      const v = Number(map[k])
      if (!Number.isFinite(v) || v <= 0) continue
      if (v < cutoff) continue
      out[String(k)] = Math.floor(v)
    }
    const items = Object.entries(out).sort((a, b) => Number(b[1]) - Number(a[1]))
    if (items.length <= 800) return out
    const pruned = {}
    for (const [k, v] of items.slice(0, 800)) pruned[k] = v
    return pruned
  }

  function markDeleted(item) {
    if (!item || !item.type || !item.content) return
    state.deleted = normalizeDeletedMap({ ...(state.deleted || {}), [historyUniqKey(item)]: now() })
  }

  function isDeleted(item) {
    const k = historyUniqKey(item)
    const deletedAt = Number(state.deleted && state.deleted[k] ? state.deleted[k] : 0)
    if (!deletedAt) return false
    const t = Number(item && item.time ? item.time : 0)
    return Number.isFinite(t) && t > 0 ? t <= deletedAt : true
  }

  function mergeHistoryItems(primary, secondary, limit = state.settings.maxHistory) {
    const map = new Map()
    const merged = [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])]
    for (const item of merged) {
      const normalized = normalizeHistoryItem(item)
      if (!normalized) continue
      const key = historyUniqKey(normalized)
      const prev = map.get(key)
      if (!prev || normalized.time > prev.time) {
        map.set(key, normalized)
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.time - a.time)
      .slice(0, limit)
  }

  function isSameHistory(a, b) {
    const listA = Array.isArray(a) ? a : []
    const listB = Array.isArray(b) ? b : []
    if (listA.length !== listB.length) return false
    for (let i = 0; i < listA.length; i++) {
      const left = listA[i]
      const right = listB[i]
      if (!left || !right) return false
      if (left.type !== right.type || left.content !== right.content || left.time !== right.time) return false
      if (left.type === 'image' && String(left.path || '') !== String(right.path || '')) return false
    }
    return true
  }

  function upsertHistoryItem(item) {
    state.history = mergeHistoryItems([item], state.history, state.settings.maxHistory)
  }

  function replaceInternalImageIfNeeded(internalContent, newContent) {
    if (!internalContent || internalContent === newContent) return
    const item = { type: 'image', content: newContent, time: now() }
    state.history = [item, ...state.history.filter((it) => !(it.type === 'image' && (it.content === internalContent || it.content === newContent)))]
      .slice(0, state.settings.maxHistory)
  }

  function normalizeSettings(raw) {
    const merged = raw && typeof raw === 'object' ? { ...DEFAULT_SETTINGS, ...raw } : { ...DEFAULT_SETTINGS }
    const pollRaw = Number(merged.pollInterval)
    const maxRaw = Number(merged.maxHistory)
    const collapseRaw = Number(merged.collapseLines)
    return {
      autoMonitor: merged.autoMonitor !== false,
      pollInterval: Math.min(15000, Math.max(200, Number.isFinite(pollRaw) ? Math.floor(pollRaw) : DEFAULT_SETTINGS.pollInterval)),
      maxHistory: Math.min(1000, Math.max(10, Number.isFinite(maxRaw) ? Math.floor(maxRaw) : DEFAULT_SETTINGS.maxHistory)),
      collapseLines: Math.min(50, Math.max(1, Number.isFinite(collapseRaw) ? Math.floor(collapseRaw) : DEFAULT_SETTINGS.collapseLines)),
    }
  }

  function normalizeHistoryItem(raw) {
    const type = raw && raw.type === 'image' ? 'image' : 'text'
    const content = String(raw && raw.content ? raw.content : '').trim()
    if (!content) return null
    const timeRaw = Number(raw && raw.time)
    const path = type === 'image' && raw && typeof raw.path === 'string' ? String(raw.path).trim() : ''
    const out = {
      type,
      content,
      time: Number.isFinite(timeRaw) && timeRaw > 0 ? Math.floor(timeRaw) : now(),
    }
    if (type === 'image' && path) out.path = path
    return out
  }

  function normalizeHistoryItems(raw, limit = state.settings.maxHistory) {
    const list = Array.isArray(raw) ? raw : []
    const out = []
    const seen = new Set()
    for (const item of list) {
      const normalized = normalizeHistoryItem(item)
      if (!normalized) continue
      const key = historyUniqKey(normalized)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(normalized)
      if (out.length >= limit) break
    }
    return out
  }

  function normalizeHostSnapshotItems(result) {
    const latest = normalizeHistoryItem(result && result.latest)
    const items = normalizeHistoryItems(result && result.items, state.settings.maxHistory)
    if (latest) {
      return mergeHistoryItems([latest], items, state.settings.maxHistory)
    }
    return items
  }

  function stopMonitorQueryLoop() {
    if (state.monitorQueryTimer) {
      clearTimeout(state.monitorQueryTimer)
      state.monitorQueryTimer = null
    }
    state.monitorQuerying = false
  }

  function schedulePersistClipboard(delayMs = 120) {
    if (state.persistTimer) {
      clearTimeout(state.persistTimer)
      state.persistTimer = null
    }
    state.persistTimer = setTimeout(() => {
      state.persistTimer = null
      void persistClipboard()
    }, Math.max(0, Number(delayMs) || 0))
  }

  async function syncFromMonitorTaskSnapshot(task) {
    const result = task && task.result && typeof task.result === 'object' ? task.result : {}
    const snapshotItems = normalizeHostSnapshotItems(result).filter((it) => !isDeleted(it))
    const merged = mergeHistoryItems(
      (Array.isArray(state.history) ? state.history : []).filter((it) => !isDeleted(it)),
      snapshotItems,
      state.settings.maxHistory,
    )
    const changed = !isSameHistory(state.history, merged)
    if (changed) {
      state.history = merged
      schedulePersistClipboard()
      if (state.view === 'clipboard') renderClipboardList()
    }
    const firstText = state.history.find((it) => it && it.type === 'text' && it.content)
    if (firstText) state.currentText = firstText.content
    const firstImage = state.history.find((it) => it && it.type === 'image' && it.content)
    if (firstImage) state.currentImage = firstImage.content
  }

  async function queryMonitorTask(taskId) {
    if (!taskId || state.monitorTaskId !== taskId || state.monitorQuerying) return
    state.monitorQuerying = true
    try {
      const task = await api.task.get(taskId).catch(() => null)
      if (!task || state.monitorTaskId !== taskId) return

      const status = String(task.status || '')
      if (status === 'running' || status === 'queued') {
        await syncFromMonitorTaskSnapshot(task)
      }

      if (status === 'succeeded') {
        await syncFromMonitorTaskSnapshot(task)
        state.monitorTaskId = ''
        if (state.settings.autoMonitor) {
          await ensureMonitorTaskRunning(true)
        }
        return
      }

      if (status === 'failed' || status === 'canceled') {
        state.monitorTaskId = ''
        if (state.settings.autoMonitor) {
          await ensureMonitorTaskRunning(true)
        }
        return
      }

      state.monitorQueryTimer = setTimeout(() => {
        state.monitorQuerying = false
        queryMonitorTask(taskId)
      }, TASK_QUERY_INTERVAL)
      return
    } finally {
      state.monitorQuerying = false
    }
  }

  async function ensureMonitorTaskRunning(forceCreate = false) {
    stopMonitorQueryLoop()
    if (!state.settings.autoMonitor) {
      if (state.monitorTaskId) {
        await api.task.cancel(state.monitorTaskId).catch(() => {})
      }
      state.monitorTaskId = ''
      return
    }

    if (!forceCreate && state.monitorTaskId) {
      queryMonitorTask(state.monitorTaskId)
      return
    }

    if (state.monitorTaskId) {
      await api.task.cancel(state.monitorTaskId).catch(() => {})
      state.monitorTaskId = ''
    }

    const task = await api.task
      .create({
        kind: TASK_KIND_CLIPBOARD_WATCH,
        payload: {
          intervalMs: state.settings.pollInterval,
          maxHistory: state.settings.maxHistory,
        },
      })
      .catch(() => null)
    const tid = String(task && task.id ? task.id : '').trim()
    if (!tid) return
    state.monitorTaskId = tid
    queryMonitorTask(tid)
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
      await api.storage.set(DELETED_KEY, state.deleted)
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

  function updateFolderName(folderId, name) {
    if (!state.collections) return false
    const f = getNode(folderId)
    if (!f || f.type !== 'folder') return false
    const safeName = (name || '').trim() || '未命名收藏夹'
    f.name = safeName
    f.updatedAt = now()
    persistCollections()
    return true
  }

  function updateItem(itemId, title, content) {
    if (!state.collections) return false
    const it = getNode(itemId)
    if (!it || it.type !== 'item') return false
    const safeContent = (content || '').trim()
    if (!safeContent) return false
    const safeTitle = (title || '').trim() || safeContent.split(/\r?\n/)[0].slice(0, 24) || '未命名条目'
    it.title = safeTitle
    it.content = safeContent
    it.updatedAt = now()
    persistCollections()
    return true
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

  function closeOverlays() {
    state.ctxMenu.open = false
    state.ctxMenu.nodeId = ''
    state.movePicker.open = false
    state.movePicker.movingId = ''
    state.movePicker.query = ''
    state.movePicker.action = 'move'
    state.editDialog.open = false
    state.editDialog.nodeId = ''
    state.editDialog.folderName = ''
    state.editDialog.itemTitle = ''
    state.editDialog.itemContent = ''
  }

  function renderMovePickerList() {
    const list = document.querySelector('[data-area="movePickList"]')
    if (!(list instanceof HTMLElement)) return
    if (!state.collections) return

    const movingId = state.movePicker.movingId
    const moving = getNode(movingId)
    if (!moving || (moving.type !== 'folder' && moving.type !== 'item')) {
      list.innerHTML = '<div class="menuHeader">无效的条目</div>'
      return
    }

    const q = (state.movePicker.query || '').trim().toLowerCase()
    const folders = Object.values(state.collections.nodes || {})
      .filter((n) => n && n.type === 'folder')
      .map((n) => n.id)
      .filter((id) => canMoveInto(id, movingId))
      .map((id) => ({ id, label: folderLabelById(id) }))
      .filter((x) => (q ? x.label.toLowerCase().includes(q) : true))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'))

    if (!folders.length) {
      list.innerHTML = '<div class="menuHeader">没有可用的目标收藏夹</div>'
      return
    }

    list.innerHTML = folders
      .map((f) => `<button class="menuItem" data-act="movePickTarget" data-id="${escapeHtml(f.id)}">📁 ${escapeHtml(f.label)}</button>`)
      .join('')
  }

  function fitCtxMenuIntoViewport() {
    const el = document.querySelector('[data-role="ctxMenu"]')
    if (!(el instanceof HTMLElement)) return
    const pad = 8
    const rect = el.getBoundingClientRect()
    const maxX = Math.max(pad, window.innerWidth - rect.width - pad)
    const maxY = Math.max(pad, window.innerHeight - rect.height - pad)
    const x = Math.max(pad, Math.min(state.ctxMenu.x, maxX))
    const y = Math.max(pad, Math.min(state.ctxMenu.y, maxY))
    el.style.left = `${x}px`
    el.style.top = `${y}px`
  }

  function renderOverlay() {
    const overlay = document.querySelector('[data-area="overlay"]')
    if (!(overlay instanceof HTMLElement)) return

    if (state.view !== 'folders') closeOverlays()

    if (state.editDialog.open && state.editDialog.nodeId) {
      const n = getNode(state.editDialog.nodeId)
      if (!n || (n.type !== 'folder' && n.type !== 'item')) {
        closeOverlays()
        overlay.className = 'overlay'
        overlay.innerHTML = ''
        return
      }

      const dialogTitle = n.type === 'folder' ? '编辑收藏夹' : '编辑条目'
      const body =
        n.type === 'folder'
          ? `
            <input class="input" placeholder="收藏夹名称" data-act="editFolderName" value="${escapeHtml(state.editDialog.folderName)}" />
          `
          : `
            <input class="input" placeholder="备注（标题）" data-act="editItemTitle" value="${escapeHtml(state.editDialog.itemTitle)}" />
            <textarea class="textarea" placeholder="正文内容（不能为空）" data-act="editItemContent">${escapeHtml(state.editDialog.itemContent)}</textarea>
          `

      overlay.className = 'overlay open'
      overlay.innerHTML = `
        <div class="backdrop" data-act="closeOverlay"></div>
        <div class="dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(dialogTitle)}">
          <div class="dialogHeader">
            <div class="dialogTitle">${escapeHtml(dialogTitle)}</div>
            <span class="spacer"></span>
            <button class="btn" data-act="editCancel">取消</button>
            <button class="btn primary" data-act="editSave">保存</button>
          </div>
          <div class="dialogBody">${body}</div>
        </div>
      `

      const focusEl = overlay.querySelector('input[data-act="editFolderName"], input[data-act="editItemTitle"], textarea[data-act="editItemContent"]')
      if (focusEl instanceof HTMLElement) {
        setTimeout(() => {
          try {
            focusEl.focus()
            if (focusEl instanceof HTMLInputElement || focusEl instanceof HTMLTextAreaElement) {
              focusEl.setSelectionRange(focusEl.value.length, focusEl.value.length)
            }
          } catch {}
        }, 0)
      }
      return
    }

    if (state.movePicker.open) {
      const moving = getNode(state.movePicker.movingId)
      const action = state.movePicker.action === 'copy' ? 'copy' : 'move'
      const isFolderMove = !!moving && moving.type === 'folder' && action === 'move'
      const kindLabel = moving && moving.type === 'folder' ? '收藏夹' : '条目'
      const name = moving && moving.type === 'folder' ? moving.name : moving && moving.type === 'item' ? (moving.title || '') : ''
      const dialogTitle = `${action === 'copy' ? '复制' : '移动'}${kindLabel}`
      const hintVerb = action === 'copy' ? '复制到' : '移动到'
      overlay.className = 'overlay open'
      overlay.innerHTML = `
        <div class="backdrop" data-act="closeOverlay"></div>
        <div class="dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(dialogTitle)}">
          <div class="dialogHeader">
            <div class="dialogTitle">${escapeHtml(dialogTitle)}</div>
            <span class="spacer"></span>
            <button class="btn" data-act="movePickCancel">取消</button>
          </div>
          <div class="dialogBody">
            <div class="hint">
              <span>将「${escapeHtml(name)}」${hintVerb}：</span>
              ${isFolderMove ? '<span>不能移动到自身或子收藏夹</span>' : ''}
            </div>
            <input class="input" placeholder="搜索目标收藏夹（按路径）" data-act="movePickQuery" value="${escapeHtml(state.movePicker.query)}" />
            <div class="dialogList" data-area="movePickList"></div>
          </div>
        </div>
      `
      renderMovePickerList()
      const input = overlay.querySelector('input[data-act="movePickQuery"]')
      if (input instanceof HTMLInputElement) {
        setTimeout(() => {
          try {
            input.focus()
            input.setSelectionRange(input.value.length, input.value.length)
          } catch {}
        }, 0)
      }
      return
    }

    if (state.ctxMenu.open && state.ctxMenu.nodeId) {
      const n = getNode(state.ctxMenu.nodeId)
      if (!n || (n.type !== 'folder' && n.type !== 'item')) {
        closeOverlays()
        overlay.className = 'overlay'
        overlay.innerHTML = ''
        return
      }
      const items =
        n.type === 'item'
          ? `
            <button class="menuItem" data-act="ctxEdit">✏️ 编辑</button>
            <button class="menuItem" data-act="ctxCopyTo">📋 复制到...</button>
            <button class="menuItem" data-act="ctxMoveTo">📁 移动到...</button>
          `
          : `
            <button class="menuItem" data-act="ctxEdit">✏️ 编辑</button>
            <button class="menuItem" data-act="ctxMoveTo">📁 移动到...</button>
          `
      overlay.className = 'overlay open'
      overlay.innerHTML = `
        <div class="backdrop" data-act="closeOverlay"></div>
        <div class="ctxMenu" data-role="ctxMenu" style="left:${state.ctxMenu.x}px;top:${state.ctxMenu.y}px">
          ${items}
        </div>
      `
      requestAnimationFrame(fitCtxMenuIntoViewport)
      return
    }

    overlay.className = 'overlay'
    overlay.innerHTML = ''
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
      <div class="overlay" data-area="overlay"></div>
    `

    const topbar = root.querySelector('.topbar')
    if (topbar) {
      topbar.addEventListener('pointerdown', (e) => {
        if (!(e instanceof PointerEvent)) return
        if (e.button !== 0) return
        const t = e.target
        if (!(t instanceof HTMLElement)) return
        if (t.closest('button, a, input, textarea, select, [role="button"]')) return
        api.ui?.startDragging?.()
      })
    }

    root.addEventListener('click', async (e) => {
      const t = e.target
      if (!(t instanceof Element)) return

      const actEl = t.closest?.('[data-act]')
      const act = actEl ? actEl.getAttribute('data-act') : ''
      if (act === 'toggleExpandHistory') {
        const hid = (actEl && actEl.getAttribute('data-hid')) || ''
        if (!hid) return
        if (state.clipboardExpanded[hid]) delete state.clipboardExpanded[hid]
        else state.clipboardExpanded[hid] = true
        renderClipboardList()
        return
      }
      if (act === 'closeOverlay') {
        closeOverlays()
        renderOverlay()
        return
      }
      if (act === 'editCancel') {
        closeOverlays()
        renderOverlay()
        return
      }
      if (act === 'editSave') {
        const nodeId = state.editDialog.nodeId
        const n = getNode(nodeId)
        if (!n || (n.type !== 'folder' && n.type !== 'item')) {
          closeOverlays()
          renderOverlay()
          return
        }

        let ok = false
        if (n.type === 'folder') ok = updateFolderName(nodeId, state.editDialog.folderName)
        else ok = updateItem(nodeId, state.editDialog.itemTitle, state.editDialog.itemContent)

        if (!ok) {
          api.ui?.showToast?.(n.type === 'folder' ? '名称不能为空' : '正文内容不能为空')
          return
        }

        api.ui?.showToast?.('已保存')
        closeOverlays()
        render()
        return
      }
      if (act === 'movePickCancel') {
        closeOverlays()
        renderOverlay()
        return
      }
      if (act === 'ctxEdit') {
        const nodeId = state.ctxMenu.nodeId
        const n = getNode(nodeId)
        closeOverlays()
        if (!n || (n.type !== 'folder' && n.type !== 'item')) {
          renderOverlay()
          return
        }
        state.editDialog.open = true
        state.editDialog.nodeId = nodeId
        if (n.type === 'folder') {
          state.editDialog.folderName = String(n.name || '')
          state.editDialog.itemTitle = ''
          state.editDialog.itemContent = ''
        } else {
          state.editDialog.folderName = ''
          state.editDialog.itemTitle = String(n.title || '')
          state.editDialog.itemContent = String(n.content || '')
        }
        renderOverlay()
        return
      }
      if (act === 'ctxMoveTo') {
        const movingId = state.ctxMenu.nodeId
        const n = getNode(movingId)
        closeOverlays()
        if (n && (n.type === 'folder' || n.type === 'item')) {
          state.movePicker.open = true
          state.movePicker.movingId = movingId
          state.movePicker.query = ''
          state.movePicker.action = 'move'
        }
        renderOverlay()
        return
      }
      if (act === 'ctxCopyTo') {
        const movingId = state.ctxMenu.nodeId
        const n = getNode(movingId)
        closeOverlays()
        if (n && n.type === 'item') {
          state.movePicker.open = true
          state.movePicker.movingId = movingId
          state.movePicker.query = ''
          state.movePicker.action = 'copy'
        }
        renderOverlay()
        return
      }
      if (act === 'movePickTarget') {
        const toParentId = (actEl && actEl.getAttribute('data-id')) || ''
        const movingId = state.movePicker.movingId
        const action = state.movePicker.action === 'copy' ? 'copy' : 'move'
        const moving = getNode(movingId)
        let ok = false
        if (action === 'copy') {
          if (moving && moving.type === 'item') {
            ok = !!createItem(toParentId, moving.title, moving.content)
          }
        } else {
          ok = moveNode(movingId, toParentId)
        }
        if (ok) api.ui?.showToast?.(`${action === 'copy' ? '已复制到' : '已移动到'}：${folderLabelById(toParentId)}`)
        else api.ui?.showToast?.(`${action === 'copy' ? '复制失败' : '移动失败'}`)
        closeOverlays()
        renderOverlay()
        renderFolderList()
        return
      }
      if (act === 'back') {
        api.host?.back ? api.host.back() : api.ui?.showToast?.('无法返回')
        return
      }
      if (act === 'openFolders') {
        state.view = 'folders'
        state.showSettings = false
        state.showRecentMenu = false
        detachClipboardSentinelObserver()
        render()
        return
      }
      if (act === 'openClipboard') {
        state.view = 'clipboard'
        state.showSettings = false
        state.showRecentMenu = false
        state.clipboardLimit = CLIPBOARD_PAGE_SIZE
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
        const folderId = (actEl && actEl.getAttribute('data-id')) || ''
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
        const toDelete = Array.isArray(state.history) ? state.history.slice() : []
        const tasks = []
        for (const it of toDelete) {
          if (!it || it.type !== 'image') continue
          tasks.push(tryDeleteManagedImageFile(it))
        }
        await Promise.allSettled(tasks)
        state.history = []
        state.clipboardExpanded = {}
        state.clipboardImageCache = {}
        state.clipboardImageLoading = {}
        state.clipboardLimit = CLIPBOARD_PAGE_SIZE
        await persistClipboard()
        restartMonitor()
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
        const folderId = (actEl && actEl.getAttribute('data-id')) || ''
        navigateFolder(folderId)
        return
      }
      if (act === 'openFolder') {
        const folderId = (actEl && actEl.getAttribute('data-id')) || ''
        navigateFolder(folderId)
        return
      }
      if (act === 'deleteNode') {
        const nodeId = (actEl && actEl.getAttribute('data-id')) || ''
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
        const itemId = (actEl && actEl.getAttribute('data-id')) || ''
        const it = getNode(itemId)
        if (!it || it.type !== 'item') return
        try {
          await api.clipboard.writeText(it.content)
          api.ui?.showToast?.('复制成功')
        } catch (e) {}
        return
      }
      if (act === 'openItemFolder') {
        const folderId = (actEl && actEl.getAttribute('data-folder-id')) || ''
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

        if (act === 'delHistory') {
          const key = historyKey(item)
          if (!isDeleteArmed(key)) {
            armDelete(key)
            api.ui?.showToast?.('再点一次删除')
            renderClipboardList()
            return
          }
          state.deleteArmedId = ''
          state.deleteArmedAt = 0
          markDeleted(item)
          state.history = state.history.filter((h) => historyKey(h) !== key)
          if (state.clipboardExpanded[key]) delete state.clipboardExpanded[key]
          if (state.clipboardImageCache[key]) delete state.clipboardImageCache[key]
          if (state.clipboardImageLoading[key]) delete state.clipboardImageLoading[key]
          await tryDeleteManagedImageFile(item)
          await persistClipboard()
          api.ui?.showToast?.('已删除')
          renderClipboardList()
          return
        }

        try {
          setInternalCopy(item.type, item.content)
          if (item.type === 'image') {
            const hidKey = historyKey(item)
            let dataUrl = ''
            if (isDataUrl(item.content)) {
              dataUrl = item.content
            } else if (state.clipboardImageCache[hidKey]) {
              dataUrl = state.clipboardImageCache[hidKey]
            } else {
              const path = pickImagePath(item)
              if (path) {
                dataUrl = await api.files.images.read({ scope: 'output', path }).catch(() => '')
                if (dataUrl) state.clipboardImageCache[hidKey] = dataUrl
              }
            }
            if (!dataUrl) throw new Error('image not available')
            await api.clipboard.writeImage(dataUrl)
          } else {
            await api.clipboard.writeText(item.content)
          }

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

    root.addEventListener('contextmenu', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (state.view !== 'folders') return
      if (state.ctxMenu.open || state.movePicker.open || state.editDialog.open) {
        e.preventDefault()
        return
      }

      const card = t.closest?.('[data-role="folderCard"]')
      if (!(card instanceof HTMLElement)) return
      const nodeId = card.getAttribute('data-id') || ''
      const n = getNode(nodeId)
      if (!n || (n.type !== 'folder' && n.type !== 'item')) return

      e.preventDefault()
      state.showRecentMenu = false
      state.showMoreMenu = false
      state.ctxMenu.open = true
      state.ctxMenu.nodeId = nodeId
      state.ctxMenu.x = e.clientX
      state.ctxMenu.y = e.clientY
      renderTopbar()
      renderOverlay()
    })

    root.addEventListener('input', (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const act = t.getAttribute('data-act')
      if (act === 'searchClipboard') {
        state.clipboardSearchQuery = (t instanceof HTMLInputElement ? t.value : '') || ''
        state.clipboardLimit = CLIPBOARD_PAGE_SIZE
        renderClipboardList()
        return
      }
      if (act === 'searchFolders') {
        state.folderSearchQuery = (t instanceof HTMLInputElement ? t.value : '') || ''
        renderFolderList()
        return
      }
      if (act === 'movePickQuery') {
        state.movePicker.query = (t instanceof HTMLInputElement ? t.value : '') || ''
        renderMovePickerList()
        return
      }
      if (act === 'editFolderName') {
        state.editDialog.folderName = (t instanceof HTMLInputElement ? t.value : '') || ''
        return
      }
      if (act === 'editItemTitle') {
        state.editDialog.itemTitle = (t instanceof HTMLInputElement ? t.value : '') || ''
        return
      }
      if (act === 'editItemContent') {
        state.editDialog.itemContent = (t instanceof HTMLTextAreaElement ? t.value : '') || ''
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

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return
      if (!state.ctxMenu.open && !state.movePicker.open && !state.editDialog.open) return
      closeOverlays()
      renderOverlay()
    })

    function endDrag(commit) {
      if (!drag.active) return
      drag.active = false

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

      if (drag.originEl instanceof HTMLElement) {
        drag.originEl.style.display = ''
      }

      if (drag.ghost instanceof HTMLElement) drag.ghost.remove()
      if (drag.placeholder instanceof HTMLElement) drag.placeholder.remove()

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
        <label>折叠行数</label>
        <input type="number" min="1" step="1" value="${state.settings.collapseLines}" data-act="collapseLines" />
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
        state.settings = normalizeSettings({
          ...state.settings,
          autoMonitor: !state.settings.autoMonitor,
        })
        await persistClipboard()
        restartMonitor()
        render()
      }
      if (act === 'saveSettings') {
        const poll = area.querySelector('input[data-act="pollInterval"]')
        const maxH = area.querySelector('input[data-act="maxHistory"]')
        const collapse = area.querySelector('input[data-act="collapseLines"]')
        const pollInterval = poll instanceof HTMLInputElement ? Number(poll.value) : state.settings.pollInterval
        const maxHistory = maxH instanceof HTMLInputElement ? Number(maxH.value) : state.settings.maxHistory
        const collapseLines = collapse instanceof HTMLInputElement ? Number(collapse.value) : state.settings.collapseLines
        state.settings = normalizeSettings({
          ...state.settings,
          pollInterval,
          maxHistory,
          collapseLines,
        })
        state.history = normalizeHistoryItems(state.history, state.settings.maxHistory)
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
        <button class="btn" data-act="back" aria-label="返回主页" title="返回主页">←</button>
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
      <button class="btn" data-act="back" aria-label="返回主页" title="返回主页">←</button>
      <div class="title">收藏夹</div>
      <input class="search" placeholder="${state.folderSearchScope === 'global' ? '全局搜索（标题/内容）' : '当前收藏夹内搜索（含子收藏夹）'}" data-act="searchFolders" value="${escapeHtml(state.folderSearchQuery)}" />
      <button class="btn" data-act="toggleFolderSearchScope">${state.folderSearchScope === 'global' ? '全局' : '当前'}</button>
      <span class="spacer"></span>
      <button class="btn primary" data-act="openClipboard">剪贴板</button>
    `
  }

  function isDataUrl(s) {
    return typeof s === 'string' && s.startsWith('data:')
  }

  function pickImagePath(item) {
    if (!item || item.type !== 'image') return ''
    if (typeof item.path === 'string' && item.path.trim()) return item.path.trim()
    const c = String(item.content || '').trim()
    if (!c || isDataUrl(c)) return ''
    return c
  }

  function basenameFromPath(path) {
    const s = String(path || '').trim()
    if (!s) return ''
    const normalized = s.replaceAll('\\', '/')
    const i = normalized.lastIndexOf('/')
    return i >= 0 ? normalized.slice(i + 1) : normalized
  }

  function isManagedClipboardImagePath(path) {
    const b = basenameFromPath(path)
    return /^clipboard-image-[0-9a-f]{8}\.png$/i.test(b)
  }

  async function tryDeleteManagedImageFile(item) {
    if (!item || item.type !== 'image') return
    const path = pickImagePath(item)
    if (!path) return
    if (!isManagedClipboardImagePath(path)) return
    if (!api.files?.images || typeof api.files.images.delete !== 'function') return
    await api.files.images.delete({ scope: 'output', path }).catch(() => {})
  }

  let clipboardSentinelObserver = null

  function detachClipboardSentinelObserver() {
    try {
      clipboardSentinelObserver?.disconnect?.()
    } catch (e) {}
    clipboardSentinelObserver = null
  }

  function attachClipboardSentinelObserver(listEl, total, limit) {
    detachClipboardSentinelObserver()
    if (!(listEl instanceof HTMLElement)) return
    if (limit >= total) return

    const sentinel = listEl.querySelector('[data-role="clipboardSentinel"]')
    if (!(sentinel instanceof HTMLElement)) return

    const root = document.querySelector('.content')
    const rootEl = root instanceof HTMLElement ? root : null

    clipboardSentinelObserver = new IntersectionObserver(
      (entries) => {
        const hit = entries && entries[0] && entries[0].isIntersecting
        if (!hit) return
        detachClipboardSentinelObserver()
        const next = Math.min(state.settings.maxHistory, limit + CLIPBOARD_PAGE_SIZE, total)
        if (next <= limit) return
        state.clipboardLimit = next
        renderClipboardList()
      },
      {
        root: rootEl,
        rootMargin: '240px 0px',
        threshold: 0,
      },
    )

    try {
      clipboardSentinelObserver.observe(sentinel)
    } catch (e) {}
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

    const total = list.length
    if (!total) {
      detachClipboardSentinelObserver()
      listEl.innerHTML = ''
      listEl.style.display = 'none'
      emptyEl.style.display = 'block'
      emptyEl.textContent = q ? '没有匹配的内容' : '剪贴板历史为空'
      return
    }

    const limit = Math.min(total, Math.max(1, Number(state.clipboardLimit) || CLIPBOARD_PAGE_SIZE))
    const visible = list.slice(0, limit)
    const hasMore = limit < total

    listEl.style.display = 'flex'
    emptyEl.style.display = 'none'

    listEl.innerHTML =
      visible
        .map((it) => {
          const typeLabel = it.type === 'image' ? '图片' : '文本'
          const timeLabel = it.time ? formatTime(it.time) : ''
          const key = historyKey(it)
          const expanded = !!state.clipboardExpanded[key]
          const tools = `
            <div class="clipTools">
              <span class="meta">${escapeHtml(typeLabel)}</span>
              <span class="meta">${escapeHtml(timeLabel)}</span>
              <button class="iconBtn" data-act="delHistory" title="${isDeleteArmed(key) ? '再点一次确认删除' : '删除'}">${isDeleteArmed(key) ? '⚠' : '🗑'}</button>
            </div>`

          if (it.type === 'image') {
            const directDataUrl = isDataUrl(it.content) ? it.content : ''
            const cached = state.clipboardImageCache[key] || directDataUrl || ''
            const body = `
              <div class="textWrap">
                <div class="imgWrap">
                  ${tools}
                  <div class="imgPlaceholder" data-role="imgPh" data-hid="${escapeHtml(key)}" style="${cached ? 'display:none' : ''}">加载中...</div>
                  <img class="img" data-role="lazyImg" data-hid="${escapeHtml(key)}" style="${cached ? '' : 'display:none'}" src="${cached ? escapeHtml(cached) : ''}" />
                  <div class="pill">🖼 图片</div>
                </div>
              </div>`
            return `<div class="card" data-role="clipboardCard" data-hid="${escapeHtml(key)}">${body}</div>`
          }

          const textClass = expanded ? 'text' : 'text clamp'
          const btnClass = expanded ? 'foldBtn' : 'foldBtn hidden'
          const btnLabel = expanded ? '收起' : '展开'
          const body = `
            <div class="textWrap clipTextWrap">
              <div class="${textClass}" data-role="clipText" style="--clamp-lines:${state.settings.collapseLines}">${escapeHtml(it.content || '')}</div>
              ${tools}
              <button class="${btnClass}" data-role="foldBtn" data-act="toggleExpandHistory" data-hid="${escapeHtml(key)}">${btnLabel}</button>
            </div>`
          return `<div class="card" data-role="clipboardCard" data-hid="${escapeHtml(key)}">${body}</div>`
        })
        .join('') +
      (hasMore ? `<div class="loadMoreRow" data-role="clipboardSentinel"><span class="pill">继续下滑加载更多（${limit}/${total}）</span></div>` : '')

    attachClipboardSentinelObserver(listEl, total, limit)

    requestAnimationFrame(() => {
      try {
        const texts = listEl.querySelectorAll('[data-role="clipText"].clamp')
        for (const el of texts) {
          if (!(el instanceof HTMLElement)) continue
          const btn = el.parentElement?.querySelector?.('button[data-role="foldBtn"]')
          if (!(btn instanceof HTMLElement)) continue
          const overflow = el.scrollHeight > el.clientHeight + 1
          if (overflow) btn.classList.remove('hidden')
          else btn.classList.add('hidden')
        }
      } catch (e) {}

      try {
        const imgs = listEl.querySelectorAll('img[data-role="lazyImg"]')
        for (const img of imgs) {
          if (!(img instanceof HTMLImageElement)) continue
          const hid = img.getAttribute('data-hid') || ''
          if (!hid) continue
          if (state.clipboardImageCache[hid]) continue
          if (state.clipboardImageLoading[hid]) continue
          const item = state.history.find((it) => historyKey(it) === hid)
          if (!item || item.type !== 'image') continue

          const cached = state.clipboardImageCache[hid] || ''
          if (cached) continue
          if (isDataUrl(item.content)) {
            state.clipboardImageCache[hid] = item.content
            img.src = item.content
            img.style.display = ''
            const ph = img.parentElement?.querySelector?.('[data-role="imgPh"]')
            if (ph instanceof HTMLElement) ph.style.display = 'none'
            continue
          }

          const path = pickImagePath(item)
          if (!path) {
            const ph = img.parentElement?.querySelector?.('[data-role="imgPh"]')
            if (ph instanceof HTMLElement) ph.textContent = '图片不可用'
            continue
          }

          state.clipboardImageLoading[hid] = true
          void api.files.images
            .read({ scope: 'output', path })
            .then((dataUrl) => {
              const v = String(dataUrl || '')
              if (!v) return
              state.clipboardImageCache[hid] = v
              img.src = v
              img.style.display = ''
              const ph = img.parentElement?.querySelector?.('[data-role="imgPh"]')
              if (ph instanceof HTMLElement) ph.style.display = 'none'
            })
            .catch(() => {
              const ph = img.parentElement?.querySelector?.('[data-role="imgPh"]')
              if (ph instanceof HTMLElement) ph.textContent = '加载失败'
            })
            .finally(() => {
              state.clipboardImageLoading[hid] = false
            })
        }
      } catch (e) {}
    })
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
      renderOverlay()
      return
    }

    renderFoldersSubbar()
    renderItemEditor()
    renderFolderList()
    renderOverlay()
  }

  function restartMonitor() {
    void ensureMonitorTaskRunning(true)
  }

  async function init() {
    try {
      const [savedHistory, savedSettings, savedDeleted, savedCollections, savedRecent] = await Promise.all([
        api.storage.get(STORAGE_KEY),
        api.storage.get(SETTINGS_KEY),
        api.storage.get(DELETED_KEY),
        api.storage.get(COLLECTIONS_KEY),
        api.storage.get(RECENT_FOLDERS_KEY),
      ])

      state.settings = normalizeSettings(savedSettings)
      const normalizedHistory = normalizeHistoryItems(savedHistory, state.settings.maxHistory)
      state.history = normalizedHistory
      state.deleted = normalizeDeletedMap(savedDeleted)
      state.history = (Array.isArray(state.history) ? state.history : []).filter((it) => !isDeleted(it))
      state.collections = ensureCollections(savedCollections)
      state.currentFolderId = state.collections.rootId || 'root'
      if (Array.isArray(savedRecent)) state.recentFolders = savedRecent.filter((x) => typeof x === 'string')
      if (!savedCollections) await persistCollections()
      if (!savedDeleted || state.history.length !== normalizedHistory.length) await persistClipboard()

      const firstText = state.history.find((it) => it && it.type === 'text' && it.content)
      if (firstText) state.currentText = firstText.content
      const firstImage = state.history.find((it) => it && it.type === 'image' && it.content)
      if (firstImage) state.currentImage = firstImage.content
    } catch (e) {}

    mount()
    render()

    const recentTasks = await api.task.list(20).catch(() => [])
    const runningTask = Array.isArray(recentTasks)
      ? recentTasks.find((t) => {
          const status = String(t && t.status ? t.status : '')
          const kind = String(t && t.kind ? t.kind : '')
          return (status === 'queued' || status === 'running') && kind === TASK_KIND_CLIPBOARD_WATCH
        })
      : null
    state.monitorTaskId = runningTask && runningTask.id ? String(runningTask.id) : ''

    await ensureMonitorTaskRunning(false)
  }

  init()
})()
